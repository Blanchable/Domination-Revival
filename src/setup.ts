#!/usr/bin/env node
import * as readline from 'readline';
import { existsSync, writeFileSync, readFileSync } from 'fs';
import { execSync } from 'child_process';
import { join } from 'path';

// ─── Helpers ────────────────────────────────────────────────────────────────

const ROOT = join(__dirname, '..');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

function ask(question: string, fallback?: string): Promise<string> {
  const suffix = fallback ? ` [${fallback}]` : '';
  return new Promise((resolve) => {
    rl.question(question + suffix + ': ', (answer) => {
      resolve(answer.trim() || fallback || '');
    });
  });
}

function banner(text: string) {
  const line = '═'.repeat(60);
  console.log();
  console.log(`╔${line}╗`);
  console.log(`║  ${text.padEnd(58)}║`);
  console.log(`╚${line}╝`);
  console.log();
}

function step(n: number, total: number, label: string) {
  console.log(`\n  [${n}/${total}] ${label}`);
  console.log('  ' + '─'.repeat(50));
}

function success(msg: string) {
  console.log(`  ✓ ${msg}`);
}

function warn(msg: string) {
  console.log(`  ! ${msg}`);
}

function fail(msg: string) {
  console.log(`  ✗ ${msg}`);
}

function run(cmd: string, label: string, cwd?: string): boolean {
  console.log(`    Running: ${label}...`);
  try {
    execSync(cmd, {
      cwd: cwd ?? ROOT,
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 120_000,
    });
    success(label + ' complete');
    return true;
  } catch (err: any) {
    fail(`${label} failed`);
    if (err.stderr) {
      const stderr = err.stderr.toString().trim();
      if (stderr) console.log(`    ${stderr.split('\n').slice(0, 5).join('\n    ')}`);
    }
    return false;
  }
}

// ─── Validation ─────────────────────────────────────────────────────────────

function isValidTimeFormat(t: string): boolean {
  return /^\d{1,2}:\d{2}$/.test(t);
}

function isValidPostgresUrl(url: string): boolean {
  return /^postgres(ql)?:\/\/.+/.test(url);
}

function isPlausibleToken(tok: string): boolean {
  return tok.length > 50 && tok.includes('.');
}

// ─── Main ───────────────────────────────────────────────────────────────────

