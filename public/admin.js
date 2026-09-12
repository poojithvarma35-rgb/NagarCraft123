const adminState = { token: localStorage.getItem('citySimAdminToken') || '', teams: [] };
const $ = (selector) => document.querySelector(selector);
const escapeHtml = (value) => String(value || '').replace(/[&<>'"]/g, (char) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#39;', '"':'&quot;' }[char]));
const formatNumber = (value) => Number(value || 0).toLocaleString('en-IN');

async function request(url, options = {}) {
  const headers = { ...(options.body ? { 'Content-Type':'application/json' } : {}), ...(options.headers || {}) };
  if (adminState.token) headers.Authorization = `Bearer ${adminState.token}`;
  const response = await fetch(url, { ...options, headers }); const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Unable to load administrator data.');
  return data;
}
function renderReview(team) {
  const review = $('#eventReview');
  if (!team?.result) { review.innerHTML = '<p>This team has not submitted a final simulation yet.</p>'; return; }
  review.innerHTML = `<h2 class="review-title">${escapeHtml(team.teamName)} · event review</h2><div class="review-events">${team.result.events.map((event) => `<div class="review-event"><span>${event.icon}</span><small>${escapeHtml(event.name)}</small><b>${event.score}/100</b></div>`).join('')}</div>`;
}
function renderScores(data) {
  adminState.teams = data.teams; $('#registeredCount').textContent = data.summary.registered; $('#completedCount').textContent = data.summary.completed; $('#averageScore').textContent = data.summary.averageScore;
  const rows = $('#scoreRows'); rows.innerHTML = '';
  let rank = 0;
  data.teams.forEach((team) => {
    if (team.completed) rank += 1;
    const row = document.createElement('tr');
    row.innerHTML = `<td class="rank">${team.completed ? `#${rank}` : '—'}</td><td><strong>${escapeHtml(team.teamName)}</strong><br><small>${escapeHtml(team.email)}</small></td><td>${escapeHtml(team.leaderName)}</td><td>${formatNumber(team.population)}</td><td>₹${team.budgetUsed} Cr</td><td>${team.eventAverage ?? '—'}</td><td class="score-cell">${team.score ?? '—'}</td><td><span class="submission-status ${team.completed ? 'done' : 'draft'}">${team.completed ? 'SUBMITTED' : 'DRAFT'}</span>${team.completed ? '<br><button class="view-team" type="button">View events</button>' : ''}</td>`;
    const button = row.querySelector('.view-team'); if (button) button.addEventListener('click', () => renderReview(team)); rows.append(row);
  });
  const firstCompleted = data.teams.find((team) => team.completed); renderReview(firstCompleted || null);
}
async function loadScores() {
  const refresh = $('#refreshScores'); if (refresh) { refresh.disabled = true; refresh.textContent = 'Refreshing…'; }
  try { const data = await request('/api/admin/scores'); $('#adminLogin').classList.add('hidden'); $('#adminDashboard').classList.remove('hidden'); renderScores(data); } catch (error) { localStorage.removeItem('citySimAdminToken'); adminState.token = ''; $('#adminDashboard').classList.add('hidden'); $('#adminLogin').classList.remove('hidden'); } finally { if (refresh) { refresh.disabled = false; refresh.textContent = '↻ Refresh data'; } }
}
function init() {
  $('#adminForm').addEventListener('submit', async (event) => {
    event.preventDefault(); const error = $('#adminError'); error.textContent = ''; const button = $('#adminForm button'); button.disabled = true; button.textContent = 'Verifying…';
    try { const data = await request('/api/auth/admin/login', { method:'POST', body:JSON.stringify({ email:$('#adminEmail').value.trim(), password:$('#adminPassword').value }) }); adminState.token = data.token; localStorage.setItem('citySimAdminToken', data.token); await loadScores(); } catch (err) { error.textContent = err.message; } finally { button.disabled = false; button.textContent = 'Open control room'; }
  });
  $('#refreshScores').addEventListener('click', loadScores); if (adminState.token) loadScores();
}
init();
