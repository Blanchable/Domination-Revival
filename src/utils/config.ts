import dotenv from 'dotenv';
dotenv.config();

export const config = {
  discordToken: process.env.DISCORD_TOKEN ?? '',
  databaseUrl: process.env.DATABASE_URL ?? '',
  tickTime: process.env.TICK_TIME ?? '12:00',
  tickTZ: process.env.TICK_TZ ?? 'America/New_York',
  dashboardPort: parseInt(process.env.DASHBOARD_PORT || '3000', 10),
  nodeEnv: process.env.NODE_ENV ?? 'development',
} as const;
