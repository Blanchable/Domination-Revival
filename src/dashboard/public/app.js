// ─── State ──────────────────────────────────────────────────────────────────

let ws = null;
let currentFilter = '';
let gamesCache = [];

// ─── Tabs ───────────────────────────────────────────────────────────────────

function switchTab(name) {
  document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === name));
  document.querySelectorAll('.tab-content').forEach((c) => c.classList.toggle('active', c.id === 'tab-' + name));

  if (name === 'games') fetchGames();
  if (name === 'logs') {
    const c = document.getElementById('log-container');
    if (document.getElementById('auto-scroll').checked) c.scrollTop = c.scrollHeight;
  }
}

// ─── WebSocket ──────────────────────────────────────────────────────────────

function connect() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  ws = new WebSocket(`${proto}://${location.host}`);

  ws.onopen = () => {};

  ws.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data);
      switch (msg.type) {
        case 'state':   updateBotState(msg.data); break;
        case 'metrics': updateMetrics(msg.data); break;
        case 'log':     appendLog(msg.data); break;
      }
    } catch {}
  };

  ws.onclose = () => setTimeout(connect, 2000);
  ws.onerror = () => ws.close();
}

// ─── Bot State ──────────────────────────────────────────────────────────────

function updateBotState(state) {
  const dot   = document.getElementById('status-dot');
  const label = document.getElementById('status-label');
  const info  = document.getElementById('controls-info');
  const btnStart   = document.getElementById('btn-start');
  const btnStop    = document.getElementById('btn-stop');
  const btnRestart = document.getElementById('btn-restart');

  dot.className = 'status-dot ' + state.status;
  label.textContent = state.status;

  const isRunning       = state.status === 'running';
  const isStopped       = state.status === 'stopped' || state.status === 'errored';
  const isTransitioning = state.status === 'starting' || state.status === 'stopping';

  btnStart.disabled   = !isStopped;
  btnStop.disabled    = !isRunning;
  btnRestart.disabled = isTransitioning;

  const parts = [];
  if (state.pid) parts.push('PID ' + state.pid);
  if (state.startedAt) parts.push('Up ' + timeSince(state.startedAt));
  if (state.restarts > 0) parts.push(state.restarts + ' restart' + (state.restarts > 1 ? 's' : ''));
  if (state.lastError) parts.push('Error: ' + state.lastError);

  info.textContent = parts.length
    ? parts.join('  \u00b7  ')
    : (isStopped ? 'Bot is stopped. Click Start to launch.' : 'Bot is ' + state.status + '\u2026');

  document.getElementById('metric-restarts').textContent = state.restarts;
}

// ─── Metrics ────────────────────────────────────────────────────────────────

function updateMetrics(m) {
  document.getElementById('metric-uptime').textContent  = fmtUptime(m.uptimeSeconds);
  document.getElementById('metric-memory').textContent  = m.memoryMB + ' MB';
  document.getElementById('metric-cpu').textContent     = m.cpuPercent + '%';
}

function fmtUptime(s) {
  if (s < 60) return s + 's';
  if (s < 3600) return Math.floor(s / 60) + 'm ' + (s % 60) + 's';
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  if (h < 24) return h + 'h ' + m + 'm';
  return Math.floor(h / 24) + 'd ' + (h % 24) + 'h';
}

function timeSince(ts) { return fmtUptime(Math.floor((Date.now() - ts) / 1000)); }

// ─── Logs ───────────────────────────────────────────────────────────────────

function appendLog(entry) {
  if (currentFilter && entry.level !== currentFilter) return;

  const c = document.getElementById('log-container');
  const el = document.createElement('div');
  el.className = 'log-line ' + entry.level;

  const ts = new Date(entry.timestamp).toLocaleTimeString();
  el.innerHTML =
    '<span class="ts">' + ts + '</span>' +
    '<span class="lvl">[' + entry.level.toUpperCase().padEnd(5) + ']</span> ' +
    esc(entry.message);

  c.appendChild(el);
  while (c.children.length > 1500) c.removeChild(c.firstChild);
  if (document.getElementById('auto-scroll').checked) c.scrollTop = c.scrollHeight;
}

function clearLogs() { document.getElementById('log-container').innerHTML = ''; }

function applyLogFilter() {
  currentFilter = document.getElementById('log-filter').value;
  clearLogs();
  const q = currentFilter ? '?limit=300&level=' + currentFilter : '?limit=300';
  fetch('/api/logs' + q).then(r => r.json()).then(logs => { for (const l of logs) appendLog(l); }).catch(() => {});
}

