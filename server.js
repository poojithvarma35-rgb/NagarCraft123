const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const express = require('express');

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_DIR = path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'city-sim.json');
const SESSION_TTL = 1000 * 60 * 60 * 8;
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'admin@citysim.local';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';

const BUILDINGS = {
  residential: { label: 'Residential area', icon: '⌂', cost: 6, population: 9000, color: '#e66d65' },
  commercial: { label: 'Commercial area', icon: '▥', cost: 8, population: 1200, color: '#f1a24b' },
  industrial: { label: 'Industrial area', icon: '⚙', cost: 12, population: 400, color: '#8774d8' },
  hospital: { label: 'Hospital', icon: '✚', cost: 12, color: '#d94f5c' },
  school: { label: 'School / college', icon: '▣', cost: 8, color: '#4e8edb' },
  fire: { label: 'Fire station', icon: '♨', cost: 7, color: '#ef6e56' },
  park: { label: 'Park', icon: '♣', cost: 4, color: '#50a96e' },
  water: { label: 'Water plant', icon: '◉', cost: 14, color: '#3189b9' },
  power: { label: 'Power plant', icon: 'ϟ', cost: 16, color: '#e5b83b' },
  bus: { label: 'Bus depot', icon: '▰', cost: 6, color: '#e48e3f' },
  waste: { label: 'Waste facility', icon: '♻', cost: 10, color: '#699a5d' },
  drainage: { label: 'Drainage network', icon: '≈', cost: 9, color: '#498fc0' },
  sensor: { label: 'Smart sensor', icon: '◌', cost: 2, color: '#6d91aa' },
  solar: { label: 'Solar field', icon: '☀', cost: 8, color: '#d7a831' },
  hotel: { label: 'Hotel', icon: 'H', cost: 5, color: '#b3779a' },
  restaurant: { label: 'Restaurant', icon: 'R', cost: 3, color: '#b97145' }
};
const ROAD_COST = 2;

