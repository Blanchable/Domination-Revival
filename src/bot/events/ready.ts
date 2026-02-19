import { Client } from 'discord.js';
import { registerCommands, commandCollection } from '../client';
import { allCommands } from '../commands';
import { startTickScheduler } from '../../engine/scheduler';

export async function handleReady(client: Client): Promise<void> {
  console.log(`Bot logged in as ${client.user?.tag}`);

  // Register all commands in collection
  for (const cmd of allCommands) {
    commandCollection.set(cmd.data.name, cmd);
  }

  // Register slash commands with Discord API
  try {
    // For development: register per-guild for instant updates
    // For production: register globally
    const guilds = client.guilds.cache;
    for (const [guildId] of guilds) {
      await registerCommands(client, allCommands, guildId);
    }
  } catch (error) {
    console.error('Failed to register commands:', error);
  }

  // Start tick scheduler
  startTickScheduler(client);

  console.log('Bot is ready!');
}
