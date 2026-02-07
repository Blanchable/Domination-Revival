import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  PermissionFlagsBits,
  ChannelType,
  EmbedBuilder,
} from 'discord.js';
import { BotCommand } from '../client';
import { getPrisma } from '../../db/client';
import { loadMap } from '../../data/mapLoader';
import { getHowToPlayEmbeds } from '../ui/howToPlay';
import {
  createGame,
  getGameByGuild,
  updateGameStatus,
  updateGame,
  getGamePlayers,
} from '../../db/repositories';
import { loadProvincesIntoGame } from '../../db/repositories';
import { GameStatus } from '@prisma/client';
import { createSeed, createRng } from '../../utils/rng';

export const gameCommand: BotCommand = {
  data: new SlashCommandBuilder()
    .setName('game')
    .setDescription('Game management commands (admin only)')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addSubcommand((sub) =>
      sub
        .setName('create')
        .setDescription('Create a new game')
        .addStringOption((opt) =>
          opt.setName('name').setDescription('Game name').setRequired(true)
        )
        .addStringOption((opt) =>
          opt.setName('map').setDescription('Map ID (default: "default")').setRequired(false)
        )
        .addStringOption((opt) =>
          opt
            .setName('tick_time')
            .setDescription('Daily tick time HH:MM (default: 12:00)')
            .setRequired(false)
        )
        .addStringOption((opt) =>
          opt
            .setName('tick_tz')
            .setDescription('Timezone (default: America/New_York)')
            .setRequired(false)
        )
        .addIntegerOption((opt) =>
          opt
            .setName('starting_provinces')
            .setDescription('Provinces per player in draft (default: 3)')
            .setMinValue(1)
            .setMaxValue(5)
            .setRequired(false)
        )
    )
    .addSubcommand((sub) =>
      sub
        .setName('open_join')
        .setDescription('Open game for players to join')
        .addIntegerOption((opt) =>
          opt
            .setName('hours')
            .setDescription('Duration in hours (default: 24)')
            .setMinValue(1)
            .setMaxValue(168)
            .setRequired(false)
        )
    )
    .addSubcommand((sub) =>
      sub.setName('begin').setDescription('End join phase and start the draft')
    )
    .addSubcommand((sub) =>
      sub.setName('end').setDescription('End the current game')
    )
    .addSubcommand((sub) =>
      sub.setName('status').setDescription('Show current game status')
    ) as SlashCommandBuilder,

  async execute(interaction: ChatInputCommandInteraction) {
    const subcommand = interaction.options.getSubcommand();
    const prisma = getPrisma();

    switch (subcommand) {
      case 'create':
        await handleCreate(interaction, prisma);
        break;
      case 'open_join':
        await handleOpenJoin(interaction, prisma);
        break;
      case 'begin':
        await handleBegin(interaction, prisma);
        break;
      case 'end':
        await handleEnd(interaction, prisma);
        break;
      case 'status':
        await handleStatus(interaction, prisma);
        break;
    }
  },
};

