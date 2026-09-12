const state = {
  token: localStorage.getItem('citySimTeamToken') || '',
  team: null,
  city: { roads: [], buildings: [] },
  catalog: {},
  roadCost: 2,
  selectedTool: null,
  roadStart: null,
  pointer: null,
  history: [],
  lastSaved: { roads: [], buildings: [] },
  saveTimer: null,
  saveInFlight: false
};

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => document.querySelectorAll(selector);
const svg = (name, attrs = {}) => {
  const element = document.createElementNS('http://www.w3.org/2000/svg', name);
  Object.entries(attrs).forEach(([key, value]) => element.setAttribute(key, value));
  return element;
};
const clone = (value) => JSON.parse(JSON.stringify(value));
const formatNumber = (value) => Number(value || 0).toLocaleString('en-IN');
const escapeHtml = (value) => String(value || '').replace(/[&<>'"]/g, (char) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#39;', '"':'&quot;' }[char]));

async function request(url, options = {}) {
  const headers = { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...(options.headers || {}) };
  if (state.token) headers.Authorization = `Bearer ${state.token}`;
  const response = await fetch(url, { ...options, headers });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Something went wrong. Please try again.');
  return data;
}

function fallbackCatalog() {
  return {
    residential:{label:'Residential area',icon:'⌂',cost:6,population:9000,color:'#e66d65'}, commercial:{label:'Commercial area',icon:'▥',cost:8,population:1200,color:'#f1a24b'}, industrial:{label:'Industrial area',icon:'⚙',cost:12,population:400,color:'#8774d8'}, hospital:{label:'Hospital',icon:'✚',cost:12,color:'#d94f5c'}, school:{label:'School / college',icon:'▣',cost:8,color:'#4e8edb'}, fire:{label:'Fire station',icon:'♨',cost:7,color:'#ef6e56'}, park:{label:'Park',icon:'♣',cost:4,color:'#50a96e'}, water:{label:'Water plant',icon:'◉',cost:14,color:'#3189b9'}, power:{label:'Power plant',icon:'ϟ',cost:16,color:'#e5b83b'}, bus:{label:'Bus depot',icon:'▰',cost:6,color:'#e48e3f'}, waste:{label:'Waste facility',icon:'♻',cost:10,color:'#699a5d'}, drainage:{label:'Drainage network',icon:'≈',cost:9,color:'#498fc0'}, sensor:{label:'Smart sensor',icon:'◌',cost:2,color:'#6d91aa'}, solar:{label:'Solar field',icon:'☀',cost:8,color:'#d7a831'}, hotel:{label:'Hotel',icon:'H',cost:5,color:'#b3779a'}, restaurant:{label:'Restaurant',icon:'R',cost:3,color:'#b97145'}
  };
}