function esc(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }

// ─── Bot Actions ────────────────────────────────────────────────────────────

async function botAction(action) {
  try { await fetch('/api/bot/' + action, { method: 'POST' }); } catch (e) { console.error(e); }
}

// ─── Games ──────────────────────────────────────────────────────────────────

async function fetchGames() {
  try {
    const res = await fetch('/api/games');
    const games = await res.json();
    gamesCache = Array.isArray(games) ? games : [];
    renderGamesTable('games-list', true);
    renderGamesTable('quick-games', false);
  } catch {
    document.getElementById('games-list').innerHTML = '<p class="muted">Failed to load games.</p>';
    document.getElementById('quick-games').innerHTML = '<p class="muted">Failed to load games.</p>';
  }
}

function renderGamesTable(containerId, clickable) {
  const container = document.getElementById(containerId);
  if (!gamesCache.length) {
    container.innerHTML = '<p class="muted">No games found. Use <code>/game create</code> in Discord.</p>';
    return;
  }

  let html = '<table><thead><tr><th>Name</th><th>Status</th><th>Turn</th><th>Players</th><th>Tick</th><th>Created</th></tr></thead><tbody>';
  for (const g of gamesCache) {
    const d = new Date(g.createdAt).toLocaleDateString();
    const cls = clickable ? ' class="clickable" onclick="showGameDetail(\'' + g.id + '\')"' : '';
    html += '<tr' + cls + '>' +
      '<td><strong>' + esc(g.name) + '</strong></td>' +
      '<td><span class="status-badge status-' + g.status + '">' + g.status + '</span></td>' +
      '<td>' + g.turnNumber + '</td>' +
      '<td>' + (g._count?.players ?? '?') + '</td>' +
      '<td>' + g.tickTime + ' ' + g.tickTZ + '</td>' +
      '<td>' + d + '</td></tr>';
  }
  html += '</tbody></table>';
  container.innerHTML = html;
}

// ─── Game Detail ────────────────────────────────────────────────────────────

async function showGameDetail(id) {
  const panel = document.getElementById('game-detail');
  const content = document.getElementById('game-detail-content');
  panel.style.display = '';
  content.innerHTML = '<p class="muted">Loading...</p>';

  try {
    const res = await fetch('/api/games/' + id);
    const game = await res.json();

    let playersHtml = '<ul class="player-list">';
    if (game.players && game.players.length) {
      for (const p of game.players) {
        const cls = p.isAlive ? 'player-alive' : 'player-dead';
        playersHtml += '<li><span class="' + cls + '">' + esc(p.displayName) + '</span>' +
          '<span style="font-family:var(--mono);font-size:.82rem">' + p.gold + 'G / ' + p.food + 'F / ' + p.faith + 'Fa</span></li>';
      }
    } else {
      playersHtml += '<li class="muted">No players</li>';
    }
    playersHtml += '</ul>';

    let ticksHtml = '';
    if (game.tickLogs && game.tickLogs.length) {
      ticksHtml = '<table><thead><tr><th>Turn</th><th>Started</th><th>Duration</th><th>Status</th></tr></thead><tbody>';
      for (const t of game.tickLogs) {
        const started = new Date(t.startedAt).toLocaleString();
        const dur = t.endedAt ? ((new Date(t.endedAt).getTime() - new Date(t.startedAt).getTime()) / 1000).toFixed(1) + 's' : '-';
        const cls = t.endedAt ? 'tick-ok' : 'tick-pend';
        ticksHtml += '<tr><td>' + t.turnNumber + '</td><td>' + started + '</td><td>' + dur + '</td><td class="' + cls + '">' + (t.endedAt ? 'Complete' : 'Pending') + '</td></tr>';
      }
      ticksHtml += '</tbody></table>';
    } else {
      ticksHtml = '<p class="muted">No ticks yet.</p>';
    }

    content.innerHTML =
      '<div class="detail-grid">' +
        '<div class="detail-section">' +
          '<h3>Info</h3>' +
          '<div class="detail-stat"><span class="label">Name</span><span class="value">' + esc(game.name) + '</span></div>' +
          '<div class="detail-stat"><span class="label">Status</span><span class="value"><span class="status-badge status-' + game.status + '">' + game.status + '</span></span></div>' +
          '<div class="detail-stat"><span class="label">Turn</span><span class="value">' + game.turnNumber + '</span></div>' +
          '<div class="detail-stat"><span class="label">Map</span><span class="value">' + game.mapId + '</span></div>' +
          '<div class="detail-stat"><span class="label">Tick</span><span class="value">' + game.tickTime + ' ' + game.tickTZ + '</span></div>' +
          '<div class="detail-stat"><span class="label">Provinces</span><span class="value">' + (game._count?.provinces ?? '?') + '</span></div>' +
          '<div class="detail-stat"><span class="label">Pending Orders</span><span class="value">' + (game._count?.orders ?? '?') + '</span></div>' +
        '</div>' +
        '<div class="detail-section">' +
          '<h3>Players (' + (game.players?.length ?? 0) + ')</h3>' +
          playersHtml +
        '</div>' +
      '</div>' +
      '<div style="margin-top:16px"><h3 style="font-size:.82rem;color:var(--text-muted);text-transform:uppercase;letter-spacing:.04em;margin-bottom:8px">Recent Ticks</h3>' + ticksHtml + '</div>';

    panel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  } catch (err) {
    content.innerHTML = '<p class="muted">Failed to load game details.</p>';
  }
}