function initialDb() {
  return { teams: [], sessions: [] };
}
function readDb() {
  try {
    if (!fs.existsSync(DATA_FILE)) return initialDb();
    const parsed = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    return { teams: Array.isArray(parsed.teams) ? parsed.teams : [], sessions: Array.isArray(parsed.sessions) ? parsed.sessions : [] };
  } catch (error) {
    console.error('Could not read data store:', error.message);
    return initialDb();
  }
}
function writeDb(db) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 2), 'utf8');
}
function cleanText(value, max = 80) {
  return String(value || '').trim().replace(/[<>]/g, '').slice(0, max);
}
function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.scryptSync(String(password), salt, 64).toString('hex');
  return `${salt}:${hash}`;
}
function checkPassword(password, stored) {
  const [salt, hash] = String(stored || '').split(':');
  if (!salt || !hash) return false;
  const test = crypto.scryptSync(String(password), salt, 64).toString('hex');
  return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(test, 'hex'));
}
function tokenFor(db, kind, subjectId) {
  db.sessions = db.sessions.filter((s) => s.expiresAt > Date.now());
  const token = crypto.randomBytes(32).toString('hex');
  db.sessions.push({ token, kind, subjectId, expiresAt: Date.now() + SESSION_TTL });
  writeDb(db);
  return token;
}
function auth(kind) {
  return (req, res, next) => {
    const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    const db = readDb();
    const session = db.sessions.find((s) => s.token === token && s.kind === kind && s.expiresAt > Date.now());
    if (!session) return res.status(401).json({ error: 'Your session has ended. Please sign in again.' });
    req.db = db;
    req.session = session;
    next();
  };
}
function validPoint(point) {
  return point && Number.isFinite(Number(point.x)) && Number.isFinite(Number(point.y)) && Number(point.x) >= 0 && Number(point.x) <= 1000 && Number(point.y) >= 0 && Number(point.y) <= 650;
}
function normalizeCity(input) {
  const city = input && typeof input === 'object' ? input : {};
  const roads = Array.isArray(city.roads) ? city.roads.slice(0, 80) : [];
  const buildings = Array.isArray(city.buildings) ? city.buildings.slice(0, 80) : [];
  const safeRoads = roads.map((road, index) => ({
    id: cleanText(road.id, 40) || `road-${index}`,
    start: { x: Math.round(Number(road.start && road.start.x)), y: Math.round(Number(road.start && road.start.y)) },
    end: { x: Math.round(Number(road.end && road.end.x)), y: Math.round(Number(road.end && road.end.y)) }
  })).filter((road) => validPoint(road.start) && validPoint(road.end) && (road.start.x !== road.end.x || road.start.y !== road.end.y));
  const safeBuildings = buildings.map((building, index) => ({
    id: cleanText(building.id, 40) || `building-${index}`,
    type: cleanText(building.type, 30),
    x: Math.round(Number(building.x)),
    y: Math.round(Number(building.y))
  })).filter((building) => BUILDINGS[building.type] && validPoint(building));
  return { roads: safeRoads, buildings: safeBuildings };
}
function distToSegment(point, start, end) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  if (dx === 0 && dy === 0) return Math.hypot(point.x - start.x, point.y - start.y);
  const t = Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(point.x - (start.x + t * dx), point.y - (start.y + t * dy));
}
function nearbyRoad(point, roads) {
  return roads.some((road) => distToSegment(point, road.start, road.end) <= 42);
}
function connectedRoadCount(roads) {
  if (roads.length < 2) return roads.length;
  let connected = 0;
  for (let i = 0; i < roads.length; i += 1) {
    const candidate = roads[i];
    const endpoints = [candidate.start, candidate.end];
    if (roads.some((other, j) => j !== i && endpoints.some((p) => [other.start, other.end].some((q) => Math.hypot(p.x - q.x, p.y - q.y) < 55)))) connected += 1;
  }
  return connected;
}
function count(city, type) { return city.buildings.filter((b) => b.type === type).length; }
function cityMetrics(input) {
  const city = normalizeCity(input);
  const totalCost = city.roads.length * ROAD_COST + city.buildings.reduce((sum, item) => sum + BUILDINGS[item.type].cost, 0);
  const budget = Math.max(0, 100 - totalCost);
  const population = city.buildings.reduce((sum, item) => sum + (BUILDINGS[item.type].population || 0), 0);
  const roadLinked = city.buildings.filter((item) => nearbyRoad(item, city.roads)).length;
  const access = city.buildings.length ? Math.round((roadLinked / city.buildings.length) * 100) : 0;
  const junctions = connectedRoadCount(city.roads);
  const roadScore = Math.min(100, Math.round(city.roads.length * 11 + junctions * 7 + (count(city, 'bus') * 10)));
  const emergencyAssets = count(city, 'hospital') + count(city, 'fire');
  const emergency = Math.min(100, Math.round((emergencyAssets * 32 + access * 0.42 + Math.min(city.roads.length * 4, 24))));
  const utilities = ['water', 'power', 'drainage', 'waste'];
  const utilityCoverage = utilities.filter((type) => count(city, type) > 0).length / utilities.length;
  const resilience = Math.min(100, Math.round(utilityCoverage * 60 + count(city, 'sensor') * 7 + count(city, 'park') * 6 + count(city, 'solar') * 8));
  const housing = count(city, 'residential');
  const jobs = count(city, 'commercial') + count(city, 'industrial');
  const planning = Math.min(100, Math.round(Math.min(housing * 18, 45) + Math.min(jobs * 12, 32) + Math.min(count(city, 'school') * 12, 12) + Math.min(count(city, 'hotel') + count(city, 'restaurant'), 4) * 3));
  const affordability = totalCost <= 100 ? Math.max(45, Math.min(100, 100 - Math.max(0, totalCost - 75) * 2)) : 0;
  const score = Math.max(0, Math.min(100, Math.round(roadScore * 0.22 + emergency * 0.22 + resilience * 0.28 + planning * 0.18 + affordability * 0.10)));
  return { city, totalCost, budget, population, access, roadScore, emergency, resilience, planning, affordability, score, counts: Object.fromEntries(Object.keys(BUILDINGS).map((type) => [type, count(city, type)])) };
}
function simulationResult(input) {
  const m = cityMetrics(input);
  const flood = Math.min(100, Math.round(m.resilience * 0.68 + m.access * 0.12 + m.counts.drainage * 12 + m.counts.park * 4));
  const ambulance = Math.min(100, Math.round(m.emergency * 0.72 + m.roadScore * 0.22 + m.counts.hospital * 8));
  const fire = Math.min(100, Math.round(m.emergency * 0.76 + m.roadScore * 0.15 + m.counts.fire * 10));
  const traffic = Math.min(100, Math.round(m.roadScore * 0.68 + m.counts.bus * 12 + m.access * 0.16));
  const waste = Math.min(100, Math.round(m.resilience * 0.68 + m.counts.waste * 14 + m.counts.sensor * 4));
  const events = [
    { key: 'flood', name: 'Monsoon flood', icon: '🌧️', score: flood, note: flood >= 70 ? 'Drainage and water systems contained the flood.' : 'Flooding exposed gaps in drainage and green buffers.' },
    { key: 'ambulance', name: 'Ambulance emergency', icon: '🚑', score: ambulance, note: ambulance >= 70 ? 'Emergency route reached care quickly.' : 'Response was slowed by weak service-road access.' },
    { key: 'fire', name: 'Fire response', icon: '🔥', score: fire, note: fire >= 70 ? 'Fire services could reach the incident.' : 'Coverage or street connectivity needs improvement.' },
    { key: 'traffic', name: 'Traffic surge', icon: '🚗', score: traffic, note: traffic >= 70 ? 'The road network absorbed peak traffic.' : 'The road network congested under peak load.' },
    { key: 'waste', name: 'Waste surge', icon: '♻️', score: waste, note: waste >= 70 ? 'Waste collection stayed resilient.' : 'Collection capacity could not meet the surge.' }
  ];
  const eventAverage = Math.round(events.reduce((sum, event) => sum + event.score, 0) / events.length);
  const finalScore = Math.round(m.score * 0.65 + eventAverage * 0.35);
  return { ...m, score: finalScore, eventAverage, events, generatedAt: new Date().toISOString() };
}
function publicTeam(team) {
  return { id: team.id, teamName: team.teamName, leaderName: team.leaderName, email: team.email, completed: Boolean(team.completed), city: team.city || { roads: [], buildings: [] }, result: team.result || null, createdAt: team.createdAt };
}

