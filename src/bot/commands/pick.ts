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
  getGamePlayers,
  getProvince,
  updateGame,
  createDraftPick,
  getDraftPicks,
} from '../../db/repositories';
import { GameStatus } from '@prisma/client';
import {
  STARTING_GOLD,
  STARTING_FOOD,
  STARTING_FAITH,
  STARTING_REGULAR_TROOPS,
  STARTING_MERCS,
  rollProvinceOutputs,
} from '../../engine/rules';
import { createSeed, createRng } from '../../utils/rng';

export const pickCommand: BotCommand = {
  data: new SlashCommandBuilder()
    .setName('pick')
    .setDescription('Pick a province during the draft')
    .addStringOption((opt) =>
      opt
        .setName('province_id')
        .setDescription('Province ID to pick (e.g., P0001)')
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
    if (game.status !== GameStatus.DRAFT) {
      await interaction.editReply('Not in draft phase.');
      return;
    }

    const player = await getPlayer(prisma, game.id, interaction.user.id);
    if (!player) {
      await interaction.editReply('You are not in this game.');
      return;
    }

    // Check if it's this player's turn (snake draft)
    const currentPickerId = getCurrentDraftPickerId(game);
    if (player.id !== currentPickerId) {
      const players = await getGamePlayers(prisma, game.id);
      const currentPicker = players.find((p) => p.id === currentPickerId);
      await interaction.editReply(
        `It's not your turn! Current pick: **${currentPicker?.displayName ?? 'Unknown'}**`
      );
      return;
    }

    const provinceId = interaction.options.getString('province_id', true).toUpperCase();

    // Check province exists and is unclaimed
    const province = await getProvince(prisma, game.id, provinceId);
    if (!province) {
      await interaction.editReply(`Province **${provinceId}** not found.`);
      return;
    }
    if (province.ownerPlayerId) {
      await interaction.editReply(`Province **${provinceId}** is already claimed.`);
      return;
    }

    // Perform the pick
    const draftPicks = await getDraftPicks(prisma, game.id);
    const pickIndex = draftPicks.length;

    // Roll province outputs
    const seed = createSeed(game.id, 0, `draft-pick-${pickIndex}`);
    const rng = createRng(seed);
    const outputs = rollProvinceOutputs(rng);

    // Transaction: create pick, set ownership, create army stack
    await prisma.$transaction(async (tx: any) => {
      // Create draft pick
      await tx.draftPick.create({
        data: {
          gameId: game.id,
          playerId: player.id,
          provinceId,
          round: game.draftRound,
          pickIndex,
        },
      });

      // Set province ownership
      await tx.province.update({
        where: { id_gameId: { id: provinceId, gameId: game.id } },
        data: { ownerPlayerId: player.id },
      });

      // Create ownership record with outputs
      await tx.provinceOwnership.create({
        data: {
          gameId: game.id,
          provinceId,
          ownerPlayerId: player.id,
          goldOut: outputs.goldOut,
          foodOut: outputs.foodOut,
          faithOut: outputs.faithOut,
        },
      });

      // Create army stack (only for first province)
      const existingPicks = draftPicks.filter((p) => p.playerId === player.id);
      if (existingPicks.length === 0) {
        // First pick: place starting troops here
        await tx.armyStack.create({
          data: {
            gameId: game.id,
            provinceId,
            ownerPlayerId: player.id,
            regularCount: STARTING_REGULAR_TROOPS,
            mercCount: 0,
          },
        });
      } else {
        // Additional picks: no troops
        await tx.armyStack.create({
          data: {
            gameId: game.id,
            provinceId,
            ownerPlayerId: player.id,
            regularCount: 0,
            mercCount: 0,
          },
        });
      }

      // Advance draft state
      const nextState = advanceDraft(game);
      await tx.game.update({
        where: { id: game.id },
        data: nextState,
      });

      // If draft is complete, assign starting resources to all players
      if (nextState.status === GameStatus.ACTIVE) {
        const allPlayers = await tx.player.findMany({
          where: { gameId: game.id },
        });
        for (const p of allPlayers) {
          await tx.player.update({
            where: { id: p.id },
            data: {
              gold: STARTING_GOLD,
              food: STARTING_FOOD,
              faith: STARTING_FAITH,
            },
          });
        }
      }
    });

    // Reply to picker
    await interaction.editReply({
      embeds: [
        new EmbedBuilder()
          .setTitle('Province Picked!')
          .setColor(0x00ff00)
          .addFields(
            { name: 'Province', value: `${province.name} (${provinceId})`, inline: true },
            { name: 'Gold Output', value: `${outputs.goldOut}`, inline: true },
            { name: 'Food Output', value: `${outputs.foodOut}`, inline: true },
            { name: 'Faith Output', value: `${outputs.faithOut}`, inline: true },
          ),
      ],
    });

    // Re-fetch game state to check if draft ended
    const updatedGame = await prisma.game.findUnique({ where: { id: game.id } });
    if (!updatedGame) return;

    // Announce pick
    if (game.announcementChannelId) {
      const channel = guild.channels.cache.get(game.announcementChannelId);
      if (channel?.isTextBased()) {
        if (updatedGame.status === GameStatus.ACTIVE) {
          // Draft complete!
          await channel.send({
            embeds: [
              new EmbedBuilder()
                .setTitle('Draft Complete!')
                .setColor(0x00ae86)
                .setDescription(
                  `All players have picked their provinces. The game is now **ACTIVE**!\n\n` +
                  `Submit your orders before the daily tick at **${game.tickTime} ${game.tickTZ}**.`
                ),
            ],
          });
        } else {
          // Announce pick and next picker
          const players = await getGamePlayers(prisma, game.id);
          const nextPickerId = getCurrentDraftPickerId(updatedGame);
          const nextPicker = players.find((p) => p.id === nextPickerId);

          await channel.send(
            `**${player.displayName}** picked **${province.name}** (${provinceId}).\n` +
            `Next pick: **${nextPicker?.displayName ?? 'Unknown'}**`
          );

          // Notify next picker
          if (nextPicker?.orderChannelId) {
            const ch = guild.channels.cache.get(nextPicker.orderChannelId);
            if (ch?.isTextBased()) {
              await ch.send({
                embeds: [
                  new EmbedBuilder()
                    .setTitle('Your Turn to Pick!')
                    .setColor(0x00ff00)
                    .setDescription(
                      `It's your turn to pick a province!\nUse \`/pick <province_id>\` to choose.`
                    ),
                ],
              });
            }
          }
        }
      }
    }
  },
};