async function handleCreate(interaction: ChatInputCommandInteraction, prisma: any) {
  await interaction.deferReply({ ephemeral: true });

  const guild = interaction.guild;
  if (!guild) {
    await interaction.editReply('This command must be used in a server.');
    return;
  }

  // Check no active game exists
  const existing = await getGameByGuild(prisma, guild.id);
  if (existing) {
    await interaction.editReply(
      `A game already exists in this server: **${existing.name}** (${existing.status}). End it first with \`/game end\`.`
    );
    return;
  }

  const name = interaction.options.getString('name', true);
  const mapId = interaction.options.getString('map') ?? 'default';
  const tickTime = interaction.options.getString('tick_time') ?? '12:00';
  const tickTZ = interaction.options.getString('tick_tz') ?? 'America/New_York';
  const startingProvinces = interaction.options.getInteger('starting_provinces') ?? 3;

  try {
    // Create Discord channels
    const category = await guild.channels.create({
      name: `GAME - ${name}`,
      type: ChannelType.GuildCategory,
    });

    const announcementChannel = await guild.channels.create({
      name: 'announcements',
      type: ChannelType.GuildText,
      parent: category.id,
    });

    const lobbyChannel = await guild.channels.create({
      name: 'lobby',
      type: ChannelType.GuildText,
      parent: category.id,
    });

    const mapChannel = await guild.channels.create({
      name: 'map',
      type: ChannelType.GuildText,
      parent: category.id,
    });

    const howToPlayChannel = await guild.channels.create({
      name: 'how-to-play',
      type: ChannelType.GuildText,
      parent: category.id,
    });

    // Post how-to-play content
    const howToPlayEmbeds = getHowToPlayEmbeds();
    for (const embed of howToPlayEmbeds) {
      await howToPlayChannel.send({ embeds: [embed] });
    }

    // Create game in DB
    const game = await createGame(prisma, {
      name,
      mapId,
      tickTime,
      tickTZ,
      startingProvinces,
      guildId: guild.id,
      categoryId: category.id,
      announcementChannelId: announcementChannel.id,
      lobbyChannelId: lobbyChannel.id,
      mapChannelId: mapChannel.id,
    });

    // Load map provinces into DB
    const map = loadMap(mapId);
    const count = await loadProvincesIntoGame(prisma, game.id, map);

    const embed = new EmbedBuilder()
      .setTitle('Game Created')
      .setColor(0x00ae86)
      .addFields(
        { name: 'Name', value: name, inline: true },
        { name: 'Map', value: `${map.name} (${count} provinces)`, inline: true },
        { name: 'Tick', value: `${tickTime} ${tickTZ}`, inline: true },
        { name: 'Starting Provinces', value: `${startingProvinces}`, inline: true },
        { name: 'Status', value: 'CREATED', inline: true }
      )
      .setDescription('Use `/game open_join` to let players join.');

    await interaction.editReply({ embeds: [embed] });

    await announcementChannel.send({
      embeds: [
        new EmbedBuilder()
          .setTitle(`Welcome to ${name}!`)
          .setColor(0x00ae86)
          .setDescription(
            `A new grand strategy game has been created.\n\n` +
            `**Map:** ${map.name} (${count} provinces, ${map.regions.length} regions)\n` +
            `**Daily Tick:** ${tickTime} ${tickTZ}\n` +
            `**Starting Provinces:** ${startingProvinces} per player\n\n` +
            `Waiting for admin to open joining...`
          ),
      ],
    });
  } catch (err) {
    console.error('Error creating game:', err);
    await interaction.editReply('Failed to create game. Check bot permissions.');
  }
}

async function handleOpenJoin(interaction: ChatInputCommandInteraction, prisma: any) {
  await interaction.deferReply({ ephemeral: true });

  const guild = interaction.guild;
  if (!guild) return;

  const game = await getGameByGuild(prisma, guild.id);
  if (!game) {
    await interaction.editReply('No active game found. Create one with `/game create`.');
    return;
  }
  if (game.status !== GameStatus.CREATED) {
    await interaction.editReply(`Game is already in ${game.status} phase.`);
    return;
  }

  const hours = interaction.options.getInteger('hours') ?? 24;
  const deadline = new Date(Date.now() + hours * 60 * 60 * 1000);

  await updateGame(prisma, game.id, {
    status: GameStatus.JOINING,
    joinDeadline: deadline,
  });

  await interaction.editReply(`Join phase opened for ${hours} hours (until <t:${Math.floor(deadline.getTime() / 1000)}:F>).`);

  // Announce in lobby
  if (game.lobbyChannelId) {
    const lobby = guild.channels.cache.get(game.lobbyChannelId);
    if (lobby?.isTextBased()) {
      await lobby.send({
        embeds: [
          new EmbedBuilder()
            .setTitle('Joining is Open!')
            .setColor(0xffd700)
            .setDescription(
              `Use \`/join\` to enter the game!\n\n` +
              `Join deadline: <t:${Math.floor(deadline.getTime() / 1000)}:F>\n` +
              `Starting provinces per player: ${game.startingProvinces}`
            ),
        ],
      });
    }
  }
}

