import { config } from './utils/config';
import { createClient } from './bot/client';
import { handleReady } from './bot/events/ready';
import { handleInteractionCreate } from './bot/events/interactionCreate';
import { disconnectPrisma } from './db/client';

async function main() {
  console.log('Starting Domination Revival bot...');

  if (!config.discordToken) {
    console.error('DISCORD_TOKEN is not set. Please set it in .env or run: npm run setup');
    process.exit(1);
  }

  const client = createClient();

  client.once('ready', () => {
    handleReady(client);

    // Signal readiness to parent process (dashboard) if launched via fork
    if (process.send) {
      process.send({ type: 'ready' });
    }
  });

  client.on('interactionCreate', handleInteractionCreate);

  await client.login(config.discordToken);

  const shutdown = async () => {
    console.log('Shutting down...');
    client.destroy();
    await disconnectPrisma();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
