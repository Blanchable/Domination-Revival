// ─── State ──────────────────────────────────────────────────────────────────

let ws = null;
let currentFilter = '';

// ─── WebSocket ──────────────────────────────────────────────────────────────

function connect() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  ws = new WebSocket(`${proto}://${location.host}`);

  ws.onopen = () => {
    console.log('WebSocket connected');
  };

  ws.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data);
      handleMessage(msg);
    } catch {}
  };

  ws.onclose = () => {
    console.log('WebSocket disconnected, reconnecting in 2s...');
    setTimeout(connect, 2000);
  };

  ws.onerror = () => {
    ws.close();
  };
}

function handleMessage(msg) {
  switch (msg.type) {
    case 'state':
      updateBotState(msg.data);
      break;
    case 'metrics':
      updateMetrics(msg.data);
      break;
    case 'log':
      appendLog(msg.data);
      break;
  }
}

// ─── Bot State ──────────────────────────────────────────────────────────────

function updateBotState(state) {
  const dot = document.getElementById('status-dot');
  const label = document.getElementById('status-label');
  const btnStart = document.getElementById('btn-start');
  const btnStop = document.getElementById('btn-stop');
  const btnRestart = document.getElementById('btn-restart');
  const info = document.getElementById('controls-info');

  // Remove all status classes from dot
  dot.className = 'status-dot ' + state.status;
  label.textContent = state.status;

  // Button enable/disable
  const isRunning = state.status === 'running';
  const isStopped = state.status === 'stopped' || state.status === 'errored';
  const isTransitioning = state.status === 'starting' || state.status === 'stopping';

  btnStart.disabled = !isStopped;
  btnStop.disabled = !isRunning;
  btnRestart.disabled = isTransitioning;

  // Info text
  const parts = [];
  if (state.pid) parts.push(`PID: ${state.pid}`);
  if (state.startedAt) {
    const ago = timeSince(state.startedAt);
    parts.push(`Started: ${ago} ago`);
  }
  if (state.restarts > 0) parts.push(`Restarts: ${state.restarts}`);
  if (state.lastError) parts.push(`Last error: ${state.lastError}`);

  if (parts.length === 0) {
    info.textContent = state.status === 'stopped'
      ? 'Bot is stopped. Click Start to launch.'
      : `Bot is ${state.status}...`;
  } else {
    info.textContent = parts.join('  |  ');
  }

  // Restarts metric
  document.getElementById('metric-restarts').textContent = state.restarts;
}

// ─── Metrics ────────────────────────────────────────────────────────────────

function updateMetrics(m) {
  document.getElementById('metric-uptime').textContent = formatUptime(m.uptimeSeconds);
  document.getElementById('metric-memory').textContent = m.memoryMB + ' MB';
  document.getElementById('metric-cpu').textContent = m.cpuPercent + '%';
}

function formatUptime(seconds) {
  if (seconds < 60) return seconds + 's';
  if (seconds < 3600) return Math.floor(seconds / 60) + 'm ' + (seconds % 60) + 's';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return h + 'h ' + m + 'm';
}

function timeSince(ts) {
  const s = Math.floor((Date.now() - ts) / 1000);
  return formatUptime(s);
}

// ─── Logs ───────────────────────────────────────────────────────────────────

function appendLog(entry) {
  if (currentFilter && entry.level !== currentFilter) return;

  const container = document.getElementById('log-container');
  const line = document.createElement('div');
  line.className = `log-line ${entry.level}`;

  const ts = new Date(entry.timestamp).toLocaleTimeString();
  line.innerHTML =
    `<span class="ts">${ts}</span>` +
    `<span class="lvl">[${entry.level.toUpperCase().padEnd(5)}]</span> ` +
    escapeHtml(entry.message);

  container.appendChild(line);

  // Trim old lines
  while (container.children.length > 1500) {
    container.removeChild(container.firstChild);
  }

  // Auto-scroll
  if (document.getElementById('auto-scroll').checked) {
    container.scrollTop = container.scrollHeight;
  }
}

function clearLogs() {
  document.getElementById('log-container').innerHTML = '';
}

function applyLogFilter() {
  currentFilter = document.getElementById('log-filter').value;
  // Re-fetch filtered logs from server
  clearLogs();
  const url = currentFilter ? `/api/logs?limit=200&level=${currentFilter}` : '/api/logs?limit=200';
  fetch(url)
    .then((r) => r.json())
    .then((logs) => {
      for (const log of logs) appendLog(log);
    })
    .catch(() => {});
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// ─── Bot Actions ────────────────────────────────────────────────────────────

async function botAction(action) {
  try {
    const res = await fetch(`/api/bot/${action}`, { method: 'POST' });
    const data = await res.json();
    if (!res.ok) {
      console.warn(`Action ${action} failed:`, data.error);
    }
  } catch (err) {
    console.error(`Action ${action} error:`, err);
  }
}

// ─── Games ──────────────────────────────────────────────────────────────────

async function fetchGames() {
  const container = document.getElementById('games-list');
  try {
    const res = await fetch('/api/games');
    const games = await res.json();

    if (!Array.isArray(games) || games.length === 0) {
      container.innerHTML = '<p class="muted">No games found. Create one with /game create in Discord.</p>';
      return;
    }

    let html = `<table>
      <thead>
        <tr>
          <th>Name</th>
          <th>Status</th>
          <th>Turn</th>
          <th>Players</th>
          <th>Tick</th>
          <th>Created</th>
        </tr>
      </thead>
      <tbody>`;

    for (const g of games) {
      const created = new Date(g.createdAt).toLocaleDateString();
      html += `<tr>
        <td><strong>${escapeHtml(g.name)}</strong></td>
        <td><span class="status-badge status-${g.status}">${g.status}</span></td>
        <td>${g.turnNumber}</td>
        <td>${g._count?.players ?? '?'}</td>
        <td>${g.tickTime} ${g.tickTZ}</td>
        <td>${created}</td>
      </tr>`;
    }

    html += '</tbody></table>';
    container.innerHTML = html;
  } catch (err) {
    container.innerHTML = `<p class="muted">Failed to load games. Is the database connected?</p>`;
  }
}

// ─── Config ─────────────────────────────────────────────────────────────────

async function fetchConfig() {
  try {
    const res = await fetch('/api/status');
    const data = await res.json();
    const cfg = data.config;

    document.getElementById('cfg-tick').textContent = `${cfg.tickTime} ${cfg.tickTZ}`;
    document.getElementById('cfg-token').textContent = cfg.hasToken ? 'Configured' : 'Missing!';
    document.getElementById('cfg-token').style.color = cfg.hasToken ? 'var(--green)' : 'var(--red)';
    document.getElementById('cfg-db').textContent = cfg.hasDatabase ? 'Configured' : 'Missing!';
    document.getElementById('cfg-db').style.color = cfg.hasDatabase ? 'var(--green)' : 'var(--red)';
    document.getElementById('cfg-env').textContent = cfg.nodeEnv;

    // Also update bot state from initial fetch
    updateBotState(data.bot);
    updateMetrics(data.metrics);
  } catch {}
}

// ─── Init ───────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
  fetchConfig();
  fetchGames();
  connect();

  // Refresh games every 30 seconds
  setInterval(fetchGames, 30000);
});
