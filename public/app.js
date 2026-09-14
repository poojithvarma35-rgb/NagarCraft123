const E = CityEngine;
const $ = selector => document.querySelector(selector);
const clone = value => JSON.parse(JSON.stringify(value));
const escapeHtml = value => String(value ?? '').replace(/[&<>'"]/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
const number = value => Number(value || 0).toLocaleString('en-IN',{maximumFractionDigits:2});
const lakhCost = value => '₹'+number(value*100)+' lakh';
const storage = {
  get(key) { try {return localStorage.getItem(key);} catch {return null;} },
  set(key,value) {try {localStorage.setItem(key,value);return true;} catch {return false;} },
  remove(key) {try {localStorage.removeItem(key);} catch {}}
};
const state = {token:storage.get('citySimTeamToken') || '',team:null,city:{roads:[],buildings:[]},selectedTool:'road',roadStart:null,pointer:null,moving:null,history:[],metrics:null,dirty:false,conflict:false,savePromise:null,saveTimer:null,submitting:false,view:{x:0,y:0,w:1000,h:650},keyboard:{x:500,y:260}};
function svg(name, attrs={}) {const el=document.createElementNS('http://www.w3.org/2000/svg',name);Object.entries(attrs).forEach(([k,v])=>el.setAttribute(k,v));return el;}
async function request(url, options={}) {
  let response;
  try {response=await fetch(url,{...options,headers:{'Content-Type':'application/json',Authorization:'Bearer '+state.token,...options.headers},signal:AbortSignal.timeout(15000)});}
  catch {throw new Error('Connection interrupted. Your draft is kept on this device. Retry saving when the server is available.');}
  const data=await response.json().catch(()=>({}));
  if(!response.ok)throw Object.assign(new Error(data.error || 'The request could not be completed.'),{status:response.status});
  return data;
}
function showToast(message) {$('#toast').textContent=message;$('#toast').classList.add('visible');clearTimeout(showToast.timer);showToast.timer=setTimeout(()=>$('#toast').classList.remove('visible'),4500);}
const draftKey=()=>state.team ? 'citySimDraft:'+state.team.id : '';
function keepDraft() {
  if(state.team && !state.team.completed && state.dirty) {
    if(!storage.set(draftKey(),JSON.stringify({city:state.city,revision:state.team.revision || 0}))) $('#saveStatus').textContent='Device storage is full. Keep this page open and save to the server.';
  }
}
function saveMessage(text, failed=false) {$('#saveStatus').textContent=text;$('#retrySave').classList.toggle('hidden',!failed);$('#conflictActions').classList.toggle('hidden',!state.conflict);}
function scheduleSave() {state.dirty=true;keepDraft();clearTimeout(state.saveTimer);if(!state.conflict) {saveMessage('Unsaved changes · saving…');state.saveTimer=setTimeout(()=>saveCity().catch(()=>{}),500);}}
function saveCity() {
  if(state.savePromise)return state.savePromise;
  if(!state.team || state.team.completed || !state.dirty)return Promise.resolve();
  if(state.conflict)return Promise.reject(new Error('Resolve the saved-city conflict first.'));
  clearTimeout(state.saveTimer);
  state.savePromise=(async()=> {
    try {
      while(state.dirty && !state.team.completed) {
        const snapshot=clone(state.city),teamId=state.team.id;
        const data=await request('/api/team/city',{method:'PUT',body:JSON.stringify({city:snapshot,revision:state.team.revision || 0})});
        if(state.team?.id!==teamId)return;
        state.team.revision=data.team.revision;
        state.dirty=JSON.stringify(snapshot)!==JSON.stringify(state.city);
        if(state.dirty)keepDraft();else storage.remove(draftKey());
      }
      saveMessage('Saved to event server.');
    } catch(error) {
      state.dirty=true;if(error.status===409)state.conflict=true;
      keepDraft();saveMessage(error.message,true);
      if(error.status===401)$('#resumeLogin').classList.remove('hidden');
      throw error;
    } finally {state.savePromise=null;}
  })();
  return state.savePromise;
}
async function resolveConflict(useLocal) {
  try {
    const data=await request('/api/team/me');
    if(data.team.completed) {showApp(data.team);return;}
    if(useLocal) {
      if(!confirm('Replace the server city with the draft shown here? This will replace edits from another tab.'))return;
      state.team.revision=data.team.revision;state.conflict=false;state.dirty=true;keepDraft();await saveCity();
    } else {
      if(!confirm('Load the server city and discard this device’s unsaved edits?'))return;
      storage.remove(draftKey());showApp(data.team,false);
    }
  } catch(error) {showToast(error.message);}
}
function commit(next) {
  if(state.submitting || state.team?.completed)return;
  try {E.validateCity(next);} catch(error) {showToast(error.message);return false;}
  state.history.push(clone(state.city));if(state.history.length>60)state.history.shift();
  state.city=next;renderAll();scheduleSave();return true;
}
function cancelActiveAction(message='Road drawing canceled.') {
  const hadPreview=!!(state.roadStart || state.moving);
  state.roadStart=null;state.pointer=null;state.moving=null;renderPreview();
  if(hadPreview && message)$('#mapInstruction').textContent=message;
}
function chooseTool(type) {
  if(type==='road' && state.selectedTool==='road' && state.roadStart) {
    cancelActiveAction();renderTools();return;
  }
  state.selectedTool=type;state.roadStart=null;state.pointer=null;state.moving=null;
  const labels={road:'Road: click a start point, then an end point. Click Draw road again or outside the map to cancel.',move:'Move: click a building, then its new position.',delete:'Remove: click a building or road. Its cost is refunded.',pan:'Pan: drag the map. Use + / − to zoom.'};
  $('#mapInstruction').textContent=labels[type] || 'Place '+E.catalog[type].label+' on land near a road.';
  renderTools();renderPreview();
}
function renderTools() {
  const list=$('#toolList');list.innerHTML='';
  const tools=[{type:'road',label:'Draw road',icon:'━',color:'#536e6a',cost:0.01},...Object.entries(E.catalog).map(([type,item])=>({type,...item}))];
  tools.forEach(tool=> {
    const button=document.createElement('button');button.type='button';button.className='tool-button'+(state.selectedTool===tool.type?' active':'');button.disabled=!!state.team?.completed || state.submitting;button.setAttribute('aria-pressed',state.selectedTool===tool.type);
    button.style.setProperty('--tool-color',tool.color);
    button.innerHTML='<span class="tool-symbol">'+tool.icon+'</span><span>'+escapeHtml(tool.label)+'</span><span class="tool-cost">'+lakhCost(tool.cost)+(tool.type==='road'?'/200m':'')+'</span>';
    button.title=tool.capacity ? 'Capacity: '+number(tool.capacity)+' demand units via roads' : tool.type==='road'?'Roads are charged by total length. River crossings act as bridges.':tool.label;
    button.addEventListener('click',()=>chooseTool(tool.type));list.append(button);
  });
  for(const type of ['move','delete','pan']) {const button=$('#tool-'+type);button.setAttribute('aria-pressed',state.selectedTool===type);button.disabled=type!=='pan' && (!!state.team?.completed || state.submitting);}
}
function mapPoint(event) {const p=$('#cityMap').createSVGPoint();p.x=event.clientX;p.y=event.clientY;return p.matrixTransform($('#cityMap').getScreenCTM().inverse());}
function snap(point) {
  let best={x:E.round(point.x),y:E.round(point.y)},limit=20;
  const consider=p=> {const d=E.distance(point,p);if(d<limit){limit=d;best={x:E.round(p.x),y:E.round(p.y)};}};
  // Project onto existing road interiors, including T junctions.
  state.city.roads.forEach(r=> {consider(r.start);consider(r.end);consider(E.project(point,r.start,r.end));});
  return best;
}
function renderTerrain() {
  const line=offset=>Array.from({length:101},(_,i)=>({x:i*10,y:E.riverY(i*10)+offset}));
  const polygon=(a,b)=>'M'+a.map(p=>p.x+','+p.y).join(' L')+' L'+b.reverse().map(p=>p.x+','+p.y).join(' L')+' Z';
  $('#riverShape').setAttribute('d',polygon(line(-32),line(32)));
  $('#floodplainShape').setAttribute('d',polygon(line(-132),line(132)));
}
function renderPreview() {
  const layer=$('#previewLayer');layer.innerHTML='';
  if(state.roadStart) {
    layer.append(svg('circle',{cx:state.roadStart.x,cy:state.roadStart.y,r:8,fill:'#c75c55',stroke:'white','stroke-width':2}));
    if(state.pointer) {
      layer.append(svg('line',{x1:state.roadStart.x,y1:state.roadStart.y,x2:state.pointer.x,y2:state.pointer.y,class:'road-preview'}));
      $('#placementHelp').textContent='New road: '+number(E.distance(state.roadStart,state.pointer))+' m · '+lakhCost(E.roadCost({start:state.roadStart,end:state.pointer}));
    }
  } else if(state.moving && state.pointer)layer.append(svg('circle',{cx:state.pointer.x,cy:state.pointer.y,r:20,class:'move-preview'}));
  if(document.activeElement===$('#cityMap'))layer.append(svg('circle',{cx:state.keyboard.x,cy:state.keyboard.y,r:7,fill:'none',stroke:'#173a3d','stroke-width':2}));
}
function renderMap() {
  const roads=$('#roadLayer'),buildings=$('#buildingLayer');roads.innerHTML='';buildings.innerHTML='';
  state.city.roads.forEach(r=> {
    for(const name of ['road-underlay','road-line','road-dash'])roads.append(svg('line',{x1:r.start.x,y1:r.start.y,x2:r.end.x,y2:r.end.y,class:name}));
  });
  const graph=E.network(state.city);
  graph.nodes.forEach((p,i)=> {if(graph.adj[i].length>=3)roads.append(svg('circle',{cx:p.x,cy:p.y,r:5,class:'road-junction'}));});
  state.city.buildings.forEach((b,i)=> {
    const item=E.catalog[b.type];if(!item)return;
    const marker=svg('g',{transform:'translate('+b.x+' '+b.y+')',class:'building-marker'});
    const title=svg('title');title.textContent=item.label+(graph.links[i]?' · road access':' · no road access');marker.append(title);
    marker.append(svg('circle',{r:17,fill:item.color}));
    if(!graph.links[i])marker.append(svg('circle',{r:23,fill:'none',stroke:'#9b302e','stroke-width':2,'stroke-dasharray':'4 3'}));
    const icon=svg('text',{x:0,y:1,class:'building-icon'});icon.textContent=item.icon;marker.append(icon);
    const label=svg('text',{x:0,y:34,class:'building-label'});label.textContent=item.label;marker.append(label);buildings.append(marker);
  });
  $('#mapEmptyState').classList.toggle('hidden',!!(state.city.roads.length || state.city.buildings.length));
  renderPreview();
}
function updateDashboard() {
  const final=state.team?.completed ? state.team.result : null;
  const metric=final || E.analyze(state.city);state.metrics=metric;
  $('#budgetValue').textContent='₹'+number(metric.budget ?? 100-metric.totalCost)+' Cr';$('#budgetHint').textContent='₹'+number(metric.totalCost)+' Cr allocated of ₹100 Cr';$('#budgetFill').style.width=Math.min(100,metric.totalCost)+'%';
  $('#populationValue').textContent=number(metric.population);$('#accessValue').textContent=metric.access+'%';$('#mobilityValue').textContent=metric.roadScore+'%';$('#resilienceValue').textContent=metric.resilience+'%';$('#emergencyValue').textContent=metric.emergency+'%';
  $('.score-dial').classList.toggle('hidden',!final);$('#scorePreview').textContent=final ? final.score : '';$('.score-dial').style.setProperty('--score-angle',(final?final.score*3.6:0)+'deg');
  $('#roadCount').textContent=state.city.roads.length;$('#assetCount').textContent=state.city.buildings.length;
  $('#planStatus').textContent=final?'SUBMITTED':'PLANNING';$('#runButton').textContent=final?'VIEW FINAL RESULTS →':'RUN CITY SIMULATION →';
  $('#runButton').disabled=state.submitting || (!final && (state.city.roads.length<2 || state.city.buildings.length<5 || !state.city.buildings.some(b=>b.type==='residential')));
  for(const id of ['clearButton','saveButton','undoButton'])$('#'+id).disabled=!!final || state.submitting;
  $('#cityLockedNotice').classList.toggle('hidden',!final);
  const warningList=$('#planningWarnings');warningList.innerHTML='';
  for(const message of metric.warnings || []) {const li=document.createElement('li');li.textContent=message;warningList.append(li);}
  if(!warningList.children.length){const li=document.createElement('li');li.textContent=final?'Final city submitted.':'No service gaps detected in this plan.';warningList.append(li);}
  const panel=$('#capacityRows');panel.innerHTML='';
  for(const [key,service] of Object.entries(metric.coverage || {})) {
    const div=document.createElement('div');div.className='capacity-row';
    const name=E.catalog[key]?.label || key;
    div.innerHTML='<span>'+escapeHtml(name)+'</span><strong>'+service.coverage+'%</strong><small>'+number(service.served)+' / '+number(service.demand)+' demand units served · total capacity '+number(service.capacity)+'</small>';panel.append(div);
  }
}
function renderAll() {renderTools();renderMap();updateDashboard();}
function editAt(raw) {
  const type=state.selectedTool;if(type==='pan')return;
  if(state.submitting || state.team?.completed){showToast('The submitted city is locked.');return;}
  if(raw.x<0 || raw.x>1000 || raw.y<0 || raw.y>650)return;
  const b=state.city.buildings.slice().sort((a,b)=>E.distance(a,raw)-E.distance(b,raw)).find(b=>E.distance(b,raw)<25);
  if(type==='delete') {
    const r=state.city.roads.slice().sort((a,b)=>E.project(raw,a.start,a.end).distance-E.project(raw,b.start,b.end).distance).find(r=>E.project(raw,r.start,r.end).distance<14);
    if(!b && !r)return showToast('Click a building or road to remove it.');
    const next=clone(state.city);if(b)next.buildings=next.buildings.filter(x=>x.id!==b.id);else next.roads=next.roads.filter(x=>x.id!==r.id);
    if(commit(next))showToast('Removed. The construction cost is refunded. Undo is available.');return;
  }
  if(type==='move') {
    if(!state.moving) {if(!b)return showToast('Select a building first.');state.moving=b.id;$('#mapInstruction').textContent='Click a new position for '+E.catalog[b.type].label;return;}
    const next=clone(state.city),target=next.buildings.find(b=>b.id===state.moving);Object.assign(target,snap(raw));if(commit(next)){state.moving=null;renderPreview();$('#mapInstruction').textContent='Building moved. Choose another building to move.';}return;
  }
  const p=snap(raw);
  if(type==='road') {
    if(!state.roadStart){state.roadStart=p;$('#mapInstruction').textContent='Click the road destination. Escape cancels.';renderPreview();return;}
    const next=clone(state.city);next.roads.push({id:crypto.randomUUID(),start:state.roadStart,end:p});
    if(commit(next)){state.roadStart=null;state.pointer=null;renderPreview();$('#mapInstruction').textContent='Road added. Click the next start point.';$('#placementHelp').textContent='Roads snap to junctions and existing road interiors.';}return;
  }
  if(E.catalog[type]) {const next=clone(state.city);next.buildings.push({id:crypto.randomUUID(),type,...p});if(commit(next))$('#mapInstruction').textContent=E.catalog[type].label+' placed.';}
}
function applyView() {
  const v=state.view;v.x=Math.max(0,Math.min(1000-v.w,v.x));v.y=Math.max(0,Math.min(650-v.h,v.y));
  $('#cityMap').setAttribute('viewBox',[v.x,v.y,v.w,v.h].join(' '));$('#zoomValue').textContent=Math.round(1000/v.w*100)+'%';
}
function zoom(factor) {const v=state.view,w=Math.max(250,Math.min(1000,v.w*factor)),h=w*.65;state.view={x:v.x+(v.w-w)/2,y:v.y+(v.h-h)/2,w,h};applyView();}
function setupMap() {
  const map=$('#cityMap');let pan=null,suppressClick=false;
  document.addEventListener('pointerdown',event=> {
    if(event.button!==0 || !state.roadStart)return;
    const target=event.target;
    if(target instanceof Element && target.closest('#cityMap'))return;
    cancelActiveAction();
  });
  map.addEventListener('pointerdown',event=> {
    if(state.selectedTool!=='pan')return;map.setPointerCapture(event.pointerId);
    pan={x:event.clientX,y:event.clientY,v:{...state.view},scale:map.getScreenCTM().a};suppressClick=false;
  });
  map.addEventListener('pointermove',event=> {
    if(pan){const dx=(event.clientX-pan.x)/pan.scale,dy=(event.clientY-pan.y)/pan.scale;state.view={...pan.v,x:pan.v.x-dx,y:pan.v.y-dy};applyView();suppressClick=true;return;}
    if(state.roadStart || state.moving){state.pointer=snap(mapPoint(event));renderPreview();}
  });
  map.addEventListener('pointerup',()=>{pan=null;});
  map.addEventListener('pointercancel',()=>{pan=null;});
  map.addEventListener('click',event=>{if(suppressClick){suppressClick=false;return;}editAt(mapPoint(event));});
  map.addEventListener('keydown',event=> {
    const delta={ArrowLeft:[-10,0],ArrowRight:[10,0],ArrowUp:[0,-10],ArrowDown:[0,10]}[event.key];
    if(delta){event.preventDefault();state.keyboard.x=Math.max(0,Math.min(1000,state.keyboard.x+delta[0]));state.keyboard.y=Math.max(0,Math.min(650,state.keyboard.y+delta[1]));state.pointer=state.keyboard;renderPreview();}
    if(event.key==='Enter'){event.preventDefault();editAt(state.keyboard);}
    if(event.key==='Escape'){cancelActiveAction();renderTools();}
  });
  map.addEventListener('focus',renderPreview);map.addEventListener('blur',renderPreview);
  for(const type of ['move','delete','pan'])$('#tool-'+type).addEventListener('click',()=>chooseTool(type));
  $('#zoomIn').addEventListener('click',()=>zoom(.8));$('#zoomOut').addEventListener('click',()=>zoom(1.25));$('#zoomFit').addEventListener('click',()=>{state.view={x:0,y:0,w:1000,h:650};applyView();});
  $('#floodLayerToggle').addEventListener('change',event=>$('#floodplainShape').classList.toggle('hidden',!event.target.checked));
  $('#undoButton').addEventListener('click',()=>{if(state.submitting || state.team?.completed)return;const prev=state.history.pop();if(prev){state.city=prev;state.moving=null;state.roadStart=null;renderAll();scheduleSave();}});
  $('#clearButton').addEventListener('click',()=>{if(confirm('Clear the draft city? You can undo this while this page is open.'))commit({roads:[],buildings:[]});});
  for(const id of ['saveButton','retrySave'])$('#'+id).addEventListener('click',()=>saveCity().catch(e=>showToast(e.message)));
  $('#useServerDraft').addEventListener('click',()=>resolveConflict(false));$('#useLocalDraft').addEventListener('click',()=>resolveConflict(true));
  renderTerrain();
}
function openModal(html) {$('#modalContent').innerHTML=html;$('#simulationModal').classList.remove('hidden');$('#closeModal').focus();}
function closeModal() {if(state.submitting)return;$('#simulationModal').classList.add('hidden');$('#runButton').focus();}
function renderEvent(event) {
  const layer=$('#eventLayer');layer.innerHTML='';
  if(event.key==='flood') {const copy=$('#floodplainShape').cloneNode();copy.removeAttribute('id');copy.classList.remove('hidden');copy.style.opacity='.45';layer.append(copy);}
  if(event.route?.length)layer.append(svg('polyline',{points:event.route.map(p=>p.x+','+p.y).join(' '),class:'event-route'}));
  if(event.target)layer.append(svg('circle',{cx:event.target.x,cy:event.target.y,r:26,class:'event-target'}));
  $('#placementHelp').textContent=event.name+': '+event.note;
  closeModal();state.view={x:0,y:0,w:1000,h:650};applyView();
}
function showResults(result) {
  openModal('<p class="eyebrow">Final simulation · rules '+escapeHtml(result.version || '1.0')+'</p><h2>Your city scored '+result.score+' / 100</h2><p>Engineering plan and five deterministic stress tests. Event average: '+result.eventAverage+'.</p><div class="event-results">'+result.events.map((event,i)=>'<div class="event-row"><span>'+event.icon+'</span><div><span class="event-name">'+escapeHtml(event.name)+'</span><small class="event-note">'+escapeHtml(event.note)+'</small><button class="view-event" data-event="'+i+'">Show on map</button></div><b>'+event.score+'</b><div class="event-bar"><span style="width:'+event.score+'%"></span></div></div>').join('')+'</div><button class="primary-btn" id="resultsDone">Back to city</button>');
  $('#resultsDone').addEventListener('click',closeModal);$('#modalContent').querySelectorAll('[data-event]').forEach(b=>b.addEventListener('click',()=>renderEvent(result.events[Number(b.dataset.event)])));
}
function openSimulation() {
  if(state.team?.completed)return showResults(state.team.result);
  openModal('<p class="eyebrow">Final submission</p><h2>Run city simulation?</h2><p>Flood, ambulance, fire, traffic and waste events will test your saved plan.</p><div class="sim-warning">One final run per team. The city locks after submission.</div><p id="submissionError" role="alert"></p><div class="modal-actions"><button id="cancelSimulation" class="quiet-btn">Keep planning</button><button id="confirmSimulation" class="primary-btn">Submit city</button></div>');
  $('#cancelSimulation').addEventListener('click',closeModal);$('#confirmSimulation').addEventListener('click',runSimulation);
}
async function runSimulation() {
  if(state.submitting)return;state.submitting=true;renderTools();updateDashboard();$('#confirmSimulation').disabled=true;$('#confirmSimulation').textContent='Testing city…';$('#submissionError').textContent='';
  try {
    await saveCity();
    const data=await request('/api/team/simulate',{method:'POST',body:JSON.stringify({city:state.city,revision:state.team.revision || 0})});
    storage.remove(draftKey());state.dirty=false;state.submitting=false;showApp(data.team,false);showResults(data.result);
  } catch(error) {
    state.submitting=false;if(error.status===409)state.conflict=true;keepDraft();$('#submissionError').textContent=error.message;$('#confirmSimulation').disabled=false;$('#confirmSimulation').textContent='Retry submission';saveMessage(error.message,true);renderTools();updateDashboard();
  }
}
function showApp(team,restore=true) {
  state.team=team;state.city=clone(team.city);state.history=[];state.roadStart=null;state.moving=null;state.dirty=false;state.conflict=false;
  $('#eventLayer').innerHTML='';state.pointer=null;state.view={x:0,y:0,w:1000,h:650};applyView();
  if(team.completed)storage.remove(draftKey());
  if(restore && !team.completed) {
    try {const draft=JSON.parse(storage.get(draftKey()));if(draft?.city){state.city=draft.city;state.dirty=true;state.conflict=draft.revision!==(team.revision || 0);}}catch{}
  }
  $('#authShell').classList.add('hidden');$('#appShell').classList.remove('hidden');$('#backHome').classList.remove('hidden');$('#returnToPlan').classList.add('hidden');$('#resumeLogin').classList.add('hidden');
  $('#teamNameDisplay').textContent=team.teamName;$('#teamLeaderDisplay').textContent=team.leaderName;$('#teamInitial').textContent=team.teamName.charAt(0);
  renderAll();chooseTool(team.completed?'pan':'road');
  saveMessage(team.completed?'Final submission saved.':state.dirty?'Recovered an unsaved draft on this device. Review it, then retry saving.':'Saved to event server.',state.dirty);
}
function showAuthPage() {
  keepDraft();$('#appShell').classList.add('hidden');$('#backHome').classList.add('hidden');$('#authShell').classList.remove('hidden');$('#returnToPlan').classList.toggle('hidden',!state.token);
}
async function loadTeam() {
  if(!state.token)return;
  try {const data=await request('/api/team/me');showApp(data.team);}
  catch(error){if(error.status===401 || error.status===404){storage.remove('citySimTeamToken');state.token='';}showAuthPage();$('#authError').textContent=error.message;throw error;}
}
function setupAuth() {
  let registerMode=true;
  function mode() {
    document.querySelectorAll('.register-only').forEach(el=>el.classList.toggle('hidden',!registerMode));
    $('#authTitle').textContent=registerMode?'Create your team':'Welcome back';$('#authDescription').textContent=registerMode?'Use the team name and one-time code issued by your organizer.':'Sign in to resume your city or view its final results.';
    $('#authSubmit').textContent=registerMode?'Create team & start building':'Sign in to city';$('#authMode').textContent=registerMode?'Already registered? Sign in':'New team? Register here';
  }
  $('#authMode').addEventListener('click',()=>{registerMode=!registerMode;mode();$('#authError').textContent='';});
  $('#authForm').addEventListener('submit',async event=> {
    event.preventDefault();$('#authError').textContent='';$('#authSubmit').disabled=true;
    const body={email:$('#email').value.trim(),password:$('#password').value,teamName:$('#teamName').value.trim(),leaderName:$('#leaderName').value.trim(),registrationCode:$('#registrationCode').value.trim()};
    try {
      if(state.savePromise)await state.savePromise.catch(()=>{});
      const data=await request('/api/auth/team/'+(registerMode?'register':'login'),{method:'POST',body:JSON.stringify(body)});
      state.token=data.token;storage.set('citySimTeamToken',data.token);$('#password').value='';showApp(data.team);
    } catch(error){$('#authError').textContent=error.message;}
    finally {$('#authSubmit').disabled=false;mode();}
  });
  $('#backHome').addEventListener('click',event=>{event.preventDefault();showAuthPage();});
  $('#returnToPlan').addEventListener('click',()=>loadTeam().catch(()=>{}));
  $('#resumeLogin').addEventListener('click',()=>{showAuthPage();registerMode=false;mode();});
  mode();
}
function init() {
  setupAuth();setupMap();$('#runButton').addEventListener('click',openSimulation);$('#closeModal').addEventListener('click',closeModal);
  $('#simulationModal').addEventListener('click',e=>{if(e.target===$('#simulationModal'))closeModal();});
  document.addEventListener('keydown',e=>{if(e.key==='Escape' && !$('#simulationModal').classList.contains('hidden'))closeModal();});
  window.addEventListener('beforeunload',event=>{if(state.dirty){keepDraft();event.preventDefault();event.returnValue='';}});
  window.addEventListener('online',()=>{if(state.dirty && !state.conflict)saveCity().catch(()=>{});});
  if(location.protocol==='file:'){$('#authError').textContent='Start the event server with npm start, then open http://localhost:3001.';return;}
  if(new URLSearchParams(location.search).get('home')==='1'){showAuthPage();return;}
  loadTeam().catch(()=>{});
}
init();
