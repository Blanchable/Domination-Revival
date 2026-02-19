import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  ChannelType,
  PermissionFlagsBits,
  EmbedBuilder,
} from 'discord.js';
import { BotCommand } from '../client';
import { getPrisma } from '../../db/client';
import { getGameByGuild, createPlayer, getPlayer } from '../../db/repositories';
import { GameStatus } from '@prisma/client';

export const joinCommand: BotCommand = {
  data: new SlashCommandBuilder()
    .setName('join')
    .setDescription('Join the current game'),

  async execute(interaction: ChatInputCommandInteraction) {
    await interaction.deferReply({ ephemeral: true });

    const prisma = getPrisma();
    const guild = interaction.guild;
    if (!guild) {
      await interaction.editReply('This command must be used in a server.');
      return;
    }

    const game = await getGameByGuild(prisma, guild.id);
    if (!game) {
      await interaction.editReply('No active game found.');
      return;
    }
    if (game.status !== GameStatus.JOINING) {
      await interaction.editReply(`Game is not accepting players (status: ${game.status}).`);
      return;
    }

    // Check join deadline
    if (game.joinDeadline && new Date() > game.joinDeadline) {
      await interaction.editReply('The join deadline has passed.');
      return;
    }

    // Check if already joined
    const existing = await getPlayer(prisma, game.id, interaction.user.id);
    if (existing) {
      await interaction.editReply('You have already joined this game!');
      return;
    }

    try {
      // Create private order channel
      const category = game.categoryId
        ? guild.channels.cache.get(game.categoryId)
        : null;

      const displayName =
        interaction.member && 'displayName' in interaction.member
          ? (interaction.member.displayName as string)
          : interaction.user.displayName ?? interaction.user.username;

      const channelName = `orders-${displayName.toLowerCase().replace(/[^a-z0-9]/g, '-').slice(0, 20)}`;

      const orderChannel = await guild.channels.create({
        name: channelName,
        type: ChannelType.GuildText,
        parent: category?.id,
        permissionOverwrites: [
          {
            id: guild.id, // @everyone
            deny: [PermissionFlagsBits.ViewChannel],
          },
          {
            id: interaction.user.id,
            allow: [
              PermissionFlagsBits.ViewChannel,
              PermissionFlagsBits.SendMessages,
              PermissionFlagsBits.ReadMessageHistory,
            ],
          },
          {
            id: guild.members.me!.id, // bot
            allow: [
              PermissionFlagsBits.ViewChannel,
              PermissionFlagsBits.SendMessages,
              PermissionFlagsBits.ManageMessages,
            ],
          },
        ],
      });

      const player = await createPlayer(prisma, {
        gameId: game.id,
        discordUserId: interaction.user.id,
        displayName,
        orderChannelId: orderChannel.id,
      });

      await interaction.editReply(
        `You have joined **${game.name}**!\nYour private orders channel: <#${orderChannel.id}>`
      );

      // Welcome message in player channel
      await orderChannel.send({
        embeds: [
          new EmbedBuilder()
            .setTitle(`Welcome, ${displayName}!`)
            .setColor(0x00ae86)
            .setDescription(
              `This is your private orders channel for **${game.name}**.\n\n` +
              `**Available Commands:**\n` +
              `\`/pick <province>\` - Pick a province during draft\n` +
              `\`/move <from> <to> <troops> <mercs>\` - Order troop movement\n` +
              `\`/build <province> <type>\` - Build a new building\n` +
              `\`/upgrade <province> <type>\` - Upgrade existing building\n` +
              `\`/recruit <province> <regulars> <mercs>\` - Recruit units\n` +
              `\`/my\` - View your resources and status\n` +
              `\`/holdings\` - View your provinces\n` +
              `\`/map <province>\` - Inspect a province\n\n` +
              `Waiting for draft to begin...`
            ),
        ],
      });

      // Announce in lobby
      if (game.lobbyChannelId) {
        const lobby = guild.channels.cache.get(game.lobbyChannelId);
        if (lobby?.isTextBased()) {
          await lobby.send(`**${displayName}** has joined the game!`);
        }
      }
    } catch (err) {
      console.error('Error joining game:', err);
      await interaction.editReply('Failed to join game. Check bot permissions.');
    }
  },
};

export const leaveCommand: BotCommand = {
  data: new SlashCommandBuilder()
    .setName('leave')
    .setDescription('Leave the current game (only during JOINING phase)'),

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
    if (game.status !== GameStatus.JOINING) {
      await interaction.editReply('You can only leave during the JOINING phase.');
      return;
    }

    const player = await getPlayer(prisma, game.id, interaction.user.id);
    if (!player) {
      await interaction.editReply('You are not in this game.');
      return;
    }

    // Delete order channel
    if (player.orderChannelId) {
      try {
        const ch = guild.channels.cache.get(player.orderChannelId);
        if (ch) await ch.delete('Player left game');
      } catch {}
    }

    await prisma.player.delete({ where: { id: player.id } });

    await interaction.editReply(`You have left **${game.name}**.`);
  },
};
