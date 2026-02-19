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
  getProvince,
  upsertOrder,
  getPlayerOrders,
  deleteOrder,
} from '../../db/repositories';
import { GameStatus, OrderType } from '@prisma/client';
import {
  MoveOrderPayload,
  BuildOrderPayload,
  UpgradeOrderPayload,
  RecruitOrderPayload,
} from '../../utils/validation';
import {
  BUILDING_COSTS,
  MAX_BUILDING_TIER,
  MAX_BUILDINGS_PER_PROVINCE,
  RECRUIT_REGULAR_GOLD,
  RECRUIT_REGULAR_FOOD,
  RECRUIT_MERC_GOLD,
} from '../../engine/rules';

// ─── /move ──────────────────────────────────────────────────────────────────

export const moveCommand: BotCommand = {
  data: new SlashCommandBuilder()
    .setName('move')
    .setDescription('Order troops to move to an adjacent province')
    .addStringOption((opt) =>
      opt.setName('from').setDescription('Origin province ID').setRequired(true)
    )
    .addStringOption((opt) =>
      opt.setName('to').setDescription('Target province ID').setRequired(true)
    )
    .addIntegerOption((opt) =>
      opt
        .setName('troops')
        .setDescription('Number of regular troops to move')
        .setMinValue(0)
        .setRequired(true)
    )
    .addIntegerOption((opt) =>
      opt
        .setName('mercs')
        .setDescription('Number of mercenaries to move')
        .setMinValue(0)
        .setRequired(false)
    ),

  async execute(interaction: ChatInputCommandInteraction) {
    await interaction.deferReply({ ephemeral: true });

    const prisma = getPrisma();
    const guild = interaction.guild;
    if (!guild) return;

    const game = await getGameByGuild(prisma, guild.id);
    if (!game || game.status !== GameStatus.ACTIVE) {
      await interaction.editReply('Game is not active.');
      return;
    }

    const player = await getPlayer(prisma, game.id, interaction.user.id);
    if (!player || !player.isAlive) {
      await interaction.editReply('You are not alive in this game.');
      return;
    }

    const fromId = interaction.options.getString('from', true).toUpperCase();
    const toId = interaction.options.getString('to', true).toUpperCase();
    const troops = interaction.options.getInteger('troops', true);
    const mercs = interaction.options.getInteger('mercs') ?? 0;

    // Validate origin province
    const fromProvince = await getProvince(prisma, game.id, fromId);
    if (!fromProvince || fromProvince.ownerPlayerId !== player.id) {
      await interaction.editReply(`You don't own province **${fromId}**.`);
      return;
    }

    // Validate target exists
    const toProvince = await getProvince(prisma, game.id, toId);
    if (!toProvince) {
      await interaction.editReply(`Province **${toId}** not found.`);
      return;
    }

    // Validate adjacency
    if (!fromProvince.adjacency.includes(toId)) {
      await interaction.editReply(
        `**${toId}** is not adjacent to **${fromId}**. Adjacent: ${fromProvince.adjacency.slice(0, 10).join(', ')}`
      );
      return;
    }

    // Validate troops
    const army = fromProvince.armyStack;
    if (!army) {
      await interaction.editReply(`No army stationed in **${fromId}**.`);
      return;
    }

    if (troops > army.regularCount || mercs > army.mercCount) {
      await interaction.editReply(
        `Not enough units in **${fromId}**. Available: ${army.regularCount} regulars, ${army.mercCount} mercs.`
      );
      return;
    }

    if (troops === 0 && mercs === 0) {
      await interaction.editReply('You must commit at least some units.');
      return;
    }

    const payload = MoveOrderPayload.parse({
      fromProvinceId: fromId,
      toProvinceId: toId,
      troopsCommitted: troops,
      mercsCommitted: mercs,
    });

    await upsertOrder(prisma, {
      gameId: game.id,
      playerId: player.id,
      turnNumber: game.turnNumber,
      type: OrderType.MOVE,
      payload,
    });

    await interaction.editReply({
      embeds: [
        new EmbedBuilder()
          .setTitle('Move Order Queued')
          .setColor(0x5865f2)
          .setDescription(
            `**${fromId}** -> **${toId}**\n` +
            `Troops: ${troops} regulars, ${mercs} mercs\n` +
            `Remaining in ${fromId}: ${army.regularCount - troops} regulars, ${army.mercCount - mercs} mercs`
          ),
      ],
    });
  },
};

