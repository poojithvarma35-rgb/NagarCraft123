const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {once}=require('node:events');
const E=require('../public/engine');
const {createStore}=require('../storage');
const {createApp}=require('../server');
const road=(id,x,y,xx,yy)=>({id,start:{x,y},end:{x:xx,y:yy}});
const building=(id,type,x,y)=>({id,type,x,y});
const clone=v=>JSON.parse(JSON.stringify(v));
function fixture() {return {roads:[road('a',100,100,900,100),road('b',900,100,900,260),road('c',100,260,900,260),road('d',100,100,100,260)],buildings:[building('h1','residential',200,120),building('h2','residential',350,120),building('job','commercial',500,120),building('hospital','hospital',220,80),building('fire','fire',350,80),building('water','water',500,80),building('power','power',650,80),building('drain','drainage',750,120),building('waste','waste',800,80),building('school','school',300,260),building('bus','bus',550,260)]};}

test('intersections and T junctions connect; nearby parallel roads do not',()=> {
  const city={roads:[road('a',100,100,500,100),road('b',300,50,300,260)],buildings:[building('a1','residential',150,120),building('b1','hospital',320,240)]};
  let route=E.routing(city,E.network(city));assert.ok(Number.isFinite(route(0,1).distance));assert.ok(route(0,1).points.length>=4);
  city.roads[1]=road('b',300,100,300,260);route=E.routing(city,E.network(city));assert.ok(Number.isFinite(route(0,1).distance));
  city.roads=[road('a',100,100,500,100),road('b',100,240,500,240)];route=E.routing(city,E.network(city));assert.equal(route(0,1).distance,Infinity);
  assert.equal(E.analyze(city).coverage.hospital.served,0);
});
test('missing or disconnected emergency facilities cannot receive response credit',()=> {
  const city=fixture();city.buildings=city.buildings.filter(b=>b.type!=='hospital');
  assert.equal(E.analyze(city,true).events.find(e=>e.key==='ambulance').score,0);
  city.buildings=city.buildings.filter(b=>b.type!=='fire');
  assert.equal(E.analyze(city,true).events.find(e=>e.key==='fire').score,0);
});
test('service demand shares finite capacity; more connected capacity improves coverage',()=> {
  const city=fixture();city.buildings.push(building('h3','residential',650,120));
  const before=E.analyze(city).coverage.hospital;
  assert.ok(before.coverage<100);assert.equal(before.served,18000);
  city.buildings.push(building('hospital2','hospital',750,80));
  assert.ok(E.analyze(city).coverage.hospital.coverage>before.coverage);
});
test('residential areas share job capacity instead of reusing the same jobs',()=> {
  const city={roads:[road('r',100,100,500,100)],buildings:[building('h1','residential',200,120),building('h2','residential',300,120),building('j','commercial',400,120)]};
  assert.equal(E.analyze(city).roadScore,83); // 6,000 jobs / 7,200 commuters, short routes.
  city.buildings.push(building('j2','commercial',400,80));
  assert.equal(E.analyze(city).roadScore,100);
});
test('road subdivision and duplicate overlaps do not improve score or capacity',()=> {
  const city=fixture();const original=E.analyze(city,true),price=E.cost(city);
  city.roads.splice(0,1,road('a1',100,100,400,100),road('a2',400,100,900,100));
  assert.equal(E.cost(city),price);assert.equal(E.analyze(city,true).score,original.score);
  city.roads.push(road('overlap',100,100,900,100));
  const after=E.analyze(city,true);assert.equal(after.score,original.score);assert.equal(after.roadScore,original.roadScore);
  assert.ok(E.cost(city)>price);
});
test('floodplain location and local drainage affect flood results',()=> {
  const y=E.riverY(200)-55;
  const near={roads:[road('r',100,y-15,500,y-15)],buildings:[building('h','residential',200,y)]};
  const flood=c=>E.analyze(c,true).events[0].score;
  const far={roads:[road('r',100,100,500,100)],buildings:[building('h','residential',200,120)]};
  assert.ok(flood(far)>flood(near));const before=flood(near);
  near.buildings.push(building('d','drainage',300,y-30));assert.ok(flood(near)>before);
});
test('strict validation rejects forged assets, overlap, river sites and over-budget plans',()=> {
  assert.doesNotThrow(()=>E.validateCity(fixture()));
  const invalid=fixture();invalid.buildings[0].type='toString';assert.throws(()=>E.validateCity(invalid),/Unknown/);
  const overlap=fixture();overlap.buildings[1].x=overlap.buildings[0].x;assert.throws(()=>E.validateCity(overlap),/34/);
  const water=fixture();water.buildings[0].y=E.riverY(200);assert.throws(()=>E.validateCity(water),/land/);
  const expensive=fixture();for(let i=0;i<50;i++)expensive.roads.push(road('extra'+i,0,0,1000,650));assert.throws(()=>E.validateCity(expensive),/budget/);
  assert.equal(Object.hasOwn(E.analyze(fixture()),'score'),false);
});
test('HTTP code claim, revisions, one-run lock, authorization, persistence, and deletion',async t=> {
  const directory=fs.mkdtempSync(path.join(__dirname,'../work/api-test-'));
  const store=createStore(directory),app=createApp({store,adminEmail:'admin@example.test',adminPassword:'test-password'});
  const server=app.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>{server.close();server.closeAllConnections();});
  const base='http://127.0.0.1:'+server.address().port;
  const req=async (url,method='GET',body,token)=> {const response=await fetch(base+url,{method,headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},body:body===undefined?undefined:JSON.stringify(body)});return {status:response.status,data:await response.json()};};
  const admin=(await req('/api/auth/admin/login','POST',{email:'admin@example.test',password:'test-password'})).data.token;
  assert.equal((await req('/api/admin/codes','POST',{teamName:'Team One'})).status,401);
  const code=(await req('/api/admin/codes','POST',{teamName:'Team One'},admin)).data.code;
  assert.match(code.code,/^\d{4}$/);
  const body={teamName:'Team One',leaderName:'Test Leader',email:'one@example.test',password:'test-password',registrationCode:code.code};
  assert.equal((await req('/api/auth/team/register','POST',{...body,registrationCode:'WRONG'})).status,400);
  assert.equal((await req('/api/auth/team/register','POST',{...body,registrationCode:'12345'})).status,400);
  assert.equal((await req('/api/auth/team/register','POST',{...body,teamName:'Wrong Team'})).status,400);
  const claimed=await Promise.all([req('/api/auth/team/register','POST',body),req('/api/auth/team/register','POST',body)]);
  assert.deepEqual(claimed.map(r=>r.status).sort(),[201,400]);
  const registered=claimed.find(r=>r.status===201).data,token=registered.token;
  assert.equal((await req('/api/admin/codes','GET',undefined,token)).status,401);
  const saved=await req('/api/team/city','PUT',{city:fixture(),revision:0},token);assert.equal(saved.status,200);assert.equal(saved.data.team.revision,1);assert.equal(Object.hasOwn(saved.data.metrics,'score'),false);
  assert.equal((await req('/api/team/city','PUT',{city:fixture(),revision:0},token)).status,409);
  assert.equal(createStore(directory).read().teams[0].revision,1);
  assert.ok(fs.existsSync(store.backup));assert.ok(fs.existsSync(path.join(directory,'before-v2.json.bak')));
  const submissions=await Promise.all([req('/api/team/simulate','POST',{city:fixture(),revision:1},token),req('/api/team/simulate','POST',{city:fixture(),revision:1},token)]);
  assert.ok(submissions.every(r=>r.status===200));assert.deepEqual(submissions[0].data.result,submissions[1].data.result);
  const score=submissions[0].data.result.score;
  assert.equal((await req('/api/team/city','PUT',{city:fixture(),revision:2},token)).status,403);
  assert.equal((await req('/api/admin/scores','GET',undefined,admin)).data.summary.averageScore,score);
  assert.equal((await req('/api/admin/teams/'+registered.team.id,'DELETE',undefined,token)).status,401);
  assert.equal((await req('/api/admin/teams/'+registered.team.id,'DELETE',undefined,admin)).status,200);
  assert.equal((await req('/api/team/me','GET',undefined,token)).status,401);
  assert.equal((await req('/api/auth/team/register','POST',body)).status,400);
  assert.equal(store.read().codes[0].usedBy,registered.team.id);
  assert.equal((await req('/api/admin/codes','POST',{teamName:'Team One'},admin)).status,409);
});
test('corrupt primary fails closed without overwriting a good backup',()=> {
  const directory=fs.mkdtempSync(path.join(__dirname,'../work/store-test-')),store=createStore(directory);
  store.write({teams:[],sessions:[],codes:[],audit:[]});store.write({teams:[{id:'kept'}],sessions:[],codes:[],audit:[]});
  const backup=fs.readFileSync(store.backup,'utf8');fs.writeFileSync(store.file,'{broken');
  assert.throws(()=>store.read(),/unavailable/);assert.throws(()=>store.write({teams:[],sessions:[]}),/unavailable/);
  assert.equal(fs.readFileSync(store.backup,'utf8'),backup);assert.equal(fs.readFileSync(store.file,'utf8'),'{broken');
});

