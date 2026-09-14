const crypto = require('node:crypto');
const path = require('node:path');
const express = require('express');
const Engine = require('./public/engine');
const { createStore } = require('./storage');

function createApp(options={}) {
  const app=express();
  const store=options.store || createStore(options.dataDir || process.env.DATA_DIR || path.join(__dirname,'data'));
  const adminEmail=options.adminEmail || process.env.ADMIN_EMAIL || 'admin@citysim.local';
  const adminPassword=options.adminPassword || process.env.ADMIN_PASSWORD || 'admin123';
  const ttl=8*60*60*1000;
  const clean=(value,max=80)=>String(value || '').trim().replace(/[<>]/g,'').slice(0,max);
  const fail=(status,message)=>{throw Object.assign(new Error(message),{status});};
  const fourDigitCode=(codes)=> {
    for(let attempt=0;attempt<100;attempt++) {
      const code=String(1000+crypto.randomInt(9000));
      if(!codes.some(entry=>entry.code===code))return code;
    }
    fail(503,'No unused four-digit registration codes are available.');
  };
  const hash=(password,salt=crypto.randomBytes(16).toString('hex'))=>salt+':'+crypto.scryptSync(password,salt,64).toString('hex');
  const verify=(password,stored)=>{const [salt,key]=String(stored || '').split(':');if(!salt || !/^[a-f0-9]{128}$/i.test(key))return false;return crypto.timingSafeEqual(Buffer.from(key,'hex'),crypto.scryptSync(password,salt,64));};
  const publicTeam=t=>({id:t.id,teamName:t.teamName,leaderName:t.leaderName,email:t.email,completed:!!t.completed,city:t.city || {roads:[],buildings:[]},result:t.result || null,revision:t.revision || 0,createdAt:t.createdAt});
  function tokenFor(db,kind,subjectId) {
    db.sessions=db.sessions.filter(s=>s.expiresAt>Date.now());
    const token=crypto.randomBytes(32).toString('hex');
    db.sessions.push({token,kind,subjectId,expiresAt:Date.now()+ttl});return token;
  }
  function auth(kind) {return (req,res,next)=> {
    const token=String(req.headers.authorization || '').replace(/^Bearer\s+/i,'');
    const db=store.read(),session=db.sessions.find(s=>s.token===token && s.kind===kind && s.expiresAt>Date.now());
    if(!session)return res.status(401).json({error:'Your session has ended. Please sign in again.'});
    req.db=db;req.session=session;next();
  };}
  function teamFor(req) {const t=req.db.teams.find(t=>t.id===req.session.subjectId);if(!t)fail(404,'This team no longer exists.');return t;}
  function revision(req,team) {if(req.body.revision!==(team.revision || 0))fail(409,'This city changed in another tab. Your local edits are kept. Reload the saved city or explicitly replace it with this draft.');}
  function audit(db,action,id) {db.audit.push({action,id,at:new Date().toISOString()});db.audit=db.audit.slice(-500);}
  app.use(express.json({limit:'250kb'}));
  app.use('/api',(req,res,next)=> {res.set('Cache-Control','no-store');next();});
  const attempts=new Map();
  app.use('/api/auth',(req,res,next)=> {
    const key=req.ip,now=Date.now();
    if(attempts.size>1000)for(const [k,v] of attempts)if(v.until<now)attempts.delete(k);
    const entry=attempts.get(key);if(!entry || entry.until<now)attempts.set(key,{count:1,until:now+60000});
    else if(++entry.count>60)return res.status(429).json({error:'Too many sign-in attempts. Wait one minute.'});
    next();
  });
  app.use(express.static(path.join(__dirname,'public'),{maxAge:0}));
  app.get('/health',(req,res)=>res.json({ok:true,version:Engine.VERSION}));
  app.get('/api/config',(req,res)=>res.json({version:Engine.VERSION,registrationCodeRequired:true,registrationCodeFormat:'4-digit',catalog:Engine.catalog,roadUnit:Engine.ROAD_UNIT,budget:Engine.BUDGET}));
  app.post('/api/auth/team/register',(req,res)=> {
    const teamName=clean(req.body.teamName),leaderName=clean(req.body.leaderName),email=clean(req.body.email,120).toLowerCase(),password=String(req.body.password || '');
    if(teamName.length<2 || leaderName.length<2 || !/^\S+@\S+\.\S+$/.test(email) || password.length<6 || password.length>128)fail(400,'Enter team and leader names, a valid email, and a password of 6–128 characters.');
    const db=store.read();
    const registrationCode=String(req.body.registrationCode || '').trim();
    if(!/^\d{4}$/.test(registrationCode))fail(400,'Enter the four-digit registration code issued by your organizer.');
    const entry=db.codes.find(c=>c.code===registrationCode);
    if(!entry || entry.usedBy || entry.revoked)fail(400,'Enter an unused registration code issued by your organizer.');
    if(entry.teamName.toLowerCase()!==teamName.toLowerCase())fail(400,'Use the team name assigned to this code: '+entry.teamName);
    if(db.teams.some(t=>t.email===email || t.teamName.toLowerCase()===teamName.toLowerCase()))fail(409,'That team name or email has already been registered. Sign in instead.');
    const team={id:crypto.randomUUID(),teamName:entry.teamName,leaderName,email,passwordHash:hash(password),completed:false,city:{roads:[],buildings:[]},result:null,revision:0,createdAt:new Date().toISOString(),codeId:entry.id};
    entry.usedBy=team.id;entry.usedAt=new Date().toISOString();db.teams.push(team);
    const token=tokenFor(db,'team',team.id);store.write(db);res.status(201).json({token,team:publicTeam(team)});
  });
  app.post('/api/auth/team/login',(req,res)=> {
    const db=store.read(),email=clean(req.body.email,120).toLowerCase(),password=String(req.body.password || '');
    const t=db.teams.find(t=>t.email===email);
    if(password.length>128 || !t || !verify(password,t.passwordHash))fail(401,'Incorrect email or password.');
    const token=tokenFor(db,'team',t.id);store.write(db);res.json({token,team:publicTeam(t)});
  });
  app.post('/api/auth/admin/login',(req,res)=> {
    if(clean(req.body.email,120).toLowerCase()!==adminEmail.toLowerCase() || req.body.password!==adminPassword)fail(401,'Incorrect administrator credentials.');
    const db=store.read(),token=tokenFor(db,'admin','administrator');store.write(db);res.json({token,admin:{email:adminEmail}});
  });
  app.post('/api/auth/logout',(req,res)=> {const token=String(req.headers.authorization || '').replace(/^Bearer\s+/i,'');const db=store.read();db.sessions=db.sessions.filter(s=>s.token!==token);store.write(db);res.json({ok:true});});
  app.get('/api/team/me',auth('team'),(req,res)=>res.json({team:publicTeam(teamFor(req)),catalog:Engine.catalog,roadUnit:Engine.ROAD_UNIT}));
  app.put('/api/team/city',auth('team'),(req,res)=> {
    const t=teamFor(req);if(t.completed)fail(403,'This city is locked after its final simulation.');revision(req,t);
    const city=Engine.validateCity(req.body.city);t.city=city;t.revision=(t.revision || 0)+1;store.write(req.db);
    res.json({team:publicTeam(t),metrics:Engine.analyze(city)});
  });
  app.post('/api/team/simulate',auth('team'),(req,res)=> {
    const t=teamFor(req);
    if(t.completed)return res.json({team:publicTeam(t),result:t.result});
    revision(req,t);const city=Engine.validateCity(req.body.city);
    if(city.roads.length<2 || city.buildings.length<5 || !city.buildings.some(b=>b.type==='residential'))fail(400,'Build at least 2 roads, 5 assets and 1 residential area before submitting.');
    const result=Engine.analyze(city,true);t.city=city;t.result=result;t.completed=true;t.completedAt=new Date().toISOString();t.revision=(t.revision || 0)+1;audit(req.db,'submit',t.id);store.write(req.db);res.json({team:publicTeam(t),result});
  });
  app.get('/api/admin/codes',auth('admin'),(req,res)=>res.json({codes:req.db.codes}));
  app.post('/api/admin/codes',auth('admin'),(req,res)=> {
    const teamName=clean(req.body.teamName);if(teamName.length<2)fail(400,'Enter the approved team name.');
    if(req.db.codes.some(c=>!c.revoked && c.teamName.toLowerCase()===teamName.toLowerCase()) || req.db.teams.some(t=>t.teamName.toLowerCase()===teamName.toLowerCase()))fail(409,'This team already has a registration or an active/used code.');
    const entry={id:crypto.randomUUID(),teamName,code:fourDigitCode(req.db.codes),createdAt:new Date().toISOString(),usedBy:null,revoked:false};req.db.codes.push(entry);audit(req.db,'issue-code',entry.id);store.write(req.db);res.status(201).json({code:entry});
  });
  app.post('/api/admin/codes/:id/revoke',auth('admin'),(req,res)=> {
    const c=req.db.codes.find(c=>c.id===req.params.id);if(!c)fail(404,'Code not found.');if(c.usedBy)fail(409,'A used code remains consumed permanently.');c.revoked=true;audit(req.db,'revoke-code',c.id);store.write(req.db);res.json({ok:true});
  });
  app.delete('/api/admin/teams/:id',auth('admin'),(req,res)=> {
    const t=req.db.teams.find(t=>t.id===req.params.id);if(!t)fail(404,'Team not found. Refresh the leaderboard.');
    req.db.teams=req.db.teams.filter(t=>t.id!==req.params.id);req.db.sessions=req.db.sessions.filter(s=>!(s.kind==='team' && s.subjectId===t.id));
    audit(req.db,'delete-team',t.id);store.write(req.db);res.json({deletedTeamId:t.id});
  });
  app.get('/api/admin/scores',auth('admin'),(req,res)=> {
    const teams=req.db.teams.map(t=>({id:t.id,teamName:t.teamName,leaderName:t.leaderName,email:t.email,completed:!!t.completed,score:t.result?.score ?? null,budgetUsed:t.result?.totalCost ?? Engine.cost(t.city),population:t.result?.population ?? Engine.analyze(t.city).population,completedAt:t.completedAt || null,eventAverage:t.result?.eventAverage ?? null,result:t.result || null,version:t.result ? t.result.version || '1.0' : Engine.VERSION})).sort((a,b)=>(b.score ?? -1)-(a.score ?? -1));
    const current=teams.filter(t=>t.completed && t.version===Engine.VERSION);
    res.json({teams,version:Engine.VERSION,summary:{registered:teams.length,completed:teams.filter(t=>t.completed).length,averageScore:current.length?Math.round(current.reduce((s,t)=>s+t.score,0)/current.length):0}});
  });
  app.use('/api',(req,res)=>res.status(404).json({error:'API route not found. Restart the event server if it was just updated.'}));
  app.get('/',(req,res)=>res.sendFile(path.join(__dirname,'public','index.html')));
  app.use((error,req,res,next)=> {console.error(error.message);res.status(error.status || 500).json({error:error.status ? error.message : 'The server could not complete this request. Your local draft has been kept.'});});
  return app;
}
if(require.main===module)createApp().listen(process.env.PORT || 3001,()=>console.log('City simulator is running at http://localhost:'+(process.env.PORT || 3001)));
module.exports={createApp};

