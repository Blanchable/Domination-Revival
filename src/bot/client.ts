import {
  Client,
  GatewayIntentBits,
  Partials,
  REST,
  Routes,
  Collection,
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  SharedSlashCommand,
} from 'discord.js';
import { config } from '../utils/config';

export interface BotCommand {
  data: SharedSlashCommand;
  execute: (interaction: ChatInputCommandInteraction) => Promise<void>;
}

export function createClient(): Client {
  return new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.GuildMembers,
    ],
    partials: [Partials.Channel],
  });
}

/**
 * Register slash commands with Discord API.
 */
export async function registerCommands(
  client: Client,
  commands: BotCommand[],
  guildId?: string
): Promise<void> {
  const rest = new REST({ version: '10' }).setToken(config.discordToken);

  const commandData = commands.map((cmd) => cmd.data.toJSON());

  if (guildId) {
    // Guild-specific (instant updates, good for dev)
    await rest.put(
      Routes.applicationGuildCommands(client.user!.id, guildId),
      { body: commandData }
    );
    console.log(`Registered ${commandData.length} guild commands for ${guildId}`);
  } else {
    // Global (takes up to 1 hour to propagate)
    await rest.put(Routes.applicationCommands(client.user!.id), {
      body: commandData,
    });
    console.log(`Registered ${commandData.length} global commands`);
  }
}

export const commandCollection = new Collection<string, BotCommand>();
