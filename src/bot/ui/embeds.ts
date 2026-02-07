import { EmbedBuilder } from 'discord.js';
import { TickSummary } from '../../engine/tick';

/**
 * Create a formatted tick results embed.
 */
export function createTickResultEmbed(summary: TickSummary): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setTitle(`Turn ${summary.turnNumber} Results`)
    .setColor(0x00ae86)
    .setTimestamp();

  const lines: string[] = [];

  if (summary.battles > 0) {
    lines.push(`Battles fought: **${summary.battles}**`);
  }
  if (summary.captures > 0) {
    lines.push(`Provinces captured: **${summary.captures}**`);
  }
  if (summary.eliminations.length > 0) {
    lines.push(`Eliminated: **${summary.eliminations.join(', ')}**`);
  }
  if (summary.newPope) {
    lines.push(`New Pope elected: **${summary.newPope}**`);
  }

  lines.push('');
  lines.push('Submit your orders for the next turn!');

  embed.setDescription(lines.join('\n'));
  return embed;
}

/**
 * Create a player status embed.
 */
export function createPlayerStatusEmbed(
  displayName: string,
  data: {
    gold: number;
    food: number;
    faith: number;
    goldPerTurn: number;
    foodPerTurn: number;
    faithPerTurn: number;
    provinces: number;
    regulars: number;
    mercs: number;
    isPope: boolean;
    isBlessed: boolean;
    isExcommunicated: boolean;
    isAlive: boolean;
  }
): EmbedBuilder {
  return new EmbedBuilder()
    .setTitle(`${displayName}`)
    .setColor(data.isAlive ? 0x00ae86 : 0xff0000)
    .addFields(
      { name: 'Gold', value: `${data.gold} (+${data.goldPerTurn}/turn)`, inline: true },
      { name: 'Food', value: `${data.food} (+${data.foodPerTurn}/turn)`, inline: true },
      { name: 'Faith', value: `${data.faith} (+${data.faithPerTurn}/turn)`, inline: true },
      { name: 'Provinces', value: `${data.provinces}`, inline: true },
      { name: 'Regular Troops', value: `${data.regulars}`, inline: true },
      { name: 'Mercenaries', value: `${data.mercs}`, inline: true },
    );
}

/**
 * Create a battle report embed.
 */
export function createBattleEmbed(
  provinceId: string,
  provinceName: string,
  attackerName: string,
  defenderName: string,
  attackerUnits: { regulars: number; mercs: number },
  defenderUnits: { regulars: number; mercs: number },
  winnerName: string,
  rounds: number
): EmbedBuilder {
  return new EmbedBuilder()
    .setTitle(`Battle at ${provinceName} (${provinceId})`)
    .setColor(0xff0000)
    .addFields(
      {
        name: 'Attacker',
        value: `${attackerName}\n${attackerUnits.regulars} regulars, ${attackerUnits.mercs} mercs`,
        inline: true,
      },
      {
        name: 'Defender',
        value: `${defenderName}\n${defenderUnits.regulars} regulars, ${defenderUnits.mercs} mercs`,
        inline: true,
      },
      { name: 'Winner', value: winnerName, inline: false },
      { name: 'Combat Rounds', value: `${rounds}`, inline: true },
    );
}

/**
 * Create province info embed.
 */
export function createProvinceEmbed(
  id: string,
  name: string,
  data: {
    regionName: string;
    subRegionName: string;
    ownerName: string | null;
    goldOut?: number;
    foodOut?: number;
    faithOut?: number;
    regulars?: number;
    mercs?: number;
    buildings: string;
    neighbors: string;
  }
): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setTitle(`${name} (${id})`)
    .setColor(data.ownerName ? 0xffd700 : 0x808080)
    .addFields(
      { name: 'Region', value: data.regionName, inline: true },
      { name: 'Sub-Region', value: data.subRegionName, inline: true },
      { name: 'Owner', value: data.ownerName ?? 'Unclaimed', inline: true },
    );

  if (data.goldOut !== undefined) {
    embed.addFields(
      { name: 'Gold Output', value: `${data.goldOut}`, inline: true },
      { name: 'Food Output', value: `${data.foodOut ?? 0}`, inline: true },
      { name: 'Faith Output', value: `${data.faithOut ?? 0}`, inline: true },
    );
  }

  if (data.regulars !== undefined) {
    embed.addFields(
      { name: 'Regulars', value: `${data.regulars}`, inline: true },
      { name: 'Mercenaries', value: `${data.mercs ?? 0}`, inline: true },
    );
  }

  embed.addFields(
    { name: 'Buildings', value: data.buildings || 'None', inline: false },
    { name: 'Adjacent', value: data.neighbors || 'None', inline: false },
  );

  return embed;
}