async function handleBegin(interaction: ChatInputCommandInteraction, prisma: any) {
  await interaction.deferReply({ ephemeral: true });

  const guild = interaction.guild;
  if (!guild) return;

  const game = await getGameByGuild(prisma, guild.id);
  if (!game) {
    await interaction.editReply('No active game found.');
    return;
  }
  if (game.status !== GameStatus.JOINING) {
    await interaction.editReply(`Cannot begin: game is in ${game.status} phase.`);
    return;
  }

  const players = await getGamePlayers(prisma, game.id);
  if (players.length < 2) {
    await interaction.editReply(`Need at least 2 players to begin. Currently: ${players.length}.`);
    return;
  }

  // Generate snake draft order
  const seed = createSeed(game.id, 0, 'draft');
  const rng = createRng(seed);
  const playerIds = players.map((p) => p.id);
  rng.shuffle(playerIds);

  await updateGame(prisma, game.id, {
    status: GameStatus.DRAFT,
    draftOrder: playerIds,
    draftRound: 1,
    draftIndex: 0,
  });

  // Find current picker
  const firstPicker = players.find((p) => p.id === playerIds[0]);

  await interaction.editReply(
    `Draft phase started! ${players.length} players, ${game.startingProvinces} rounds.\n` +
    `Draft order generated. First pick: **${firstPicker?.displayName}**`
  );

  // Announce
  if (game.announcementChannelId) {
    const channel = guild.channels.cache.get(game.announcementChannelId);
    if (channel?.isTextBased()) {
      const orderList = playerIds
        .map((id, i) => {
          const p = players.find((pl) => pl.id === id);
          return `${i + 1}. ${p?.displayName ?? 'Unknown'}`;
        })
        .join('\n');

      await channel.send({
        embeds: [
          new EmbedBuilder()
            .setTitle('Draft Phase Started!')
            .setColor(0xff6b35)
            .setDescription(
              `Each player will pick ${game.startingProvinces} provinces in snake draft order.\n\n` +
              `**Draft Order:**\n${orderList}\n\n` +
              `Use \`/pick <province_id>\` in your private channel when it's your turn.\n` +
              `Current pick: **${firstPicker?.displayName}**`
            ),
        ],
      });
    }
  }

  // Notify first picker in their private channel
  if (firstPicker?.orderChannelId) {
    const ch = guild.channels.cache.get(firstPicker.orderChannelId);
    if (ch?.isTextBased()) {
      await ch.send({
        embeds: [
          new EmbedBuilder()
            .setTitle('Your Turn to Pick!')
            .setColor(0x00ff00)
            .setDescription(
              `It's your turn to pick a province!\n` +
              `Use \`/pick <province_id>\` to choose.\n` +
              `Use \`/map <province_id>\` to inspect a province.`
            ),
        ],
      });
    }
  }
}

async function handleEnd(interaction: ChatInputCommandInteraction, prisma: any) {
  await interaction.deferReply({ ephemeral: true });

  const guild = interaction.guild;
  if (!guild) return;

  const game = await getGameByGuild(prisma, guild.id);
  if (!game) {
    await interaction.editReply('No active game found.');
    return;
  }

  await updateGameStatus(prisma, game.id, GameStatus.ENDED);
  await interaction.editReply(`Game **${game.name}** has been ended.`);

  if (game.announcementChannelId) {
    const channel = guild.channels.cache.get(game.announcementChannelId);
    if (channel?.isTextBased()) {
      await channel.send({
        embeds: [
          new EmbedBuilder()
            .setTitle('Game Over')
            .setColor(0xff0000)
            .setDescription(`**${game.name}** has been ended by an administrator.`),
        ],
      });
    }
  }
}

async function handleStatus(interaction: ChatInputCommandInteraction, prisma: any) {
  await interaction.deferReply({ ephemeral: true });

  const guild = interaction.guild;
  if (!guild) return;

  const game = await getGameByGuild(prisma, guild.id);
  if (!game) {
    await interaction.editReply('No active game found in this server.');
    return;
  }

  const players = await getGamePlayers(prisma, game.id);
  const alivePlayers = players.filter((p) => p.isAlive);

  const embed = new EmbedBuilder()
    .setTitle(`Game: ${game.name}`)
    .setColor(0x5865f2)
    .addFields(
      { name: 'Status', value: game.status, inline: true },
      { name: 'Turn', value: `${game.turnNumber}`, inline: true },
      { name: 'Players', value: `${alivePlayers.length} alive / ${players.length} total`, inline: true },
      { name: 'Tick', value: `${game.tickTime} ${game.tickTZ}`, inline: true },
      {
        name: 'Pope',
        value: game.popePlayerId
          ? `<@${players.find((p) => p.id === game.popePlayerId)?.discordUserId ?? 'unknown'}> (until turn ${game.popeUntilTurn})`
          : 'None',
        inline: true,
      }
    );

  await interaction.editReply({ embeds: [embed] });
}
