(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.CityEngine = factory();
})(typeof globalThis === 'object' ? globalThis : this, function () {
  'use strict';
  const VERSION = '2.0';
  const BUDGET = 100, ROAD_UNIT = 200, ACCESS = 42, MAX_ROADS = 100, MAX_BUILDINGS = 100;
  const catalog = {
    residential:{label:'Residential area',icon:'⌂',cost:3,population:9000,color:'#e66d65'},
    commercial:{label:'Commercial area',icon:'▥',cost:4,jobs:6000,demand:1500,color:'#f1a24b'},
    industrial:{label:'Industrial area',icon:'⚙',cost:6,jobs:9000,demand:4500,color:'#8774d8'},
    hospital:{label:'Hospital',icon:'✚',cost:6,capacity:18000,color:'#d94f5c'},
    school:{label:'School / college',icon:'▣',cost:4,capacity:12000,color:'#4e8edb'},
    fire:{label:'Fire station',icon:'♨',cost:4,capacity:22000,color:'#ef6e56'},
    park:{label:'Park',icon:'♣',cost:2,color:'#50a96e'},
    water:{label:'Water plant',icon:'◉',cost:7,capacity:24000,color:'#3189b9'},
    power:{label:'Power plant',icon:'ϟ',cost:8,capacity:24000,color:'#e5b83b'},
    bus:{label:'Bus depot',icon:'▰',cost:3,capacity:12000,color:'#e48e3f'},
    waste:{label:'Waste facility',icon:'♻',cost:5,capacity:20000,color:'#699a5d'},
    drainage:{label:'Drainage network',icon:'≈',cost:5,capacity:18000,color:'#498fc0'},
    sensor:{label:'Smart sensor',icon:'◌',cost:1,color:'#6d91aa'},
    solar:{label:'Solar field',icon:'☀',cost:4,capacity:6000,color:'#d7a831'},
    hotel:{label:'Hotel',icon:'H',cost:3,jobs:1500,demand:1000,color:'#b3779a'},
    restaurant:{label:'Restaurant',icon:'R',cost:2,jobs:750,demand:500,color:'#b97145'}
  };
  const clamp = (v, lo=0, hi=1) => Math.min(hi, Math.max(lo, v));
  const round = v => Math.round(v * 100) / 100;
  const distance = (a,b) => Math.hypot(a.x-b.x,a.y-b.y);
  const riverY = x => 390 + 35 * Math.sin(x / 115);
  const inRiver = p => Math.abs(p.y - riverY(p.x)) < 32;
  const floodRisk = p => clamp(1 - Math.max(0, Math.abs(p.y-riverY(p.x))-32) / 100);
  function project(p, a, b) {
    const dx=b.x-a.x, dy=b.y-a.y, len=dx*dx+dy*dy;
    const t=len ? clamp(((p.x-a.x)*dx+(p.y-a.y)*dy)/len) : 0;
    const point={x:a.x+t*dx,y:a.y+t*dy};
    return {...point,t,distance:distance(p,point)};
  }
  const roadCost = road => distance(road.start,road.end)/ROAD_UNIT;
  const cost = city => round(city.roads.reduce((s,r)=>s+roadCost(r),0)+city.buildings.reduce((s,b)=>s+(catalog[b.type]?.cost || 0),0));
  function validateCity(input) {
    const fail = message => { const e=new Error(message); e.status=400; throw e; };
    if (!input || !Array.isArray(input.roads) || !Array.isArray(input.buildings)) fail('City must contain roads and buildings.');
    if (input.roads.length>MAX_ROADS || input.buildings.length>MAX_BUILDINGS) fail('Maximum 100 roads and 100 assets per city.');
    const ids=new Set();
    const id = value => { if (typeof value!=='string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(value) || ids.has(value)) fail('Every road and asset needs a unique ID.'); ids.add(value); return value; };
    const point = p => { if (!p || typeof p.x!=='number' || typeof p.y!=='number' || !Number.isFinite(p.x) || !Number.isFinite(p.y) || p.x<0 || p.x>1000 || p.y<0 || p.y>650) fail('Place infrastructure within the city boundary.'); return {x:round(p.x),y:round(p.y)}; };
    const city={roads:input.roads.map(r=> { if(!r) fail('Invalid road.'); return {id:id(r.id),start:point(r.start),end:point(r.end)}; }),buildings:input.buildings.map(b=> { if(!b || !Object.hasOwn(catalog,b.type)) fail('Unknown infrastructure type.'); return {id:id(b.id),type:b.type,...point(b)}; })};
    for (const r of city.roads) if (distance(r.start,r.end)<5) fail('Roads must be at least 5 metres long.');
    for(let i=0;i<city.buildings.length;i++) {
      const b=city.buildings[i];
      if(inRiver(b)) fail('Buildings must be on land. Roads crossing the river act as bridges.');
      if(city.buildings.slice(i+1).some(other=>distance(b,other)<34)) fail('Leave at least 34 metres between assets.');
    }
    if(cost(city)>BUDGET) fail(`This city costs ₹${cost(city)} Cr, above the ₹100 Cr budget.`);
    return city;
  }
  // Split roads at exact crossings, T junctions, collinear endpoints and building
  // projections. Coincident edges are deduplicated: overlapping roads add no capacity.
  function network(city) {
    const cuts=city.roads.map(r=>[r.start,r.end]);
    const cross=(a,b)=>a.x*b.y-a.y*b.x;
    for(let i=0;i<city.roads.length;i++) for(let j=i+1;j<city.roads.length;j++) {
      const a=city.roads[i],b=city.roads[j];
      const u={x:a.end.x-a.start.x,y:a.end.y-a.start.y},v={x:b.end.x-b.start.x,y:b.end.y-b.start.y};
      const w={x:b.start.x-a.start.x,y:b.start.y-a.start.y},den=cross(u,v);
      if(Math.abs(den)>1e-8) {
        const t=cross(w,v)/den,s=cross(w,u)/den;
        if(t>=-1e-8 && t<=1+1e-8 && s>=-1e-8 && s<=1+1e-8) { const p={x:a.start.x+t*u.x,y:a.start.y+t*u.y}; cuts[i].push(p); cuts[j].push(p); }
      } else {
        for(const p of [a.start,a.end]) if(project(p,b.start,b.end).distance<1e-6) cuts[j].push(p);
        for(const p of [b.start,b.end]) if(project(p,a.start,a.end).distance<1e-6) cuts[i].push(p);
      }
    }
    const attachment=city.buildings.map(b=> {
      let best=null;
      city.roads.forEach((r,i)=> { const p=project(b,r.start,r.end); if(p.distance<=ACCESS && (!best || p.distance<best.distance)) best={...p,road:i}; });
      if(best) cuts[best.road].push(best);
      return best;
    });
    // Split overlapping spans at all of the same attachment points. Otherwise an
    // unsplit duplicate could form a parallel edge and falsely add road capacity.
    const originalCuts=cuts.map(points=>points.slice());
    for(let i=0;i<city.roads.length;i++) for(let j=0;j<city.roads.length;j++) {
      if(i===j)continue;const a=city.roads[i],b=city.roads[j];
      const u={x:a.end.x-a.start.x,y:a.end.y-a.start.y},v={x:b.end.x-b.start.x,y:b.end.y-b.start.y};
      if(Math.abs(cross(u,v))<1e-8)for(const p of originalCuts[j])if(project(p,a.start,a.end).distance<1e-6)cuts[i].push(p);
    }
    const nodes=[],edges=[],adj=[],nodeIds=new Map(),edgeIds=new Set();
    function node(p) { const key=`${p.x.toFixed(5)},${p.y.toFixed(5)}`; if(!nodeIds.has(key)) {nodeIds.set(key,nodes.length);nodes.push({x:p.x,y:p.y});adj.push([]);} return nodeIds.get(key); }
    cuts.forEach((points,i)=> {
      const r=city.roads[i]; points.sort((a,b)=>project(a,r.start,r.end).t-project(b,r.start,r.end).t);
      for(let j=1;j<points.length;j++) {
        const a=node(points[j-1]),b=node(points[j]); if(a===b) continue;
        const key=[a,b].sort((x,y)=>x-y).join(':'); if(edgeIds.has(key)) continue;
        edgeIds.add(key); const length=distance(nodes[a],nodes[b]);
        const edge={a,b,length}; const eid=edges.length; edges.push(edge); adj[a].push({to:b,id:eid});adj[b].push({to:a,id:eid});
      }
    });
    const links=attachment.map(a=>a ? {node:node(a),distance:a.distance} : null);
    return {nodes,edges,adj,links};
  }
  // Binary heap keeps shortest paths fast even when many roads intersect.
  function shortest(graph, source, weights) {
    const d=Array(graph.nodes.length).fill(Infinity),prev=Array(d.length).fill(null),heap=[];
    function push(item) { let i=heap.length; heap.push(item); while(i>0) {const p=(i-1)>>1;if(heap[p][0]<=item[0])break;heap[i]=heap[p];i=p;} heap[i]=item; }
    function pop() { const top=heap[0],last=heap.pop(); if(heap.length) {let i=0;while(i*2+1<heap.length){let k=i*2+1;if(k+1<heap.length && heap[k+1][0]<heap[k][0])k++;if(heap[k][0]>=last[0])break;heap[i]=heap[k];i=k;}heap[i]=last;}return top; }
    d[source]=0;push([0,source]);
    while(heap.length) {const [dist,u]=pop();if(dist!==d[u])continue;for(const {to,id} of graph.adj[u]) {const next=dist+(weights ? weights[id] : graph.edges[id].length);if(next<d[to]-1e-8){d[to]=next;prev[to]={node:u,edge:id};push([next,to]);}}}
    return {d,prev};
  }
  function routing(city, graph, weights) {
    const cache=new Map();
    return (from,to) => {
      const a=graph.links[from],b=graph.links[to]; if(!a || !b) return {distance:Infinity,edges:[],points:[]};
      if(!cache.has(a.node))cache.set(a.node,shortest(graph,a.node,weights));
      const tree=cache.get(a.node); if(!Number.isFinite(tree.d[b.node]))return {distance:Infinity,edges:[],points:[]};
      let current=b.node;const edges=[],points=[graph.nodes[current]];
      while(current!==a.node) {const step=tree.prev[current];edges.push(step.edge);current=step.node;points.push(graph.nodes[current]);}
      points.reverse();edges.reverse();
      return {distance:tree.d[b.node]+a.distance+b.distance,edges,points:[city.buildings[from],...points,city.buildings[to]].map(p=>({x:p.x,y:p.y}))};
    };
  }
  const demandOf = b => catalog[b.type]?.population || catalog[b.type]?.demand || 0;
  function allocate(city, route, types, multiplier=1, maxDistance=Infinity, demandFn=demandOf, capacityFn=b=>catalog[b.type].capacity) {
    const receivers=city.buildings.map((b,i)=>({i,demand:demandFn(b)*multiplier})).filter(r=>r.demand>0);
    const supplies=city.buildings.map((b,i)=>({i,capacity:types.includes(b.type) ? capacityFn(b) : 0})).filter(s=>s.capacity>0);
    const available=supplies.map(s=>s.capacity),delivered=city.buildings.map(()=>0),details=city.buildings.map(()=>[]);
    const remaining=receivers.map(r=>r.demand);
    const choices=receivers.map(r=>supplies.map((s,j)=>({j,...route(s.i,r.i)})).filter(p=>Number.isFinite(p.distance) && p.distance<=maxDistance).sort((a,b)=>a.distance-b.distance));
    for(let step=0;step<supplies.length;step++) {
      const requests=supplies.map(()=>[]);
      receivers.forEach((r,k)=> {if(remaining[k]<.001)return;const p=choices[k].find(p=>available[p.j]>.001);if(p)requests[p.j].push({k,p});});
      requests.forEach((list,j)=> {
        const total=list.reduce((sum,{k})=>sum+remaining[k],0); if(!total)return;
        const ratio=Math.min(1,available[j]/total);let used=0;
        list.forEach(({k,p})=> {const amount=remaining[k]*ratio;remaining[k]-=amount;delivered[receivers[k].i]+=amount;used+=amount;details[receivers[k].i].push({source:supplies[j].i,amount,...p});}); available[j]-=used;
      });
    }
    const total=receivers.reduce((s,r)=>s+r.demand,0),served=delivered.reduce((a,b)=>a+b,0);
    return {coverage:total ? served/total : 0,total,served,delivered,details,capacity:supplies.reduce((s,p)=>s+p.capacity,0)};
  }
  function analyze(city, events=false) {
    const g=network(city),route=routing(city,g),population=city.buildings.reduce((s,b)=>s+(catalog[b.type]?.population || 0),0);
    const consumers=city.buildings.map((b,i)=>({b,i,demand:demandOf(b)})).filter(x=>x.demand>0);
    const demand=consumers.reduce((s,c)=>s+c.demand,0);
    const service={};
    for(const [key,types] of Object.entries({water:['water'],power:['power','solar'],drainage:['drainage'],waste:['waste'],hospital:['hospital'],fire:['fire'],school:['school'],bus:['bus']})) service[key]=allocate(city,route,types,1,['hospital','fire'].includes(key)?1800:Infinity);
    // Fixed demand trips use the shortest available route. Loading each physical
    // edge makes disconnected roads and extra segments worthless for mobility.
    const employment=allocate(city,route,['commercial','industrial','hotel','restaurant'],1,Infinity,b=>b.type==='residential'?catalog.residential.population*.4:0,b=>catalog[b.type].jobs);
    const loads=g.edges.map(()=>0),trips=[];
    const connectedTrips=employment.served,totalTrips=employment.total;
    employment.details.forEach((assignments,i)=> {
      for(const assignment of assignments) {const flow=assignment.amount,path=route(i,assignment.source);const busFactor=1-.45*clamp(service.bus.delivered[i]/9000);path.edges.forEach(e=>loads[e]+=flow*busFactor);trips.push({flow,path});}
    });
    const tripQuality=surge=> totalTrips ? trips.reduce((s,t)=> {
      const delay=t.path.edges.reduce((n,e)=>n+g.edges[e].length*(1+Math.pow(loads[e]*surge/6000,2)),0);
      const quality=clamp(900/Math.max(900,delay));return s+t.flow*quality;
    },0)/totalTrips:0;
    const scorePct = n=>Math.round(clamp(n)*100);
    const warnings=[];
    const disconnected=city.buildings.filter((_,i)=>!g.links[i]).map(b=>b.id);
    if(disconnected.length)warnings.push(`${disconnected.length} asset(s) have no road within ${ACCESS} m.`);
    if(population===0)warnings.push('Add at least one residential area before submission.');
    for(const key of ['water','power','drainage','waste','hospital','fire']) if(demand && service[key].coverage<.999)warnings.push(`${catalog[key==='hospital'?'hospital':key].label}: ${Math.round(service[key].total-service[key].served).toLocaleString('en-IN')} demand units lack reachable capacity.`);
    if(population && connectedTrips<totalTrips)warnings.push('Some residents lack enough jobs on their connected road network.');
    const exposed=city.buildings.filter(b=>floodRisk(b)>.3).map(b=>b.id);
    if(exposed.length)warnings.push(`${exposed.length} asset(s) lie within the river floodplain.`);
    const coverage=Object.fromEntries(Object.entries(service).map(([k,v])=>[k,{coverage:scorePct(v.coverage),capacity:v.capacity,demand:Math.round(v.total),served:Math.round(v.served)}]));
    const access=city.buildings.length?scorePct((city.buildings.length-disconnected.length)/city.buildings.length):0;
    const utilityMean=(service.water.coverage+service.power.coverage+service.drainage.coverage+service.waste.coverage)/4;
    const metrics={version:VERSION,totalCost:cost(city),budget:round(BUDGET-cost(city)),population,access,roadScore:scorePct(tripQuality(1)),emergency:scorePct((service.hospital.coverage+service.fire.coverage)/2),resilience:scorePct(utilityMean),coverage,warnings,disconnected,exposed,roadLength:round(city.roads.reduce((s,r)=>s+distance(r.start,r.end),0))};
    if(!events)return metrics;
    // Flood protection is local, requires reachable drainage capacity, and parks
    // soften local runoff. Sensors improve response timing but cannot supply care.
    const floodLoss=city.buildings.map((b,i)=> {
      const localDrain=service.drainage.details[i].filter(p=>p.distance<400).reduce((s,p)=>s+p.amount,0);
      const drain=clamp(localDrain/Math.max(1,demandOf(b)));
      const green=city.buildings.some(p=>p.type==='park' && distance(p,b)<140)? .15:0;
      return floodRisk(b)*(1-.75*drain-green);
    });
    const floodWeights=g.edges.map(e=> {
      const a=g.nodes[e.a],b=g.nodes[e.b],mid={x:(a.x+b.x)/2,y:(a.y+b.y)/2};
      // River spans are bridges; land approaches are slowed by inundation.
      return e.length*(1+(inRiver(mid)? .2:floodRisk(mid)*2));
    });
    const floodedRoute=routing(city,g,floodWeights);
    const floodWater=allocate(city,floodedRoute,['water']);
    const flood=scorePct(demand ? consumers.reduce((s,c)=>s+c.demand*(1-floodLoss[c.i]),0)/demand*(.65+.35*floodWater.coverage):0);
    const emergencyEvent=(key,type,name,icon)=> {
      const allocation=allocate(city,route,[type],1.4,1800);
      const cases=consumers.map(c=> {
        const served=allocation.details[c.i];
        const sensor=city.buildings.some(b=>b.type==='sensor' && distance(b,c.b)<160);
        const numerator=served.reduce((s,p)=>s+p.amount*clamp(8/(2+p.distance/160-(sensor ? .5 : 0))),0);
        const quality=clamp(numerator/(c.demand*1.4));
        const nearest=served.slice().sort((a,b)=>a.distance-b.distance)[0];
        return {...c,quality,nearest};
      });
      const score=scorePct(demand?cases.reduce((s,c)=>s+c.demand*c.quality,0)/demand:0);
      const worst=cases.slice().sort((a,b)=>a.quality-b.quality)[0];
      return {key,name,icon,score,note:allocation.capacity===0?`No ${catalog[type].label.toLowerCase()} was built. Response failed.`:`${Math.round(allocation.coverage*100)}% of surge demand served via reachable roads; distance affects arrival time.`,target:worst?{x:worst.b.x,y:worst.b.y}:null,route:worst?.nearest?.points || []};
    };
    const waste=allocate(city,route,['waste'],1.6);
    const worstFlood=consumers.slice().sort((a,b)=>floodLoss[b.i]-floodLoss[a.i])[0];
    const eventList=[{key:'flood',name:'Monsoon flood',icon:'🌧️',score:flood,note:`Floodplain exposure and local drainage tested; ${scorePct(floodWater.coverage)}% water coverage under slower routes.`,target:worstFlood?{x:worstFlood.b.x,y:worstFlood.b.y}:null},emergencyEvent('ambulance','hospital','Ambulance emergency','🚑'),emergencyEvent('fire','fire','Fire response','🔥'),{key:'traffic',name:'Traffic surge',icon:'🚗',score:scorePct(tripQuality(2)),note:'Twice the normal commuter demand; shared road bottlenecks, distance, jobs and buses affect travel.',route:trips.slice().sort((a,b)=>b.path.distance-a.path.distance)[0]?.path.points || []},{key:'waste',name:'Waste surge',icon:'♻️',score:scorePct(waste.coverage),note:`${Math.round(waste.served).toLocaleString('en-IN')} of ${Math.round(waste.total).toLocaleString('en-IN')} surge demand units served by reachable waste facilities.`}];
    const eventAverage=Math.round(eventList.reduce((s,e)=>s+e.score,0)/5);
    const livability=scorePct((service.school.coverage+clamp(connectedTrips/Math.max(1,totalTrips)))/2);
    const engineeringScore=Math.round(metrics.access*.15+metrics.roadScore*.2+metrics.emergency*.2+metrics.resilience*.3+livability*.15);
    return {...metrics,city,score:Math.round(engineeringScore*.45+eventAverage*.55),engineeringScore,eventAverage,events:eventList,generatedAt:new Date().toISOString()};
  }
  return {VERSION,BUDGET,ROAD_UNIT,ACCESS,MAX_ROADS,MAX_BUILDINGS,catalog,round,distance,project,riverY,inRiver,floodRisk,cost,roadCost,validateCity,network,routing,analyze};
});

