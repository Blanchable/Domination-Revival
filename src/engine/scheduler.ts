import cron from 'node-cron';
import { Client, EmbedBuilder } from 'discord.js';
import { GameStatus } from '@prisma/client';
import { getPrisma } from '../db/client';
import { executeTick, TickSummary } from './tick';
import { acquireTickLock, releaseTickLock } from '../utils/lock';

/**
 * Start the tick scheduler. Runs every minute and checks if any game needs a tick.
 * Uses advisory locks to prevent double-ticking.
 */
export function startTickScheduler(client: Client): void {
  // Run every minute to check for games that need ticking
  cron.schedule('* * * * *', async () => {
    try {
      await checkAndRunTicks(client);
    } catch (error) {
      console.error('Scheduler error:', error);
    }
  });

  console.log('Tick scheduler started (checking every minute)');
}

async function checkAndRunTicks(client: Client): Promise<void> {
  const prisma = getPrisma();

  // Find all active games
  const activeGames = await prisma.game.findMany({
    where: { status: GameStatus.ACTIVE },
  });

  const now = new Date();

  for (const game of activeGames) {
    // Parse tick time
    const [hours, minutes] = game.tickTime.split(':').map(Number);

    // Convert current time to game's timezone
    const gameTime = new Date(
      now.toLocaleString('en-US', { timeZone: game.tickTZ })
    );
    const currentHour = gameTime.getHours();
    const currentMinute = gameTime.getMinutes();

    // Check if it's tick time (within the current minute)
    if (currentHour !== hours || currentMinute !== minutes) continue;

    // Check if tick already ran for this turn
    const existingTick = await prisma.tickLog.findUnique({
      where: { gameId_turnNumber: { gameId: game.id, turnNumber: game.turnNumber } },
    });

    if (existingTick?.endedAt) continue; // Already completed

    // Try to acquire lock
    const locked = await acquireTickLock(prisma, game.id);
    if (!locked) continue; // Another instance is processing

    try {
      console.log(`Running tick for game ${game.name} (turn ${game.turnNumber})`);

      const summary = await executeTick(prisma, game);

      // Post results to announcement channel
      await postTickResults(client, game, summary);

      console.log(
        `Tick complete for ${game.name}: ${summary.battles} battles, ${summary.captures} captures, ${summary.eliminations.length} eliminations`
      );
    } catch (error) {
      console.error(`Tick failed for game ${game.id}:`, error);
    } finally {
      await releaseTickLock(prisma, game.id);
    }
  }
}

/**
 * Post tick results to the game's announcement channel and individual player channels.
 */
async function postTickResults(
  client: Client,
  game: any,
  summary: TickSummary
): Promise<void> {
  if (!game.guildId || !game.announcementChannelId) return;

  const guild = client.guilds.cache.get(game.guildId);
  if (!guild) return;

  const channel = guild.channels.cache.get(game.announcementChannelId);
  if (!channel?.isTextBased()) return;

  const embed = new EmbedBuilder()
    .setTitle(`Turn ${summary.turnNumber} Results`)
    .setColor(0x00ae86)
    .setTimestamp();

  let description = `**Phases Completed:** ${summary.phases.length}\n`;

  if (summary.battles > 0) {
    description += `**Battles:** ${summary.battles}\n`;
  }
  if (summary.captures > 0) {
    description += `**Provinces Captured:** ${summary.captures}\n`;
  }
  if (summary.eliminations.length > 0) {
    description += `**Eliminated:** ${summary.eliminations.join(', ')}\n`;
  }
  if (summary.newPope) {
    description += `**New Pope:** ${summary.newPope}\n`;
  }

  description += `\nNext tick in 24 hours. Submit your orders!`;

  embed.setDescription(description);

  await channel.send({ embeds: [embed] });

  // Post battle details
  const prisma = getPrisma();
  const battleLogs = await prisma.battleLog.findMany({
    where: { gameId: game.id, turnNumber: summary.turnNumber },
  });

  if (battleLogs.length > 0) {
    const battleLines = battleLogs.map((bl) => {
      const result = bl.resultJson as any;
      const au = bl.attackerUnits as any;
      const du = bl.defenderUnits as any;
      return (
        `Province **${bl.provinceId}**: ` +
        `Attacker (${au.regulars}T/${au.mercs}M) vs Defender (${du.regulars}T/${du.mercs}M) -> ` +
        `Winner: ${result.winner ? 'resolved' : 'draw'}`
      );
    });

    const battleEmbed = new EmbedBuilder()
      .setTitle('Battle Reports')
      .setColor(0xff0000)
      .setDescription(battleLines.slice(0, 20).join('\n'));

    await channel.send({ embeds: [battleEmbed] });
  }

  // Notify individual players about their results
  const players = await prisma.player.findMany({
    where: { gameId: game.id },
  });

  for (const player of players) {
    if (!player.orderChannelId) continue;

    const ch = guild.channels.cache.get(player.orderChannelId);
    if (!ch?.isTextBased()) continue;

    try {
      const playerEmbed = new EmbedBuilder()
        .setTitle(`Turn ${summary.turnNumber} - Your Summary`)
        .setColor(player.isAlive ? 0x00ae86 : 0xff0000);

      if (!player.isAlive) {
        playerEmbed.setDescription('You have been eliminated from the game.');
      } else {
        playerEmbed.setDescription(
          `**Resources:** ${player.gold} Gold, ${player.food} Food, ${player.faith} Faith\n` +
          `Use \`/my\` for detailed status.\n` +
          `Submit orders for the next turn!`
        );
      }

      await ch.send({ embeds: [playerEmbed] });
    } catch {
      // Channel might be deleted
    }
  }
}
