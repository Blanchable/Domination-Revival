import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  EmbedBuilder,
} from 'discord.js';
import { BotCommand } from '../client';
import { getPrisma } from '../../db/client';
import {
  getGameByGuild,
  getPlayer,
  getPlayerProvinces,
  getProvince,
  getPlayerOrders,
} from '../../db/repositories';
import { loadMap } from '../../data/mapLoader';

export const myCommand: BotCommand = {
  data: new SlashCommandBuilder()
    .setName('my')
    .setDescription('View your resources, status, and bonuses'),

  async execute(interaction: ChatInputCommandInteraction) {
    await interaction.deferReply({ ephemeral: true });

    const prisma = getPrisma();
    const guild = interaction.guild;
    if (!guild) return;

    const game = await getGameByGuild(prisma, guild.id);
    if (!game) {
      await interaction.editReply('No active game found.');
      return;
    }

    const player = await getPlayer(prisma, game.id, interaction.user.id);
    if (!player) {
      await interaction.editReply('You are not in this game.');
      return;
    }

    const ownerships = await getPlayerProvinces(prisma, game.id, player.id);

    // Calculate total outputs
    let totalGoldOut = 0;
    let totalFoodOut = 0;
    let totalFaithOut = 0;
    let totalRegulars = 0;
    let totalMercs = 0;

    for (const o of ownerships) {
      totalGoldOut += o.goldOut;
      totalFoodOut += o.foodOut;
      totalFaithOut += o.faithOut;
      if (o.province.armyStack) {
        totalRegulars += o.province.armyStack.regularCount;
        totalMercs += o.province.armyStack.mercCount;
      }
    }

    const orders = await getPlayerOrders(prisma, game.id, player.id, game.turnNumber);

    const embed = new EmbedBuilder()
      .setTitle(`${player.displayName}'s Status`)
      .setColor(player.isAlive ? 0x00ae86 : 0xff0000)
      .addFields(
        { name: 'Gold', value: `${player.gold}`, inline: true },
        { name: 'Food', value: `${player.food}`, inline: true },
        { name: 'Faith', value: `${player.faith}`, inline: true },
        { name: 'Gold/turn', value: `+${totalGoldOut}`, inline: true },
        { name: 'Food/turn', value: `+${totalFoodOut}`, inline: true },
        { name: 'Faith/turn', value: `+${totalFaithOut}`, inline: true },
        { name: 'Provinces', value: `${ownerships.length}`, inline: true },
        { name: 'Regular Troops', value: `${totalRegulars}`, inline: true },
        { name: 'Mercenaries', value: `${totalMercs}`, inline: true },
        { name: 'Pending Orders', value: `${orders.length}`, inline: true },
        { name: 'Blessed', value: player.blessingActive ? 'Yes (+1 dice)' : 'No', inline: true },
        { name: 'Excommunicated', value: player.excommunicated ? 'Yes' : 'No', inline: true },
      );

    if (game.popePlayerId === player.id) {
      embed.addFields({
        name: 'Pope',
        value: `You are the Pope! (until turn ${game.popeUntilTurn})`,
        inline: false,
      });
    }

    await interaction.editReply({ embeds: [embed] });
  },
};