/**
 * Get the current picker ID based on snake draft order.
 * Snake: Round 1: 0..N-1, Round 2: N-1..0, Round 3: 0..N-1, etc.
 */
function getCurrentDraftPickerId(game: {
  draftOrder: string[];
  draftRound: number;
  draftIndex: number;
}): string | null {
  const order = game.draftOrder;
  if (!order.length) return null;

  const isReversed = game.draftRound % 2 === 0; // Even rounds go in reverse
  const index = isReversed
    ? order.length - 1 - game.draftIndex
    : game.draftIndex;

  return order[index] ?? null;
}

/**
 * Advance draft state. Returns the update data for the game.
 */
function advanceDraft(game: {
  id: string;
  draftOrder: string[];
  draftRound: number;
  draftIndex: number;
  startingProvinces: number;
}): { draftRound: number; draftIndex: number; status?: GameStatus } {
  const n = game.draftOrder.length;
  let nextIndex = game.draftIndex + 1;
  let nextRound = game.draftRound;

  if (nextIndex >= n) {
    nextIndex = 0;
    nextRound++;
  }

  // Check if draft is complete
  if (nextRound > game.startingProvinces) {
    return {
      draftRound: nextRound,
      draftIndex: 0,
      status: GameStatus.ACTIVE,
    };
  }

  return { draftRound: nextRound, draftIndex: nextIndex };
}