function count(type) { return state.city.buildings.filter((item) => item.type === type).length; }
function distToSegment(point, start, end) {
  const dx = end.x - start.x; const dy = end.y - start.y;
  if (!dx && !dy) return Math.hypot(point.x - start.x, point.y - start.y);
  const t = Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(point.x - (start.x + t * dx), point.y - (start.y + t * dy));
}
function calculateMetrics() {
  const totalCost = state.city.roads.length * state.roadCost + state.city.buildings.reduce((sum, building) => sum + (state.catalog[building.type]?.cost || 0), 0);
  const population = state.city.buildings.reduce((sum, building) => sum + (state.catalog[building.type]?.population || 0), 0);
  const linked = state.city.buildings.filter((building) => state.city.roads.some((road) => distToSegment(building, road.start, road.end) <= 42)).length;
  const access = state.city.buildings.length ? Math.round(linked / state.city.buildings.length * 100) : 0;
  const roadScore = Math.min(100, Math.round(state.city.roads.length * 18 + count('bus') * 10 + access * .3));
  const emergency = Math.min(100, Math.round((count('hospital') + count('fire')) * 32 + access * .42 + Math.min(state.city.roads.length * 4, 24)));
  const utilityTypes = ['water','power','drainage','waste'];
  const resilience = Math.min(100, Math.round(utilityTypes.filter((type) => count(type)).length / 4 * 60 + count('sensor') * 7 + count('park') * 6 + count('solar') * 8));
  const housing = count('residential'); const jobs = count('commercial') + count('industrial');
  const planning = Math.min(100, Math.round(Math.min(housing * 18, 45) + Math.min(jobs * 12, 32) + Math.min(count('school') * 12, 12) + Math.min(count('hotel') + count('restaurant'), 4) * 3));
  const affordability = totalCost <= 100 ? Math.max(45, Math.min(100, 100 - Math.max(0, totalCost - 75) * 2)) : 0;
  const score = Math.max(0, Math.min(100, Math.round(roadScore*.22 + emergency*.22 + resilience*.28 + planning*.18 + affordability*.10)));
  return { totalCost, budget:Math.max(0,100-totalCost), population, access, roadScore, emergency, resilience, planning, score };
}
function getMapPoint(event) {
  const map = $('#cityMap'); const rect = map.getBoundingClientRect();
  const scale = Math.min(rect.width / 1000, rect.height / 650);
  const xOffset = (rect.width - 1000 * scale) / 2; const yOffset = (rect.height - 650 * scale) / 2;
  const x = (event.clientX - rect.left - xOffset) / scale; const y = (event.clientY - rect.top - yOffset) / scale;
  return { x: Math.max(0, Math.min(1000, Math.round(x))), y: Math.max(0, Math.min(650, Math.round(y))) };
}
function snapPoint(point) {
  const targets = state.city.roads.flatMap((road) => [road.start, road.end]).concat(state.city.buildings.map((building) => ({ x:building.x, y:building.y })));
  let nearest = null; let distance = 34;
  targets.forEach((target) => { const candidate = Math.hypot(point.x - target.x, point.y - target.y); if (candidate < distance) { distance = candidate; nearest = target; } });
  return nearest ? { x:nearest.x, y:nearest.y } : point;
}
function labelFor(type) { return state.catalog[type]?.label || type; }
function renderTools() {
  const tools = [{ type:'road', label:'Draw road', icon:'━', cost:state.roadCost, color:'#536e6a' }].concat(Object.entries(state.catalog).map(([type, item]) => ({ type, ...item })));
  const list = $('#toolList'); list.innerHTML = '';
  tools.forEach((tool) => {
    const button = document.createElement('button'); button.type = 'button'; button.className = `tool-button ${state.selectedTool === tool.type ? 'active' : ''}`; button.disabled = Boolean(state.team?.completed);
    button.style.setProperty('--tool-color', tool.color); button.innerHTML = `<span class="tool-symbol">${tool.icon}</span><span>${escapeHtml(tool.label)}</span><span class="tool-cost">₹${tool.cost} Cr</span>`;
    button.addEventListener('click', () => { if (!state.team.completed) { state.selectedTool = tool.type; state.roadStart = null; $('#mapInstruction').textContent = tool.type === 'road' ? 'Click the map twice to draw a connected road' : `Click the map to place ${tool.label}`; renderTools(); renderMap(); } });
    list.append(button);
  });
}
function renderMap() {
  const roadLayer = $('#roadLayer'); const buildingLayer = $('#buildingLayer'); const previewLayer = $('#previewLayer'); roadLayer.innerHTML = ''; buildingLayer.innerHTML = ''; previewLayer.innerHTML = '';
  state.city.roads.forEach((road) => {
    roadLayer.append(svg('line', { x1:road.start.x, y1:road.start.y, x2:road.end.x, y2:road.end.y, class:'road-underlay' }));
    roadLayer.append(svg('line', { x1:road.start.x, y1:road.start.y, x2:road.end.x, y2:road.end.y, class:'road-line' }));
    roadLayer.append(svg('line', { x1:road.start.x, y1:road.start.y, x2:road.end.x, y2:road.end.y, class:'road-dash' }));
    [road.start, road.end].forEach((point) => roadLayer.append(svg('circle', { cx:point.x, cy:point.y, r:4.5, class:'road-junction' })));
  });
  if (state.selectedTool === 'road' && state.roadStart && state.pointer) previewLayer.append(svg('line', { x1:state.roadStart.x, y1:state.roadStart.y, x2:state.pointer.x, y2:state.pointer.y, class:'road-preview' }));
  state.city.buildings.forEach((building) => {
    const item = state.catalog[building.type]; if (!item) return;
    const marker = svg('g', { transform:`translate(${building.x} ${building.y})`, class:'building-marker', filter:'url(#softShadow)' });
    marker.append(svg('circle', { r:17, fill:item.color }));
    const icon = svg('text', { x:0, y:1, class:'building-icon' }); icon.textContent = item.icon; marker.append(icon);
    const label = svg('text', { x:0, y:34, class:'building-label' }); label.textContent = item.label; marker.append(label); buildingLayer.append(marker);
  });
  $('#mapEmptyState').classList.toggle('hidden', Boolean(state.city.roads.length || state.city.buildings.length));
}
function updateDashboard() {
  const metric = calculateMetrics();
  $('#budgetValue').textContent = `₹${metric.budget} Cr`; $('#budgetHint').textContent = `₹${metric.totalCost} Cr allocated of ₹100 Cr`; $('#budgetFill').style.width = `${Math.min(100, metric.totalCost)}%`;
  $('#populationValue').textContent = formatNumber(metric.population); $('#accessValue').textContent = `${metric.access}%`; $('#mobilityValue').textContent = metric.roadScore; $('#resilienceValue').textContent = metric.resilience; $('#emergencyValue').textContent = metric.emergency;
  $('#scorePreview').textContent = '—';
  $('.score-dial').style.setProperty('--score-angle', '0deg');
  $('.score-dial small').textContent = 'revealed when you run the simulation';
  $('#roadCount').textContent = state.city.roads.length; $('#assetCount').textContent = state.city.buildings.length;
  $('#planStatus').textContent = state.team?.completed ? 'SUBMITTED' : 'PLANNING'; $('#planStatus').classList.toggle('submitted', Boolean(state.team?.completed)); $('#runButton').innerHTML = state.team?.completed ? 'VIEW FINAL RESULTS <span>→</span>' : 'RUN CITY SIMULATION <span>→</span>';
  $('#runButton').disabled = !state.team?.completed && (state.city.roads.length < 2 || state.city.buildings.length < 5);
  $('#clearButton').disabled = Boolean(state.team?.completed); $('#saveButton').disabled = Boolean(state.team?.completed);
}
function renderAll() { renderTools(); renderMap(); updateDashboard(); }
function showToast(message) { const toast = $('#toast'); toast.textContent = message; toast.classList.add('visible'); clearTimeout(showToast.timer); showToast.timer = setTimeout(() => toast.classList.remove('visible'), 3100); }
function pushHistory() { state.history.push(clone(state.city)); if (state.history.length > 60) state.history.shift(); }
function localCostFor(tool) { return tool === 'road' ? state.roadCost : state.catalog[tool]?.cost || 0; }
function scheduleSave() { clearTimeout(state.saveTimer); $('#saveStatus').textContent = 'Saving city plan…'; state.saveTimer = setTimeout(saveCity, 350); }
async function saveCity() {
  if (!state.team || state.team.completed || state.saveInFlight) return;
  state.saveInFlight = true; const snapshot = clone(state.city);
  try {
    const response = await request('/api/team/city', { method:'PUT', body:JSON.stringify({ city:snapshot }) });
    state.lastSaved = clone(snapshot); $('#saveStatus').textContent = 'Plan saved. Keep building when you are ready.';
    if (response.metrics) updateDashboard();
    if (JSON.stringify(snapshot) !== JSON.stringify(state.city)) scheduleSave();
  } catch (error) {
    state.city = clone(state.lastSaved); renderAll(); $('#saveStatus').textContent = 'The latest edit could not be saved.'; showToast(error.message);
  } finally { state.saveInFlight = false; }
}
function addRoad(point) {
  const snapped = snapPoint(point);
  if (!state.roadStart) { state.roadStart = snapped; $('#mapInstruction').textContent = 'Now click the destination to complete the road'; renderMap(); return; }
  if (Math.hypot(state.roadStart.x - snapped.x, state.roadStart.y - snapped.y) < 28) { showToast('Choose a destination farther from the starting point.'); return; }
  if (calculateMetrics().totalCost + state.roadCost > 100) { showToast('This road would exceed the ₹100 Cr budget.'); return; }
  pushHistory(); state.city.roads.push({ id:`road-${Date.now()}`, start:state.roadStart, end:snapped }); state.roadStart = null; state.pointer = null; $('#mapInstruction').textContent = 'Road added. Click a tool to continue building.'; renderAll(); scheduleSave();
}
function addBuilding(point) {
  const type = state.selectedTool; const cost = localCostFor(type); if (!state.catalog[type]) return;
  if (calculateMetrics().totalCost + cost > 100) { showToast(`${labelFor(type)} would exceed the ₹100 Cr budget.`); return; }
  const position = snapPoint(point); const tooClose = state.city.buildings.some((building) => Math.hypot(building.x - position.x, building.y - position.y) < 34);
  if (tooClose) { showToast('Leave a little space between infrastructure assets.'); return; }
  pushHistory(); state.city.buildings.push({ id:`building-${Date.now()}`, type, x:position.x, y:position.y }); $('#mapInstruction').textContent = `${labelFor(type)} placed. Click again to add another.`; renderAll(); scheduleSave();
}
function setupMap() {
  const map = $('#cityMap');
  map.addEventListener('pointermove', (event) => { if (state.roadStart) { state.pointer = snapPoint(getMapPoint(event)); renderMap(); } });
  map.addEventListener('pointerleave', () => { if (state.pointer) { state.pointer = null; renderMap(); } });
  map.addEventListener('click', (event) => {
    if (state.team?.completed) return showToast('This submitted city is locked after its final simulation.');
    if (!state.selectedTool) return showToast('Choose a construction tool first.');
    const point = getMapPoint(event); state.selectedTool === 'road' ? addRoad(point) : addBuilding(point);
  });
  $('#undoButton').addEventListener('click', () => { if (state.team?.completed) return; const previous = state.history.pop(); if (!previous) return showToast('There is no unsaved construction step to undo.'); state.city = previous; state.roadStart = null; renderAll(); scheduleSave(); });
  $('#clearButton').addEventListener('click', () => { if (state.team?.completed) return; if (!state.city.roads.length && !state.city.buildings.length) return; if (window.confirm('Clear every road and infrastructure asset from this draft?')) { pushHistory(); state.city = { roads:[], buildings:[] }; state.roadStart = null; renderAll(); scheduleSave(); } });
  $('#saveButton').addEventListener('click', () => { clearTimeout(state.saveTimer); saveCity(); });
}
function openModal(content) { $('#modalContent').innerHTML = content; $('#simulationModal').classList.remove('hidden'); }
function closeModal() { $('#simulationModal').classList.add('hidden'); }
function goHome() {
  closeModal();
  localStorage.removeItem('citySimTeamToken');
  state.token = ''; state.team = null; state.city = { roads:[], buildings:[] };
  $('#appShell').classList.add('hidden'); $('#authShell').classList.remove('hidden');
  $('#email').value = ''; $('#password').value = '';
}
function resultMarkup(result) {
  const events = result.events.map((event) => `<div class="event-row"><span>${event.icon}</span><div><span class="event-name">${event.name}</span><small class="event-note">${event.note}</small></div><b>${event.score}</b><div class="event-bar"><span style="width:${event.score}%;--event-color:${event.score >= 70 ? '#5c9f69' : '#e9b950'}"></span></div></div>`).join('');
  return `<p class="eyebrow">Final city simulation</p><h2>Your city scored<br><em>${result.score} / 100</em></h2><p>The final score combines your engineering plan and how it behaved under five live stress tests.</p><div class="results-score"><strong>${result.score}</strong><span>engineering score<br>event average: ${result.eventAverage}</span></div><div class="event-results">${events}</div><div class="modal-actions"><button class="quiet-btn" id="resultsHome" type="button">Back to home</button><button class="primary-btn" id="resultsDone" type="button">Back to city plan</button></div>`;
}
function openSimulation() {
  if (state.team.completed && state.team.result) { openModal(resultMarkup(state.team.result)); $('#resultsDone').addEventListener('click', closeModal); $('#resultsHome').addEventListener('click', goHome); return; }
  openModal(`<p class="eyebrow">Ready for final submission?</p><h2>Run the city<br><em>simulation.</em></h2><p>Your city will be stress-tested for floods, ambulance response, fire access, traffic and waste capacity.</p><div class="sim-warning">This is your team’s one final run. Once submitted, roads and infrastructure will be locked and the score will appear in the administrator dashboard.</div><div class="modal-actions"><button class="quiet-btn" id="cancelSimulation" type="button">Keep planning</button><button class="primary-btn" id="confirmSimulation" type="button">Submit city</button></div>`);
  $('#cancelSimulation').addEventListener('click', closeModal); $('#confirmSimulation').addEventListener('click', runSimulation);
}
async function runSimulation() {
  const button = $('#confirmSimulation'); button.disabled = true; button.textContent = 'Running events…';
  try { await saveCity(); const response = await request('/api/team/simulate', { method:'POST', body:JSON.stringify({ city:state.city }) }); state.team = response.team; state.city = clone(response.team.city); state.lastSaved = clone(state.city); renderAll(); openModal(resultMarkup(response.result)); $('#resultsDone').addEventListener('click', closeModal); $('#resultsHome').addEventListener('click', goHome); } catch (error) { showToast(error.message); button.disabled = false; button.textContent = 'Try final simulation again'; }
}
function showApp(team) {
  state.team = team; state.city = clone(team.city || { roads:[], buildings:[] }); state.lastSaved = clone(state.city); state.history = []; $('#authShell').classList.add('hidden'); $('#appShell').classList.remove('hidden'); $('#teamNameDisplay').textContent = team.teamName; $('#teamLeaderDisplay').textContent = team.leaderName; $('#teamInitial').textContent = team.teamName.slice(0,1).toUpperCase(); $('#mapInstruction').textContent = team.completed ? 'Final city plan · submitted for evaluation' : 'Choose a tool to begin building'; renderAll(); if (team.completed && team.result) setTimeout(() => openSimulation(), 250);
}
async function loadTeam() {
  if (!state.token) return;
  try { const response = await request('/api/team/me'); state.catalog = response.catalog || fallbackCatalog(); state.roadCost = response.roadCost || 2; showApp(response.team); } catch (error) { localStorage.removeItem('citySimTeamToken'); state.token = ''; }
}
function setupAuth() {
  let registerMode = true;
  const applyMode = () => { $$('.register-only').forEach((field) => field.classList.toggle('hidden', !registerMode)); $('#teamName').required = registerMode; $('#leaderName').required = registerMode; $('#authTitle').textContent = registerMode ? 'Create your team' : 'Welcome back'; $('#authDescription').textContent = registerMode ? 'Registration reserves one final simulation for your team.' : 'Sign in to continue your city plan or view your completed score.'; $('#authSubmit').textContent = registerMode ? 'Create team & start building' : 'Sign in to city plan'; $('#authMode').textContent = registerMode ? 'Already registered? Sign in' : 'New team? Register here'; $('#authError').textContent = ''; };
  $('#authMode').addEventListener('click', () => { registerMode = !registerMode; applyMode(); });
  $('#authForm').addEventListener('submit', async (event) => {
    event.preventDefault(); const error = $('#authError'); error.textContent = ''; const body = { email:$('#email').value.trim(), password:$('#password').value };
    if (registerMode) { body.teamName = $('#teamName').value.trim(); body.leaderName = $('#leaderName').value.trim(); }
    const button = $('#authSubmit'); button.disabled = true; button.textContent = registerMode ? 'Creating team…' : 'Signing in…';
    try { const response = await request(`/api/auth/team/${registerMode ? 'register' : 'login'}`, { method:'POST', body:JSON.stringify(body) }); state.token = response.token; localStorage.setItem('citySimTeamToken', state.token); state.catalog = fallbackCatalog(); await loadTeam(); } catch (err) { error.textContent = err.message; } finally { button.disabled = false; applyMode(); }
  });
  applyMode();
}
function setupModal() { $('#closeModal').addEventListener('click', closeModal); $('#simulationModal').addEventListener('click', (event) => { if (event.target === $('#simulationModal')) closeModal(); }); }
function init() { state.catalog = fallbackCatalog(); setupAuth(); setupMap(); setupModal(); $('#runButton').addEventListener('click', openSimulation); loadTeam(); }
init();