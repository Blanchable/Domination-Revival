import express from 'express';
import http from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import path from 'path';
import { ChildProcess, fork } from 'child_process';
import dotenv from 'dotenv';

dotenv.config();

// ─── State ──────────────────────────────────────────────────────────────────

interface BotState {
  status: 'stopped' | 'starting' | 'running' | 'stopping' | 'errored';
  pid: number | null;
  startedAt: number | null;
  lastError: string | null;
  restarts: number;
}

interface LogEntry {
  timestamp: number;
  level: 'info' | 'warn' | 'error' | 'debug';
  message: string;
}

const MAX_LOG_BUFFER = 2000;

let botProcess: ChildProcess | null = null;
const botState: BotState = {
  status: 'stopped',
  pid: null,
  startedAt: null,
  lastError: null,
  restarts: 0,
};
const logBuffer: LogEntry[] = [];
const wsClients = new Set<WebSocket>();

// ─── Process metrics sampled periodically ───────────────────────────────────

interface Metrics {
  uptimeSeconds: number;
  memoryMB: number;
  cpuPercent: number;
  logCount: number;
  timestamp: number;
}

let lastCpuUsage = process.cpuUsage();
let lastCpuTime = Date.now();

function sampleMetrics(): Metrics {
  const now = Date.now();
  const mem = process.memoryUsage();
  const cpuNow = process.cpuUsage(lastCpuUsage);
  const elapsedMs = now - lastCpuTime;
  const cpuPercent = elapsedMs > 0
    ? ((cpuNow.user + cpuNow.system) / 1000 / elapsedMs) * 100
    : 0;
  lastCpuUsage = process.cpuUsage();
  lastCpuTime = now;

  return {
    uptimeSeconds: botState.startedAt ? Math.floor((now - botState.startedAt) / 1000) : 0,
    memoryMB: Math.round(mem.heapUsed / 1024 / 1024 * 10) / 10,
    cpuPercent: Math.round(cpuPercent * 10) / 10,
    logCount: logBuffer.length,
    timestamp: now,
  };
}

// ─── Log helpers ────────────────────────────────────────────────────────────

function pushLog(level: LogEntry['level'], message: string) {
  const entry: LogEntry = { timestamp: Date.now(), level, message };
  logBuffer.push(entry);
  if (logBuffer.length > MAX_LOG_BUFFER) logBuffer.shift();
  broadcast({ type: 'log', data: entry });
}

function broadcast(payload: object) {
  const json = JSON.stringify(payload);
  for (const ws of wsClients) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(json);
    }
  }
}

// ─── Bot process management ─────────────────────────────────────────────────

function startBot(): boolean {
  if (botProcess) return false;

  botState.status = 'starting';
  botState.lastError = null;
  broadcast({ type: 'state', data: botState });
  pushLog('info', 'Starting bot process...');

  const botEntry = path.join(__dirname, '..', 'index.js');

  try {
    botProcess = fork(botEntry, [], {
      cwd: path.join(__dirname, '..', '..'),
      env: { ...process.env },
      silent: true, // capture stdout/stderr
    });
  } catch (err: any) {
    botState.status = 'errored';
    botState.lastError = err.message;
    pushLog('error', `Failed to fork bot: ${err.message}`);
    broadcast({ type: 'state', data: botState });
    return false;
  }

  botState.pid = botProcess.pid ?? null;
  botState.startedAt = Date.now();

  botProcess.stdout?.on('data', (chunk: Buffer) => {
    const lines = chunk.toString().split('\n').filter(Boolean);
    for (const line of lines) {
      pushLog('info', line);
    }
  });

  botProcess.stderr?.on('data', (chunk: Buffer) => {
    const lines = chunk.toString().split('\n').filter(Boolean);
    for (const line of lines) {
      pushLog('error', line);
    }
  });

  botProcess.on('message', (msg: any) => {
    if (typeof msg === 'object' && msg.type === 'ready') {
      botState.status = 'running';
      pushLog('info', 'Bot is online and ready.');
      broadcast({ type: 'state', data: botState });
    }
  });

  botProcess.on('exit', (code, signal) => {
    const reason = signal ? `signal ${signal}` : `code ${code}`;
    pushLog('warn', `Bot process exited (${reason})`);
    botProcess = null;
    botState.pid = null;

    if (botState.status === 'stopping') {
      botState.status = 'stopped';
    } else {
      botState.status = 'errored';
      botState.lastError = `Exited with ${reason}`;
    }
    broadcast({ type: 'state', data: botState });
  });

  botProcess.on('error', (err) => {
    pushLog('error', `Bot process error: ${err.message}`);
    botState.status = 'errored';
    botState.lastError = err.message;
    botProcess = null;
    botState.pid = null;
    broadcast({ type: 'state', data: botState });
  });

  // If the process is still alive after 3 seconds, consider it running
  setTimeout(() => {
    if (botProcess && botState.status === 'starting') {
      botState.status = 'running';
      pushLog('info', 'Bot process assumed running.');
      broadcast({ type: 'state', data: botState });
    }
  }, 3000);

  return true;
}

function stopBot(): boolean {
  if (!botProcess) return false;

  botState.status = 'stopping';
  broadcast({ type: 'state', data: botState });
  pushLog('info', 'Stopping bot process...');

  botProcess.kill('SIGTERM');

  // Force kill after 8 seconds
  const timer = setTimeout(() => {
    if (botProcess) {
      pushLog('warn', 'Bot did not exit gracefully, sending SIGKILL...');
      botProcess.kill('SIGKILL');
    }
  }, 8000);

  botProcess.once('exit', () => clearTimeout(timer));
  return true;
}