export const holdingsCommand: BotCommand = {
  data: new SlashCommandBuilder()
    .setName('holdings')
    .setDescription('View all your provinces with details'),

  async execute(interaction: ChatInputCommandInteraction) {
    await interaction.deferReply({ ephemeral: true });

    const prisma = getPrisma();
    const guild = interaction.guild;
    if (!guild) return;

    const game = await getGameByGuild(prisma, guild.id);
    if (!game) {
      await interaction.editReply('No active game found.');
      return;
    }

    const player = await getPlayer(prisma, game.id, interaction.user.id);
    if (!player) {
      await interaction.editReply('You are not in this game.');
      return;
    }

    const ownerships = await getPlayerProvinces(prisma, game.id, player.id);

    if (ownerships.length === 0) {
      await interaction.editReply('You own no provinces.');
      return;
    }

    const map = loadMap(game.mapId);

    const lines = ownerships.map((o) => {
      const mapProv = map.provinces.find((p) => p.id === o.provinceId);
      const sr = map.subRegions.find((s) => s.id === mapProv?.subRegionId);
      const reg = map.regions.find((r) => r.id === mapProv?.regionId);
      const army = o.province.armyStack;
      const buildings = o.province.buildings
        .map((b) => `${b.type} T${b.tier}`)
        .join(', ') || 'None';

      return (
        `**${o.province.name}** (\`${o.provinceId}\`)\n` +
        `  Region: ${reg?.name ?? '?'} > ${sr?.name ?? '?'}\n` +
        `  Output: Gold ${o.goldOut} | Food ${o.foodOut} | Faith ${o.faithOut}\n` +
        `  Army: ${army?.regularCount ?? 0} regulars, ${army?.mercCount ?? 0} mercs\n` +
        `  Buildings: ${buildings}`
      );
    });

    // Split into multiple embeds if needed (Discord max 4096 chars per embed)
    const chunks: string[] = [];
    let current = '';
    for (const line of lines) {
      if (current.length + line.length + 2 > 3900) {
        chunks.push(current);
        current = line;
      } else {
        current += (current ? '\n\n' : '') + line;
      }
    }
    if (current) chunks.push(current);

    const embeds = chunks.map((chunk, i) =>
      new EmbedBuilder()
        .setTitle(i === 0 ? `${player.displayName}'s Holdings` : `Holdings (cont.)`)
        .setColor(0x00ae86)
        .setDescription(chunk)
    );

    await interaction.editReply({ embeds: embeds.slice(0, 10) });
  },
};

export const mapInfoCommand: BotCommand = {
  data: new SlashCommandBuilder()
    .setName('map')
    .setDescription('View province information')
    .addStringOption((opt) =>
      opt
        .setName('province_id')
        .setDescription('Province ID (e.g., P0001)')
        .setRequired(true)
    ),

  async execute(interaction: ChatInputCommandInteraction) {
    await interaction.deferReply({ ephemeral: true });

    const prisma = getPrisma();
    const guild = interaction.guild;
    if (!guild) return;

    const game = await getGameByGuild(prisma, guild.id);
    if (!game) {
      await interaction.editReply('No active game found.');
      return;
    }

    const provinceId = interaction.options.getString('province_id', true).toUpperCase();
    const province = await getProvince(prisma, game.id, provinceId);
    if (!province) {
      await interaction.editReply(`Province **${provinceId}** not found.`);
      return;
    }

    const map = loadMap(game.mapId);
    const mapProv = map.provinces.find((p) => p.id === provinceId);
    const sr = map.subRegions.find((s) => s.id === province.subRegionId);
    const reg = map.regions.find((r) => r.id === province.regionId);

    const buildings = province.buildings
      .map((b) => `${b.type} T${b.tier}`)
      .join(', ') || 'None';

    const neighbors = province.adjacency.slice(0, 15).join(', ') +
      (province.adjacency.length > 15 ? ` (+${province.adjacency.length - 15} more)` : '');

    const embed = new EmbedBuilder()
      .setTitle(`${province.name} (${provinceId})`)
      .setColor(province.ownerPlayerId ? 0xffd700 : 0x808080)
      .addFields(
        { name: 'Region', value: reg?.name ?? 'Unknown', inline: true },
        { name: 'Sub-Region', value: sr?.name ?? 'Unknown', inline: true },
        {
          name: 'Owner',
          value: province.ownerPlayerId ? `Owned` : 'Unclaimed',
          inline: true,
        },
      );

    if (province.ownership) {
      embed.addFields(
        { name: 'Gold Output', value: `${province.ownership.goldOut}`, inline: true },
        { name: 'Food Output', value: `${province.ownership.foodOut}`, inline: true },
        { name: 'Faith Output', value: `${province.ownership.faithOut}`, inline: true },
      );
    }

    if (province.armyStack) {
      embed.addFields(
        { name: 'Regulars', value: `${province.armyStack.regularCount}`, inline: true },
        { name: 'Mercenaries', value: `${province.armyStack.mercCount}`, inline: true },
      );
    }

    embed.addFields(
      { name: 'Buildings', value: buildings, inline: false },
      { name: 'Neighbors', value: neighbors || 'None', inline: false },
    );

    await interaction.editReply({ embeds: [embed] });
  },
};