async function main() {
  banner('Domination Revival — Setup Wizard');
  console.log('  This wizard will walk you through configuring the bot,');
  console.log('  installing dependencies, and preparing the database.');
  console.log('  Press Ctrl+C at any time to abort.\n');

  const TOTAL_STEPS = 6;

  // ── Step 1: Discord Token ──────────────────────────────────────────────

  step(1, TOTAL_STEPS, 'Discord Bot Token');
  console.log('  You need a bot token from https://discord.com/developers/applications');
  console.log('  Create an application → Bot → Reset Token → copy it here.\n');

  let existingToken = '';
  const envPath = join(ROOT, '.env');
  if (existsSync(envPath)) {
    const envContents = readFileSync(envPath, 'utf-8');
    const match = envContents.match(/^DISCORD_TOKEN=(.+)$/m);
    if (match && match[1] && isPlausibleToken(match[1])) {
      existingToken = match[1];
      console.log(`  Found existing token in .env (ends with ...${existingToken.slice(-6)})`);
    }
  }

  let discordToken: string;
  if (existingToken) {
    const keep = await ask('  Keep existing token? (y/n)', 'y');
    if (keep.toLowerCase() === 'y') {
      discordToken = existingToken;
    } else {
      discordToken = await ask('  Paste your Discord bot token');
    }
  } else {
    discordToken = await ask('  Paste your Discord bot token');
  }

  if (!isPlausibleToken(discordToken)) {
    warn('Token looks short / malformed. Continuing anyway — you can edit .env later.');
  } else {
    success('Token accepted');
  }

  // ── Step 2: Database URL ───────────────────────────────────────────────

  step(2, TOTAL_STEPS, 'PostgreSQL Database');
  console.log('  Provide a PostgreSQL connection URL.');
  console.log('  Format: postgresql://user:password@host:port/dbname\n');

  let existingDb = '';
  if (existsSync(envPath)) {
    const envContents = readFileSync(envPath, 'utf-8');
    const match = envContents.match(/^DATABASE_URL=(.+)$/m);
    if (match && match[1] && isValidPostgresUrl(match[1])) {
      existingDb = match[1];
      // mask password for display
      const masked = existingDb.replace(/:([^@]+)@/, ':****@');
      console.log(`  Found existing URL: ${masked}`);
    }
  }

  let databaseUrl: string;
  if (existingDb) {
    const keep = await ask('  Keep existing database URL? (y/n)', 'y');
    if (keep.toLowerCase() === 'y') {
      databaseUrl = existingDb;
    } else {
      databaseUrl = await ask('  PostgreSQL connection URL');
    }
  } else {
    databaseUrl = await ask(
      '  PostgreSQL connection URL',
      'postgresql://postgres:postgres@localhost:5432/domination_revival'
    );
  }

  if (!isValidPostgresUrl(databaseUrl)) {
    warn('URL does not look like a valid PostgreSQL URL. Continuing anyway.');
  } else {
    success('Database URL accepted');
  }

  // ── Step 3: Tick Configuration ─────────────────────────────────────────

  step(3, TOTAL_STEPS, 'Tick Schedule');
  console.log('  Set when the daily game tick fires. All player orders are');
  console.log('  resolved at this time each day.\n');

  const tickTime = await ask('  Tick time (HH:MM, 24h)', '12:00');
  if (!isValidTimeFormat(tickTime)) {
    warn(`"${tickTime}" doesn't match HH:MM — using 12:00`);
  }

  const tickTZ = await ask('  Timezone', 'America/New_York');

  const dashboardPort = await ask('  Dashboard port', '3000');

  success(`Tick set to ${tickTime} ${tickTZ}`);
  success(`Dashboard will run on port ${dashboardPort}`);

  // ── Step 4: Write .env ─────────────────────────────────────────────────

  step(4, TOTAL_STEPS, 'Writing configuration');

  const envContent = [
    `DISCORD_TOKEN=${discordToken}`,
    `DATABASE_URL=${databaseUrl}`,
    `TICK_TIME=${isValidTimeFormat(tickTime) ? tickTime : '12:00'}`,
    `TICK_TZ=${tickTZ}`,
    `DASHBOARD_PORT=${dashboardPort}`,
    `NODE_ENV=development`,
    '',
  ].join('\n');

  writeFileSync(envPath, envContent, 'utf-8');
  success('.env written');

  // ── Step 5: Install & Build ────────────────────────────────────────────

  step(5, TOTAL_STEPS, 'Installing dependencies & building');

  run('npm install', 'npm install');
  run('npx prisma generate', 'Prisma client generation');

  console.log('\n    Pushing database schema (prisma db push)...');
  console.log('    This will create tables if they don\'t exist.\n');
  const dbOk = run('npx prisma db push --skip-generate --accept-data-loss', 'Database schema push');

  if (!dbOk) {
    warn('Database push failed. Make sure PostgreSQL is running and the URL is correct.');
    warn('You can retry later with: npx prisma db push');
  }

  // Ensure map exists
  const mapPath = join(ROOT, 'map', 'map.json');
  if (!existsSync(mapPath)) {
    console.log('\n    Generating 700-province map...');
    run('npx tsx src/data/generateMap.ts', 'Map generation');
  } else {
    success('Map file already exists (map/map.json)');
  }

  run('npm run build', 'TypeScript build + asset copy');

  // ── Step 6: Done ───────────────────────────────────────────────────────

  step(6, TOTAL_STEPS, 'Setup complete!');

  console.log();
  console.log('  Your bot is configured and ready to launch.');
  console.log();
  console.log('  ┌──────────────────────────────────────────────────────┐');
  console.log('  │  To start the dashboard + bot, run:                 │');
  console.log('  │                                                      │');
  console.log('  │    npm run dashboard                                 │');
  console.log('  │                                                      │');
  console.log(`  │  Then open http://localhost:${dashboardPort.padEnd(5)} in your browser.   │`);
  console.log('  │                                                      │');
  console.log('  │  Other commands:                                     │');
  console.log('  │    npm run start        (bot only, no GUI)           │');
  console.log('  │    npm run setup        (re-run this wizard)         │');
  console.log('  │    npm run prisma:studio (browse DB in browser)      │');
  console.log('  └──────────────────────────────────────────────────────┘');
  console.log();

  const launchNow = await ask('  Launch the dashboard now? (y/n)', 'y');
  rl.close();

  if (launchNow.toLowerCase() === 'y') {
    console.log('\n  Starting dashboard...\n');
    // Hand off to the dashboard process
    const { spawn } = await import('child_process');
    const child = spawn('node', [join(ROOT, 'dist', 'dashboard', 'server.js')], {
      cwd: ROOT,
      stdio: 'inherit',
      env: { ...process.env },
    });
    child.on('exit', (code) => process.exit(code ?? 0));
  }
}

main().catch((err) => {
  console.error('\nSetup failed:', err);
  rl.close();
  process.exit(1);
});