function closeGameDetail() {
  document.getElementById('game-detail').style.display = 'none';
}

// ─── Ticks ──────────────────────────────────────────────────────────────────

async function fetchTicks() {
  const container = document.getElementById('ticks-list');
  try {
    const res = await fetch('/api/ticks?limit=15');
    const ticks = await res.json();

    if (!Array.isArray(ticks) || !ticks.length) {
      container.innerHTML = '<p class="muted">No ticks recorded yet.</p>';
      return;
    }

    let html = '<table><thead><tr><th>Game</th><th>Turn</th><th>Started</th><th>Duration</th><th>Status</th><th>Summary</th></tr></thead><tbody>';
    for (const t of ticks) {
      const started = new Date(t.startedAt).toLocaleString();
      const dur = t.endedAt ? ((new Date(t.endedAt).getTime() - new Date(t.startedAt).getTime()) / 1000).toFixed(1) + 's' : '-';
      const cls = t.endedAt ? 'tick-ok' : 'tick-pend';
      const summary = t.summaryJson || {};
      const summaryStr = [];
      if (summary.battles) summaryStr.push(summary.battles + ' battles');
      if (summary.captures) summaryStr.push(summary.captures + ' captures');
      if (summary.eliminations?.length) summaryStr.push(summary.eliminations.length + ' eliminated');
      if (summary.newPope) summaryStr.push('New pope');

      html += '<tr>' +
        '<td style="font-family:var(--mono);font-size:.78rem">' + t.gameId.slice(0, 8) + '\u2026</td>' +
        '<td>' + t.turnNumber + '</td>' +
        '<td>' + started + '</td>' +
        '<td>' + dur + '</td>' +
        '<td class="' + cls + '">' + (t.endedAt ? 'OK' : 'Running') + '</td>' +
        '<td class="muted">' + (summaryStr.join(', ') || '-') + '</td>' +
        '</tr>';
    }
    html += '</tbody></table>';
    container.innerHTML = html;
  } catch {
    container.innerHTML = '<p class="muted">Failed to load ticks.</p>';
  }
}

// ─── Config ─────────────────────────────────────────────────────────────────

async function fetchConfig() {
  try {
    const res = await fetch('/api/status');
    const data = await res.json();
    const cfg = data.config;

    document.getElementById('cfg-tick').textContent   = cfg.tickTime + ' ' + cfg.tickTZ;
    document.getElementById('cfg-token').textContent   = cfg.hasToken ? 'Configured' : 'Missing!';
    document.getElementById('cfg-token').style.color   = cfg.hasToken ? 'var(--green)' : 'var(--red)';
    document.getElementById('cfg-db').textContent      = cfg.hasDatabase ? 'Configured' : 'Missing!';
    document.getElementById('cfg-db').style.color      = cfg.hasDatabase ? 'var(--green)' : 'var(--red)';
    document.getElementById('cfg-env').textContent     = cfg.nodeEnv;

    updateBotState(data.bot);
    updateMetrics(data.metrics);
  } catch {}
}

// ─── Init ───────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  fetchConfig();
  fetchGames();
  fetchTicks();
  connect();
  setInterval(fetchGames, 30000);
  setInterval(fetchTicks, 60000);
});