// ─── /build ─────────────────────────────────────────────────────────────────

export const buildCommand: BotCommand = {
  data: new SlashCommandBuilder()
    .setName('build')
    .setDescription('Build a new building in a province')
    .addStringOption((opt) =>
      opt.setName('province').setDescription('Province ID').setRequired(true)
    )
    .addStringOption((opt) =>
      opt
        .setName('type')
        .setDescription('Building type')
        .setRequired(true)
        .addChoices(
          { name: 'Mint (+Gold)', value: 'MINT' },
          { name: 'Granary (+Food)', value: 'GRANARY' },
          { name: 'Shrine (+Faith)', value: 'SHRINE' },
          { name: 'Barracks (-Upkeep)', value: 'BARRACKS' },
          { name: 'Fortress (+Defense)', value: 'FORTRESS' }
        )
    ),

  async execute(interaction: ChatInputCommandInteraction) {
    await interaction.deferReply({ ephemeral: true });

    const prisma = getPrisma();
    const guild = interaction.guild;
    if (!guild) return;

    const game = await getGameByGuild(prisma, guild.id);
    if (!game || game.status !== GameStatus.ACTIVE) {
      await interaction.editReply('Game is not active.');
      return;
    }

    const player = await getPlayer(prisma, game.id, interaction.user.id);
    if (!player || !player.isAlive) {
      await interaction.editReply('You are not alive in this game.');
      return;
    }

    const provinceId = interaction.options.getString('province', true).toUpperCase();
    const buildingType = interaction.options.getString('type', true);

    const province = await getProvince(prisma, game.id, provinceId);
    if (!province || province.ownerPlayerId !== player.id) {
      await interaction.editReply(`You don't own province **${provinceId}**.`);
      return;
    }

    // Check building slots
    if (province.buildings.length >= MAX_BUILDINGS_PER_PROVINCE) {
      await interaction.editReply(
        `Province **${provinceId}** already has ${MAX_BUILDINGS_PER_PROVINCE} buildings.`
      );
      return;
    }

    // Check no duplicate type
    if (province.buildings.some((b) => b.type === buildingType)) {
      await interaction.editReply(
        `Province **${provinceId}** already has a ${buildingType}. Use \`/upgrade\` instead.`
      );
      return;
    }

    // Check cost
    const cost = BUILDING_COSTS[1];
    if (player.gold < cost) {
      await interaction.editReply(`Not enough gold. Cost: ${cost}, You have: ${player.gold}.`);
      return;
    }

    const payload = BuildOrderPayload.parse({
      provinceId,
      buildingType,
    });

    await upsertOrder(prisma, {
      gameId: game.id,
      playerId: player.id,
      turnNumber: game.turnNumber,
      type: OrderType.BUILD,
      payload,
    });

    await interaction.editReply({
      embeds: [
        new EmbedBuilder()
          .setTitle('Build Order Queued')
          .setColor(0xffd700)
          .setDescription(
            `Build **${buildingType}** in **${province.name}** (${provinceId})\n` +
            `Cost: ${cost} Gold (deducted at tick)`
          ),
      ],
    });
  },
};

// ─── /upgrade ───────────────────────────────────────────────────────────────

