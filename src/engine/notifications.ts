import { Client, EmbedBuilder, TextChannel } from 'discord.js';
import { PrismaClient, Game, Player } from '@prisma/client';
import { TickSummary } from './tick';

/**
 * Send tick results to announcement channel and individual player channels.
 */
export async function broadcastTickResults(
  client: Client,
  prisma: PrismaClient,
  game: Game,
  summary: TickSummary
): Promise<void> {
  if (!game.guildId) return;

  const guild = client.guilds.cache.get(game.guildId);
  if (!guild) return;

  // Post to announcements
  await postAnnouncementSummary(guild, game, summary);

  // Post battle details
  await postBattleReports(guild, prisma, game, summary);

  // Notify individual players
  await notifyPlayers(guild, prisma, game, summary);
}

async function postAnnouncementSummary(
  guild: any,
  game: Game,
  summary: TickSummary
): Promise<void> {
  if (!game.announcementChannelId) return;

  const channel = guild.channels.cache.get(game.announcementChannelId) as TextChannel | undefined;
  if (!channel) return;

  const embed = new EmbedBuilder()
    .setTitle(`Turn ${summary.turnNumber} Complete`)
    .setColor(0x00ae86)
    .setTimestamp();

  const lines: string[] = [];
  lines.push(`**Phases:** ${summary.phases.length} completed`);

  if (summary.battles > 0) {
    lines.push(`**Battles:** ${summary.battles}`);
  }
  if (summary.captures > 0) {
    lines.push(`**Provinces Captured:** ${summary.captures}`);
  }
  if (summary.eliminations.length > 0) {
    lines.push(`**Eliminated:** ${summary.eliminations.join(', ')}`);
  }
  if (summary.newPope) {
    lines.push(`**New Pope:** ${summary.newPope}`);
  }

  lines.push('');
  lines.push(`Turn **${summary.turnNumber + 1}** has begun. Submit your orders!`);

  embed.setDescription(lines.join('\n'));

  try {
    await channel.send({ embeds: [embed] });
  } catch (err) {
    console.error('Failed to post announcement:', err);
  }
}

async function postBattleReports(
  guild: any,
  prisma: PrismaClient,
  game: Game,
  summary: TickSummary
): Promise<void> {
  if (!game.announcementChannelId || summary.battles === 0) return;

  const channel = guild.channels.cache.get(game.announcementChannelId) as TextChannel | undefined;
  if (!channel) return;

  const battleLogs = await prisma.battleLog.findMany({
    where: { gameId: game.id, turnNumber: summary.turnNumber },
    take: 25, // Limit to avoid spam
  });

  if (battleLogs.length === 0) return;

  const province_cache = new Map<string, string>();

  const lines: string[] = [];
  for (const bl of battleLogs) {
    let provinceName = province_cache.get(bl.provinceId);
    if (!provinceName) {
      const prov = await prisma.province.findUnique({
        where: { id_gameId: { id: bl.provinceId, gameId: game.id } },
      });
      provinceName = prov?.name ?? bl.provinceId;
      province_cache.set(bl.provinceId, provinceName);
    }

    const result = bl.resultJson as any;
    const au = bl.attackerUnits as any;
    const du = bl.defenderUnits as any;

    let attackerName = 'Unknown';
    let defenderName = 'Unknown';

    if (bl.attackerPlayerId) {
      const p = await prisma.player.findUnique({ where: { id: bl.attackerPlayerId } });
      attackerName = p?.displayName ?? 'Unknown';
    }
    if (bl.defenderPlayerId) {
      const p = await prisma.player.findUnique({ where: { id: bl.defenderPlayerId } });
      defenderName = p?.displayName ?? 'Unknown';
    }

    const winnerLabel = result.winner
      ? (result.winner === bl.attackerPlayerId ? attackerName : defenderName)
      : 'Draw';

    lines.push(
      `**${provinceName}** (${bl.provinceId}): ` +
      `${attackerName} (${au.regulars}T/${au.mercs}M) vs ${defenderName} (${du.regulars}T/${du.mercs}M) ` +
      `- Winner: **${winnerLabel}**`
    );
  }

  const embed = new EmbedBuilder()
    .setTitle('Battle Reports')
    .setColor(0xff4444)
    .setDescription(lines.join('\n').slice(0, 4000));

  try {
    await channel.send({ embeds: [embed] });
  } catch (err) {
    console.error('Failed to post battle reports:', err);
  }
}

async function notifyPlayers(
  guild: any,
  prisma: PrismaClient,
  game: Game,
  summary: TickSummary
): Promise<void> {
  const players = await prisma.player.findMany({
    where: { gameId: game.id },
  });

  for (const player of players) {
    if (!player.orderChannelId) continue;

    const ch = guild.channels.cache.get(player.orderChannelId) as TextChannel | undefined;
    if (!ch) continue;

    try {
      // Fetch updated player data
      const updated = await prisma.player.findUnique({ where: { id: player.id } });
      if (!updated) continue;

      const embed = new EmbedBuilder()
        .setTitle(`Turn ${summary.turnNumber} Summary`)
        .setColor(updated.isAlive ? 0x00ae86 : 0xff0000)
        .setTimestamp();

      if (!updated.isAlive) {
        embed.setDescription(
          'You have been **eliminated** from the game.\n' +
          'All your provinces, armies, and resources have been lost.'
        );
      } else {
        // Count provinces and armies
        const provinceCount = await prisma.provinceOwnership.count({
          where: { gameId: game.id, ownerPlayerId: player.id },
        });

        const armies = await prisma.armyStack.findMany({
          where: { gameId: game.id, ownerPlayerId: player.id },
        });
        const totalReg = armies.reduce((s, a) => s + a.regularCount, 0);
        const totalMerc = armies.reduce((s, a) => s + a.mercCount, 0);

        // Check if involved in battles
        const playerBattles = await prisma.battleLog.count({
          where: {
            gameId: game.id,
            turnNumber: summary.turnNumber,
            OR: [
              { attackerPlayerId: player.id },
              { defenderPlayerId: player.id },
            ],
          },
        });

        const lines: string[] = [];
        lines.push(`**Resources:** ${updated.gold} Gold, ${updated.food} Food, ${updated.faith} Faith`);
        lines.push(`**Provinces:** ${provinceCount}`);
        lines.push(`**Army:** ${totalReg} regulars, ${totalMerc} mercs`);

        if (playerBattles > 0) {
          lines.push(`**Battles this turn:** ${playerBattles}`);
        }

        if (updated.blessingActive) {
          lines.push('**Blessed** by the Pope (+1 dice next battle)');
        }
        if (updated.excommunicated) {
          lines.push('**Excommunicated** - cannot send/receive alliance support');
        }

        lines.push('');
        lines.push('Use `/my` for full details. Submit orders for the next turn!');

        embed.setDescription(lines.join('\n'));
      }

      await ch.send({ embeds: [embed] });
    } catch {
      // Channel might be inaccessible
    }
  }
}

/**
 * Send a notification to a specific player's order channel.
 */
export async function notifyPlayer(
  client: Client,
  game: Game,
  player: Player,
  embed: EmbedBuilder
): Promise<void> {
  if (!game.guildId || !player.orderChannelId) return;

  const guild = client.guilds.cache.get(game.guildId);
  if (!guild) return;

  const ch = guild.channels.cache.get(player.orderChannelId) as TextChannel | undefined;
  if (!ch) return;

  try {
    await ch.send({ embeds: [embed] });
  } catch {
    // Channel might be inaccessible
  }
}