app.use(express.json({ limit: '250kb' }));
app.use(express.static(path.join(__dirname, 'public')));

app.post('/api/auth/team/register', (req, res) => {
  const teamName = cleanText(req.body.teamName);
  const leaderName = cleanText(req.body.leaderName);
  const email = cleanText(req.body.email, 120).toLowerCase();
  const password = String(req.body.password || '');
  if (teamName.length < 2 || leaderName.length < 2 || !/^\S+@\S+\.\S+$/.test(email) || password.length < 6) return res.status(400).json({ error: 'Enter a team name, leader name, valid email, and password of at least 6 characters.' });
  const db = readDb();
  if (db.teams.some((team) => team.email === email || team.teamName.toLowerCase() === teamName.toLowerCase())) return res.status(409).json({ error: 'That team name or email has already been registered.' });
  const team = { id: crypto.randomUUID(), teamName, leaderName, email, passwordHash: hashPassword(password), completed: false, city: { roads: [], buildings: [] }, result: null, createdAt: new Date().toISOString() };
  db.teams.push(team);
  const token = tokenFor(db, 'team', team.id);
  res.status(201).json({ token, team: publicTeam(team) });
});
app.post('/api/auth/team/login', (req, res) => {
  const email = cleanText(req.body.email, 120).toLowerCase();
  const password = String(req.body.password || '');
  const db = readDb();
  const team = db.teams.find((item) => item.email === email);
  if (!team || !checkPassword(password, team.passwordHash)) return res.status(401).json({ error: 'Incorrect email or password.' });
  const token = tokenFor(db, 'team', team.id);
  res.json({ token, team: publicTeam(team) });
});
app.post('/api/auth/admin/login', (req, res) => {
  const email = cleanText(req.body.email, 120).toLowerCase();
  const password = String(req.body.password || '');
  if (email !== ADMIN_EMAIL.toLowerCase() || password !== ADMIN_PASSWORD) return res.status(401).json({ error: 'Incorrect administrator credentials.' });
  const db = readDb();
  const token = tokenFor(db, 'admin', 'administrator');
  res.json({ token, admin: { email: ADMIN_EMAIL } });
});
app.get('/api/team/me', auth('team'), (req, res) => {
  const team = req.db.teams.find((item) => item.id === req.session.subjectId);
  if (!team) return res.status(404).json({ error: 'Team no longer exists.' });
  res.json({ team: publicTeam(team), catalog: BUILDINGS, roadCost: ROAD_COST });
});
app.put('/api/team/city', auth('team'), (req, res) => {
  const team = req.db.teams.find((item) => item.id === req.session.subjectId);
  if (!team) return res.status(404).json({ error: 'Team no longer exists.' });
  if (team.completed) return res.status(403).json({ error: 'This team has already used its one simulation run. The city is locked.' });
  const metrics = cityMetrics(req.body.city);
  if (metrics.totalCost > 100) return res.status(400).json({ error: `Your plan costs ₹${metrics.totalCost} Cr, above the ₹100 Cr budget. Remove an item before saving.` });
  team.city = metrics.city;
  writeDb(req.db);
  res.json({ team: publicTeam(team), metrics });
});
app.post('/api/team/simulate', auth('team'), (req, res) => {
  const team = req.db.teams.find((item) => item.id === req.session.subjectId);
  if (!team) return res.status(404).json({ error: 'Team no longer exists.' });
  if (team.completed) return res.status(403).json({ error: 'Simulation already completed. This team has one final run only.' });
  // Accept the current editor state as the final submission so a just-clicked asset
  // cannot be missed while an automatic draft save is still in flight.
  const result = simulationResult(req.body && req.body.city ? req.body.city : team.city);
  if (result.city.roads.length < 2 || result.city.buildings.length < 5) return res.status(400).json({ error: 'Build at least 2 roads and 5 infrastructure assets before running the final simulation.' });
  if (result.totalCost > 100) return res.status(400).json({ error: 'Your city exceeds the ₹100 Cr budget.' });
  team.city = result.city;
  team.result = result;
  team.completed = true;
  team.completedAt = new Date().toISOString();
  writeDb(req.db);
  res.json({ team: publicTeam(team), result });
});
app.get('/api/admin/scores', auth('admin'), (req, res) => {
  const teams = req.db.teams.map((team) => ({
    id: team.id, teamName: team.teamName, leaderName: team.leaderName, email: team.email, completed: Boolean(team.completed), score: team.result ? team.result.score : null,
    budgetUsed: team.result ? team.result.totalCost : cityMetrics(team.city).totalCost,
    population: team.result ? team.result.population : cityMetrics(team.city).population,
    completedAt: team.completedAt || null,
    eventAverage: team.result ? team.result.eventAverage : null,
    result: team.result || null
  })).sort((a, b) => (b.score ?? -1) - (a.score ?? -1));
  res.json({ teams, summary: { registered: teams.length, completed: teams.filter((team) => team.completed).length, averageScore: teams.filter((team) => typeof team.score === 'number').length ? Math.round(teams.filter((team) => typeof team.score === 'number').reduce((sum, team) => sum + team.score, 0) / teams.filter((team) => typeof team.score === 'number').length) : 0 } });
});
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

app.listen(PORT, () => console.log(`City simulator is running at http://localhost:${PORT}`));