export const upgradeCommand: BotCommand = {
  data: new SlashCommandBuilder()
    .setName('upgrade')
    .setDescription('Upgrade an existing building in a province')
    .addStringOption((opt) =>
      opt.setName('province').setDescription('Province ID').setRequired(true)
    )
    .addStringOption((opt) =>
      opt
        .setName('type')
        .setDescription('Building type to upgrade')
        .setRequired(true)
        .addChoices(
          { name: 'Mint', value: 'MINT' },
          { name: 'Granary', value: 'GRANARY' },
          { name: 'Shrine', value: 'SHRINE' },
          { name: 'Barracks', value: 'BARRACKS' },
          { name: 'Fortress', value: 'FORTRESS' }
        )
    ),

  async execute(interaction: ChatInputCommandInteraction) {
    await interaction.deferReply({ ephemeral: true });

    const prisma = getPrisma();
    const guild = interaction.guild;
    if (!guild) return;

    const game = await getGameByGuild(prisma, guild.id);
    if (!game || game.status !== GameStatus.ACTIVE) {
      await interaction.editReply('Game is not active.');
      return;
    }

    const player = await getPlayer(prisma, game.id, interaction.user.id);
    if (!player || !player.isAlive) {
      await interaction.editReply('You are not alive in this game.');
      return;
    }

    const provinceId = interaction.options.getString('province', true).toUpperCase();
    const buildingType = interaction.options.getString('type', true);

    const province = await getProvince(prisma, game.id, provinceId);
    if (!province || province.ownerPlayerId !== player.id) {
      await interaction.editReply(`You don't own province **${provinceId}**.`);
      return;
    }

    // Find existing building
    const building = province.buildings.find((b) => b.type === buildingType);
    if (!building) {
      await interaction.editReply(
        `No ${buildingType} in **${provinceId}**. Use \`/build\` first.`
      );
      return;
    }

    if (building.tier >= MAX_BUILDING_TIER) {
      await interaction.editReply(`${buildingType} is already at max tier ${MAX_BUILDING_TIER}.`);
      return;
    }

    const nextTier = building.tier + 1;
    const cost = BUILDING_COSTS[nextTier];

    if (player.gold < cost) {
      await interaction.editReply(
        `Not enough gold. Upgrade to T${nextTier} costs ${cost}, you have: ${player.gold}.`
      );
      return;
    }

    const payload = UpgradeOrderPayload.parse({
      provinceId,
      buildingType,
    });

    await upsertOrder(prisma, {
      gameId: game.id,
      playerId: player.id,
      turnNumber: game.turnNumber,
      type: OrderType.UPGRADE,
      payload,
    });

    await interaction.editReply({
      embeds: [
        new EmbedBuilder()
          .setTitle('Upgrade Order Queued')
          .setColor(0xffd700)
          .setDescription(
            `Upgrade **${buildingType}** in **${province.name}** (${provinceId}) to T${nextTier}\n` +
            `Cost: ${cost} Gold (deducted at tick)`
          ),
      ],
    });
  },
};

// ─── /recruit ───────────────────────────────────────────────────────────────

export const recruitCommand: BotCommand = {
  data: new SlashCommandBuilder()
    .setName('recruit')
    .setDescription('Recruit troops in a province')
    .addStringOption((opt) =>
      opt.setName('province').setDescription('Province ID').setRequired(true)
    )
    .addIntegerOption((opt) =>
      opt
        .setName('regulars')
        .setDescription('Number of regular troops')
        .setMinValue(0)
        .setRequired(false)
    )
    .addIntegerOption((opt) =>
      opt
        .setName('mercs')
        .setDescription('Number of mercenaries')
        .setMinValue(0)
        .setRequired(false)
    ),

  async execute(interaction: ChatInputCommandInteraction) {
    await interaction.deferReply({ ephemeral: true });

    const prisma = getPrisma();
    const guild = interaction.guild;
    if (!guild) return;

    const game = await getGameByGuild(prisma, guild.id);
    if (!game || game.status !== GameStatus.ACTIVE) {
      await interaction.editReply('Game is not active.');
      return;
    }

    const player = await getPlayer(prisma, game.id, interaction.user.id);
    if (!player || !player.isAlive) {
      await interaction.editReply('You are not alive in this game.');
      return;
    }

    const provinceId = interaction.options.getString('province', true).toUpperCase();
    const regulars = interaction.options.getInteger('regulars') ?? 0;
    const mercs = interaction.options.getInteger('mercs') ?? 0;

    if (regulars === 0 && mercs === 0) {
      await interaction.editReply('You must recruit at least some units.');
      return;
    }

    const province = await getProvince(prisma, game.id, provinceId);
    if (!province || province.ownerPlayerId !== player.id) {
      await interaction.editReply(`You don't own province **${provinceId}**.`);
      return;
    }

    // Cost check
    const goldCost = regulars * RECRUIT_REGULAR_GOLD + mercs * RECRUIT_MERC_GOLD;
    const foodCost = regulars * RECRUIT_REGULAR_FOOD;

    if (player.gold < goldCost || player.food < foodCost) {
      await interaction.editReply(
        `Not enough resources.\n` +
        `Cost: ${goldCost} Gold, ${foodCost} Food\n` +
        `You have: ${player.gold} Gold, ${player.food} Food`
      );
      return;
    }

    const payload = RecruitOrderPayload.parse({
      provinceId,
      regularCount: regulars,
      mercCount: mercs,
    });

    await upsertOrder(prisma, {
      gameId: game.id,
      playerId: player.id,
      turnNumber: game.turnNumber,
      type: OrderType.RECRUIT,
      payload,
    });

    await interaction.editReply({
      embeds: [
        new EmbedBuilder()
          .setTitle('Recruit Order Queued')
          .setColor(0x00ff00)
          .setDescription(
            `Recruit in **${province.name}** (${provinceId}):\n` +
            `Regulars: ${regulars} (${regulars * RECRUIT_REGULAR_GOLD}G, ${regulars * RECRUIT_REGULAR_FOOD}F)\n` +
            `Mercs: ${mercs} (${mercs * RECRUIT_MERC_GOLD}G)\n` +
            `Total: ${goldCost} Gold, ${foodCost} Food (deducted at tick)`
          ),
      ],
    });
  },
};

