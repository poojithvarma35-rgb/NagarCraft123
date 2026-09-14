const adminState = { token: localStorage.getItem('citySimAdminToken') || '', teams: [] };
const $ = (selector) => document.querySelector(selector);
const escapeHtml = (value) => String(value || '').replace(/[&<>'"]/g, (char) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#39;', '"':'&quot;' }[char]));
const formatNumber = (value) => Number(value || 0).toLocaleString('en-IN');

async function request(url, options = {}) {
  const headers = { ...(options.body ? { 'Content-Type':'application/json' } : {}), ...(options.headers || {}) };
  if (adminState.token) headers.Authorization = `Bearer ${adminState.token}`;
  const response = await fetch(url, { ...options, headers }).catch(() => {
    throw new Error('Cannot reach the city server. Run "npm start" in the project folder, then open http://localhost:3001/admin.html.');
  }); const data = await response.json().catch(() => ({}));
  if (!response.ok) { const error = new Error(data.error || 'Unable to load administrator data.'); error.status = response.status; throw error; }
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
    const ranked=team.completed && team.version===data.version;
    if (ranked) rank += 1;
    const row = document.createElement('tr');
    row.innerHTML = `<td class="rank">${ranked ? `#${rank}` : '—'}</td><td><strong>${escapeHtml(team.teamName)}</strong><br><small>${escapeHtml(team.email)}</small></td><td>${escapeHtml(team.leaderName)}</td><td>${formatNumber(team.population)}</td><td>₹${team.budgetUsed} Cr</td><td>${team.eventAverage ?? '—'}</td><td class="score-cell">${team.score ?? '—'}</td><td><span class="submission-status ${team.completed ? 'done' : 'draft'}">${team.completed ? (ranked?'SUBMITTED':'LEGACY') : 'DRAFT'}</span>${team.completed ? '<br><button class="view-team" type="button">View events</button>' : ''}</td>`;
    const button = row.querySelector('.view-team'); if (button) button.addEventListener('click', () => renderReview(team));
    const actions = document.createElement('td');
    const deleteButton = document.createElement('button');
    deleteButton.type = 'button'; deleteButton.className = 'delete-team'; deleteButton.textContent = 'Delete team';
    deleteButton.setAttribute('aria-label', `Delete team ${team.teamName}`);
    deleteButton.addEventListener('click', () => deleteTeam(team, deleteButton));
    actions.append(deleteButton); row.append(actions); rows.append(row);
  });
  if (!data.teams.length) rows.innerHTML = '<tr><td colspan="9">No teams registered yet.</td></tr>';
  const firstCompleted = data.teams.find((team) => team.completed); renderReview(firstCompleted || null);
}
async function deleteTeam(team, button) {
  if (!window.confirm(`Delete team “${team.teamName}” (${team.email})?\n\nThis removes its registration, city plan, final score and active sessions. There is no undo in this dashboard. Its registration code will remain used.`)) return;
  button.disabled = true; button.textContent = 'Deleting…'; $('#adminNotice').textContent = '';
  try {
    await request(`/api/admin/teams/${encodeURIComponent(team.id)}`, { method: 'DELETE' });
    $('#adminNotice').textContent = `Deleted “${team.teamName}” and its saved city and results.`;
    // Remove the stale row immediately, even if refreshing the remaining data fails.
    button.closest('tr').remove();
    $('#eventReview').textContent = '';
    await loadScores();
  } catch (error) {
    $('#adminNotice').textContent = error.message;
    button.disabled = false; button.textContent = 'Delete team';
  }
}
async function loadScores() {
  const refresh = $('#refreshScores'); if (refresh) { refresh.disabled = true; refresh.textContent = 'Refreshing…'; }
  try { const data = await request('/api/admin/scores'); $('#adminLogin').classList.add('hidden'); $('#adminDashboard').classList.remove('hidden'); renderScores(data); await loadCodes(); } catch (error) {
    if (error.status === 401) { localStorage.removeItem('citySimAdminToken'); adminState.token = ''; $('#adminDashboard').classList.add('hidden'); $('#adminLogin').classList.remove('hidden'); $('#adminError').textContent = error.message; }
    else { $('#adminNotice').textContent += ` Could not refresh: ${error.message}`; }
  } finally { if (refresh) { refresh.disabled = false; refresh.textContent = '↻ Refresh data'; } }
}
async function loadCodes() {
  const data=await request('/api/admin/codes');const list=$('#codeList');list.innerHTML='';
  if(!data.codes.length)list.textContent='No codes issued yet.';
  data.codes.slice().reverse().forEach(entry=> {
    const row=document.createElement('div');row.className='code-row';
    row.innerHTML='<strong>'+escapeHtml(entry.teamName)+'</strong><code>'+escapeHtml(entry.code)+'</code><span>'+(entry.code.match(/^\d{4}$/)?'':'Legacy · ') +(entry.usedBy?'Used':entry.revoked?'Revoked':'Available')+'</span>';
    if(!entry.usedBy && !entry.revoked) {
      const button=document.createElement('button');button.type='button';button.className='quiet-btn';button.textContent='Revoke unused code';
      button.addEventListener('click',async()=> {if(!confirm('Revoke the unused code for '+entry.teamName+'?'))return;button.disabled=true;try{await request('/api/admin/codes/'+encodeURIComponent(entry.id)+'/revoke',{method:'POST'});await loadCodes();}catch(e){$('#codeNotice').textContent=e.message;button.disabled=false;}});row.append(button);
    }
    list.append(row);
  });
}
function init() {
  $('#codeForm').addEventListener('submit',async event=> {
    event.preventDefault();const button=$('#codeForm button');button.disabled=true;$('#codeNotice').textContent='';
    try {const data=await request('/api/admin/codes',{method:'POST',body:JSON.stringify({teamName:$('#codeTeamName').value.trim()})});$('#codeNotice').textContent='Issued for '+data.code.teamName+': '+data.code.code;$('#codeTeamName').value='';await loadCodes();}catch(error){$('#codeNotice').textContent=error.message;}finally{button.disabled=false;}
  });
  $('#adminForm').addEventListener('submit', async (event) => {
    event.preventDefault(); const error = $('#adminError'); error.textContent = ''; const button = $('#adminForm button'); button.disabled = true; button.textContent = 'Verifying…';
    try { const data = await request('/api/auth/admin/login', { method:'POST', body:JSON.stringify({ email:$('#adminEmail').value.trim(), password:$('#adminPassword').value }) }); adminState.token = data.token; localStorage.setItem('citySimAdminToken', data.token); await loadScores(); } catch (err) { error.textContent = err.message; } finally { button.disabled = false; button.textContent = 'Open control room'; }
  });
  $('#refreshScores').addEventListener('click', loadScores); if (adminState.token) loadScores();
}
init();

