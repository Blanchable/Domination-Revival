import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  ChannelType,
  PermissionFlagsBits,
  EmbedBuilder,
} from 'discord.js';
import { BotCommand } from '../client';
import { getPrisma } from '../../db/client';
import {
  getGameByGuild,
  getPlayer,
  getPlayerById,
  getPlayerAlliance,
  createAlliance,
  addAllianceMember,
  upsertOrder,
} from '../../db/repositories';
import { GameStatus, OrderType } from '@prisma/client';
import {
  AllianceInvitePayload,
  AllianceAcceptPayload,
  AllianceRenamePayload,
  DonatePayload,
  SupportPayload,
} from '../../utils/validation';
import { DONATION_CAP_PERCENT } from '../../engine/rules';

export const allianceCommand: BotCommand = {
  data: new SlashCommandBuilder()
    .setName('alliance')
    .setDescription('Alliance management commands')
    .addSubcommand((sub) =>
      sub
        .setName('invite')
        .setDescription('Invite a player to form/join your alliance')
        .addUserOption((opt) =>
          opt.setName('player').setDescription('Player to invite').setRequired(true)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName('accept')
        .setDescription('Accept an alliance invitation')
        .addStringOption((opt) =>
          opt.setName('alliance_id').setDescription('Alliance ID').setRequired(true)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName('rename')
        .setDescription('Rename your alliance (creator only)')
        .addStringOption((opt) =>
          opt.setName('name').setDescription('New alliance name').setRequired(true)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName('info')
        .setDescription('View your alliance info')
    ) as SlashCommandBuilder,

  async execute(interaction: ChatInputCommandInteraction) {
    const subcommand = interaction.options.getSubcommand();
    const prisma = getPrisma();

    switch (subcommand) {
      case 'invite':
        await handleInvite(interaction, prisma);
        break;
      case 'accept':
        await handleAccept(interaction, prisma);
        break;
      case 'rename':
        await handleRename(interaction, prisma);
        break;
      case 'info':
        await handleInfo(interaction, prisma);
        break;
    }
  },
};

async function handleInvite(interaction: ChatInputCommandInteraction, prisma: any) {
  await interaction.deferReply({ ephemeral: true });
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

  const targetUser = interaction.options.getUser('player', true);
  const targetPlayer = await getPlayer(prisma, game.id, targetUser.id);
  if (!targetPlayer || !targetPlayer.isAlive) {
    await interaction.editReply('Target player not found or not alive.');
    return;
  }

  if (targetPlayer.id === player.id) {
    await interaction.editReply('You cannot invite yourself.');
    return;
  }

  // Check if target already in an alliance
  const targetAlliance = await getPlayerAlliance(prisma, game.id, targetPlayer.id);
  if (targetAlliance) {
    await interaction.editReply(`${targetPlayer.displayName} is already in alliance **${targetAlliance.name}**.`);
    return;
  }

  // Check if inviter has alliance, create if not
  let alliance = await getPlayerAlliance(prisma, game.id, player.id);
  if (!alliance) {
    // Create new alliance
    const allianceName = `${player.displayName}'s Alliance`;

    const category = game.categoryId
      ? guild.channels.cache.get(game.categoryId)
      : null;

    const allianceChannel = await guild.channels.create({
      name: `alliance-${allianceName.toLowerCase().replace(/[^a-z0-9]/g, '-').slice(0, 20)}`,
      type: ChannelType.GuildText,
      parent: category?.id,
      permissionOverwrites: [
        {
          id: guild.id,
          deny: [PermissionFlagsBits.ViewChannel],
        },
        {
          id: interaction.user.id,
          allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages],
        },
        {
          id: guild.members.me!.id,
          allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages],
        },
      ],
    });

    alliance = await createAlliance(prisma, {
      gameId: game.id,
      name: allianceName,
      creatorPlayerId: player.id,
      channelId: allianceChannel.id,
    });
  }

  // Create invite order
  const payload = AllianceInvitePayload.parse({ inviteePlayerId: targetPlayer.id });
  await upsertOrder(prisma, {
    gameId: game.id,
    playerId: player.id,
    turnNumber: game.turnNumber,
    type: OrderType.ALLIANCE_INVITE,
    payload,
  });

  // Notify target player
  if (targetPlayer.orderChannelId) {
    const ch = guild.channels.cache.get(targetPlayer.orderChannelId);
    if (ch?.isTextBased()) {
      await ch.send({
        embeds: [
          new EmbedBuilder()
            .setTitle('Alliance Invitation!')
            .setColor(0xffd700)
            .setDescription(
              `**${player.displayName}** has invited you to join **${alliance.name}**!\n\n` +
              `Use \`/alliance accept ${alliance.id}\` to accept.`
            ),
        ],
      });
    }
  }

  await interaction.editReply(`Alliance invitation sent to **${targetPlayer.displayName}**.`);
}

async function handleAccept(interaction: ChatInputCommandInteraction, prisma: any) {
  await interaction.deferReply({ ephemeral: true });
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

  // Check not already in alliance
  const existing = await getPlayerAlliance(prisma, game.id, player.id);
  if (existing) {
    await interaction.editReply(`You are already in alliance **${existing.name}**.`);
    return;
  }

  const allianceId = interaction.options.getString('alliance_id', true);

  const alliance = await prisma.alliance.findUnique({
    where: { id: allianceId },
    include: { members: true },
  });

  if (!alliance || alliance.gameId !== game.id) {
    await interaction.editReply('Alliance not found.');
    return;
  }

  // Check there was an invite
  const invite = await prisma.order.findFirst({
    where: {
      gameId: game.id,
      type: OrderType.ALLIANCE_INVITE,
      turnNumber: game.turnNumber,
      payload: { path: ['inviteePlayerId'], equals: player.id },
    },
  });

  if (!invite) {
    await interaction.editReply('No pending invitation found for you.');
    return;
  }

  // Add member
  await addAllianceMember(prisma, alliance.id, player.id);

  // Add channel permissions
  if (alliance.channelId) {
    const ch = guild.channels.cache.get(alliance.channelId);
    if (ch && 'permissionOverwrites' in ch) {
      await ch.permissionOverwrites.edit(interaction.user.id, {
        ViewChannel: true,
        SendMessages: true,
        ReadMessageHistory: true,
      });
    }

    if (ch?.isTextBased()) {
      await ch.send(`**${player.displayName}** has joined the alliance!`);
    }
  }

  // Delete the invite order
  await prisma.order.delete({ where: { id: invite.id } });

  await interaction.editReply(`You have joined **${alliance.name}**!`);
}

async function handleRename(interaction: ChatInputCommandInteraction, prisma: any) {
  await interaction.deferReply({ ephemeral: true });
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

  const alliance = await getPlayerAlliance(prisma, game.id, player.id);
  if (!alliance) {
    await interaction.editReply('You are not in an alliance.');
    return;
  }

  if (alliance.creatorPlayerId !== player.id) {
    await interaction.editReply('Only the alliance creator can rename it.');
    return;
  }

  const newName = interaction.options.getString('name', true);

  await prisma.alliance.update({
    where: { id: alliance.id },
    data: { name: newName },
  });

  await interaction.editReply(`Alliance renamed to **${newName}**.`);
}

async function handleInfo(interaction: ChatInputCommandInteraction, prisma: any) {
  await interaction.deferReply({ ephemeral: true });
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

  const alliance = await getPlayerAlliance(prisma, game.id, player.id);
  if (!alliance) {
    await interaction.editReply('You are not in an alliance.');
    return;
  }

  const memberNames: string[] = [];
  for (const m of alliance.members) {
    const p = await getPlayerById(prisma, m.playerId);
    memberNames.push(p?.displayName ?? 'Unknown');
  }

  await interaction.editReply({
    embeds: [
      new EmbedBuilder()
        .setTitle(`Alliance: ${alliance.name}`)
        .setColor(0xffd700)
        .addFields(
          { name: 'Members', value: memberNames.join(', ') || 'None' },
          { name: 'ID', value: `\`${alliance.id}\`` },
        ),
    ],
  });
}

// ─── /send (Gold/Food donations) ────────────────────────────────────────────

export const sendCommand: BotCommand = {
  data: new SlashCommandBuilder()
    .setName('send')
    .setDescription('Send gold or food to an ally')
    .addUserOption((opt) =>
      opt.setName('ally').setDescription('Alliance member to send to').setRequired(true)
    )
    .addIntegerOption((opt) =>
      opt.setName('gold').setDescription('Gold to send').setMinValue(0).setRequired(false)
    )
    .addIntegerOption((opt) =>
      opt.setName('food').setDescription('Food to send').setMinValue(0).setRequired(false)
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

    if (player.excommunicated) {
      await interaction.editReply('You are excommunicated and cannot send/receive alliance support this turn.');
      return;
    }

    const gold = interaction.options.getInteger('gold') ?? 0;
    const food = interaction.options.getInteger('food') ?? 0;

    if (gold === 0 && food === 0) {
      await interaction.editReply('You must send at least some resources.');
      return;
    }

    // Check alliance membership
    const alliance = await getPlayerAlliance(prisma, game.id, player.id);
    if (!alliance) {
      await interaction.editReply('You must be in an alliance to send resources.');
      return;
    }

    const targetUser = interaction.options.getUser('ally', true);
    const targetPlayer = await getPlayer(prisma, game.id, targetUser.id);
    if (!targetPlayer || !targetPlayer.isAlive) {
      await interaction.editReply('Target player not found or not alive.');
      return;
    }

    // Check same alliance
    const targetAlliance = await getPlayerAlliance(prisma, game.id, targetPlayer.id);
    if (!targetAlliance || targetAlliance.id !== alliance.id) {
      await interaction.editReply('Target must be in the same alliance.');
      return;
    }

    // Check caps
    const goldCap = Math.floor(player.gold * DONATION_CAP_PERCENT);
    const foodCap = Math.floor(player.food * DONATION_CAP_PERCENT);

    if (gold > goldCap) {
      await interaction.editReply(`Gold cap: ${goldCap} (40% of ${player.gold}).`);
      return;
    }
    if (food > foodCap) {
      await interaction.editReply(`Food cap: ${foodCap} (40% of ${player.food}).`);
      return;
    }

    const payload = DonatePayload.parse({
      recipientPlayerId: targetPlayer.id,
      gold,
      food,
    });

    await upsertOrder(prisma, {
      gameId: game.id,
      playerId: player.id,
      turnNumber: game.turnNumber,
      type: OrderType.DONATE,
      payload,
    });

    await interaction.editReply(
      `Donation queued: **${gold}** Gold, **${food}** Food to **${targetPlayer.displayName}** (applied at tick).`
    );
  },
};

// ─── /support (Troop transfer) ──────────────────────────────────────────────

export const supportCommand: BotCommand = {
  data: new SlashCommandBuilder()
    .setName('support')
    .setDescription('Send troops to an ally')
    .addUserOption((opt) =>
      opt.setName('ally').setDescription('Alliance member to support').setRequired(true)
    )
    .addIntegerOption((opt) =>
      opt.setName('troops').setDescription('Regular troops to send').setMinValue(0).setRequired(false)
    )
    .addIntegerOption((opt) =>
      opt.setName('mercs').setDescription('Mercenaries to send').setMinValue(0).setRequired(false)
    )
    .addStringOption((opt) =>
      opt.setName('to_province').setDescription('Target province for arrival').setRequired(false)
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

    const troops = interaction.options.getInteger('troops') ?? 0;
    const mercs = interaction.options.getInteger('mercs') ?? 0;

    if (troops === 0 && mercs === 0) {
      await interaction.editReply('You must support with at least some units.');
      return;
    }

    const targetUser = interaction.options.getUser('ally', true);
    const targetPlayer = await getPlayer(prisma, game.id, targetUser.id);
    if (!targetPlayer || !targetPlayer.isAlive) {
      await interaction.editReply('Target not found or not alive.');
      return;
    }

    // Check alliance
    const alliance = await getPlayerAlliance(prisma, game.id, player.id);
    const targetAlliance = await getPlayerAlliance(prisma, game.id, targetPlayer.id);
    if (!alliance || !targetAlliance || alliance.id !== targetAlliance.id) {
      await interaction.editReply('Must be in the same alliance.');
      return;
    }

    const toProvince = interaction.options.getString('to_province')?.toUpperCase();

    const payload = SupportPayload.parse({
      recipientPlayerId: targetPlayer.id,
      troops,
      mercs,
      toProvinceId: toProvince,
    });

    await upsertOrder(prisma, {
      gameId: game.id,
      playerId: player.id,
      turnNumber: game.turnNumber,
      type: OrderType.SUPPORT,
      payload,
    });

    await interaction.editReply(
      `Support order queued: **${troops}** regulars, **${mercs}** mercs to **${targetPlayer.displayName}** (applied at tick).`
    );
  },
};