// ─── /orders ────────────────────────────────────────────────────────────────

export const ordersCommand: BotCommand = {
  data: new SlashCommandBuilder()
    .setName('orders')
    .setDescription('View your pending orders for this turn'),

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

    const orders = await getPlayerOrders(prisma, game.id, player.id, game.turnNumber);

    if (orders.length === 0) {
      await interaction.editReply('You have no pending orders for this turn.');
      return;
    }

    const lines = orders.map((o, i) => {
      const p = o.payload as Record<string, any>;
      let desc = '';
      switch (o.type) {
        case 'MOVE':
          desc = `${p.fromProvinceId} -> ${p.toProvinceId} (${p.troopsCommitted}T, ${p.mercsCommitted}M)`;
          break;
        case 'BUILD':
          desc = `Build ${p.buildingType} in ${p.provinceId}`;
          break;
        case 'UPGRADE':
          desc = `Upgrade ${p.buildingType} in ${p.provinceId}`;
          break;
        case 'RECRUIT':
          desc = `Recruit ${p.regularCount}T, ${p.mercCount}M in ${p.provinceId}`;
          break;
        case 'DONATE':
          desc = `Donate ${p.gold}G, ${p.food}F to player`;
          break;
        case 'SUPPORT':
          desc = `Support ${p.troops}T, ${p.mercs}M`;
          break;
        case 'POPE_ACTION':
          desc = `Pope: ${p.ability}`;
          break;
        default:
          desc = JSON.stringify(p).slice(0, 60);
      }
      return `${i + 1}. **${o.type}**: ${desc} (\`${o.id.slice(0, 8)}\`)`;
    });

    await interaction.editReply({
      embeds: [
        new EmbedBuilder()
          .setTitle(`Orders for Turn ${game.turnNumber}`)
          .setColor(0x5865f2)
          .setDescription(lines.join('\n'))
          .setFooter({ text: 'Use /cancel <order_id> to cancel an order' }),
      ],
    });
  },
};

// ─── /cancel ────────────────────────────────────────────────────────────────

export const cancelCommand: BotCommand = {
  data: new SlashCommandBuilder()
    .setName('cancel')
    .setDescription('Cancel a pending order')
    .addStringOption((opt) =>
      opt
        .setName('order_id')
        .setDescription('Order ID (from /orders)')
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

    const player = await getPlayer(prisma, game.id, interaction.user.id);
    if (!player) {
      await interaction.editReply('You are not in this game.');
      return;
    }

    const orderId = interaction.options.getString('order_id', true);

    // Find order (match by prefix)
    const orders = await getPlayerOrders(prisma, game.id, player.id, game.turnNumber);
    const order = orders.find((o) => o.id.startsWith(orderId));

    if (!order) {
      await interaction.editReply(`Order not found. Use \`/orders\` to see your pending orders.`);
      return;
    }

    await deleteOrder(prisma, order.id);
    await interaction.editReply(`Order **${order.type}** cancelled.`);
  },
};