function restartBot(): boolean {
  if (botProcess) {
    botState.restarts++;

    const onExit = () => {
      startBot();
    };
    botProcess.once('exit', onExit);
    stopBot();
    return true;
  } else {
    botState.restarts++;
    return startBot();
  }
}

// ─── Express + WebSocket ────────────────────────────────────────────────────

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ── API Routes ──────────────────────────────────────────────────────────────

app.get('/api/status', (_req, res) => {
  res.json({
    bot: botState,
    metrics: sampleMetrics(),
    config: {
      tickTime: process.env.TICK_TIME ?? '12:00',
      tickTZ: process.env.TICK_TZ ?? 'America/New_York',
      dashboardPort: process.env.DASHBOARD_PORT ?? '3000',
      nodeEnv: process.env.NODE_ENV ?? 'development',
      hasToken: !!(process.env.DISCORD_TOKEN && process.env.DISCORD_TOKEN.length > 10),
      hasDatabase: !!(process.env.DATABASE_URL && process.env.DATABASE_URL.length > 10),
    },
  });
});

app.post('/api/bot/start', (_req, res) => {
  if (botState.status === 'running' || botState.status === 'starting') {
    return res.status(409).json({ error: 'Bot is already running' });
  }
  const ok = startBot();
  res.json({ success: ok });
});

app.post('/api/bot/stop', (_req, res) => {
  if (botState.status === 'stopped' || botState.status === 'stopping') {
    return res.status(409).json({ error: 'Bot is not running' });
  }
  const ok = stopBot();
  res.json({ success: ok });
});

app.post('/api/bot/restart', (_req, res) => {
  const ok = restartBot();
  res.json({ success: ok });
});

app.get('/api/logs', (req, res) => {
  const limit = Math.min(parseInt(req.query.limit as string) || 200, MAX_LOG_BUFFER);
  const level = req.query.level as string | undefined;
  let logs = logBuffer.slice(-limit);
  if (level) {
    logs = logs.filter((l) => l.level === level);
  }
  res.json(logs);
});

app.get('/api/games', async (_req, res) => {
  try {
    const { getPrisma } = await import('../db/client');
    const prisma = getPrisma();
    const games = await prisma.game.findMany({
      orderBy: { createdAt: 'desc' },
      take: 20,
      include: { _count: { select: { players: true } } },
    });
    res.json(games);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/games/:id', async (req, res) => {
  try {
    const { getPrisma } = await import('../db/client');
    const prisma = getPrisma();
    const game = await prisma.game.findUnique({
      where: { id: req.params.id },
      include: {
        _count: { select: { players: true, provinces: true, orders: true } },
        players: { select: { id: true, displayName: true, isAlive: true, gold: true, food: true, faith: true } },
        tickLogs: { orderBy: { turnNumber: 'desc' }, take: 10 },
      },
    });
    if (!game) return res.status(404).json({ error: 'Game not found' });
    res.json(game);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/ticks', async (req, res) => {
  try {
    const { getPrisma } = await import('../db/client');
    const prisma = getPrisma();
    const ticks = await prisma.tickLog.findMany({
      orderBy: { startedAt: 'desc' },
      take: parseInt(req.query.limit as string) || 50,
    });
    res.json(ticks);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Fallback to SPA
app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ── WebSocket ───────────────────────────────────────────────────────────────

wss.on('connection', (ws) => {
  wsClients.add(ws);

  // Send current state and recent logs on connect
  ws.send(JSON.stringify({ type: 'state', data: botState }));
  ws.send(JSON.stringify({ type: 'metrics', data: sampleMetrics() }));

  const recentLogs = logBuffer.slice(-100);
  for (const log of recentLogs) {
    ws.send(JSON.stringify({ type: 'log', data: log }));
  }

  ws.on('close', () => wsClients.delete(ws));
  ws.on('error', () => wsClients.delete(ws));
});

// Broadcast metrics every 3 seconds
setInterval(() => {
  if (wsClients.size > 0) {
    broadcast({ type: 'metrics', data: sampleMetrics() });
  }
}, 3000);

// ─── Start server ───────────────────────────────────────────────────────────

const PORT = parseInt(process.env.DASHBOARD_PORT || '3000', 10);

server.listen(PORT, () => {
  pushLog('info', `Dashboard server listening on http://localhost:${PORT}`);
  console.log(`\n  ┌──────────────────────────────────────────────────────┐`);
  console.log(`  │                                                      │`);
  console.log(`  │   Domination Revival — Dashboard                     │`);
  console.log(`  │   http://localhost:${String(PORT).padEnd(5)}                            │`);
  console.log(`  │                                                      │`);
  console.log(`  │   Press Ctrl+C to shut down                          │`);
  console.log(`  │                                                      │`);
  console.log(`  └──────────────────────────────────────────────────────┘\n`);

  // Try to open in default browser
  import('open')
    .then((mod) => mod.default(`http://localhost:${PORT}`))
    .catch(() => { /* non-critical */ });
});

// Graceful shutdown
process.on('SIGINT', () => {
  pushLog('info', 'Dashboard shutting down...');
  if (botProcess) {
    botProcess.kill('SIGTERM');
    botProcess.once('exit', () => {
      server.close();
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 5000);
  } else {
    server.close();
    process.exit(0);
  }
});
