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
  getPlayerById,
  upsertOrder,
} from '../../db/repositories';
import { GameStatus, OrderType } from '@prisma/client';
import { PopeActionPayload } from '../../utils/validation';
import { POPE_ABILITY_COSTS, POPE_ABILITIES_PER_TICK } from '../../engine/rules';

export const popeCommand: BotCommand = {
  data: new SlashCommandBuilder()
    .setName('pope')
    .setDescription('Pope abilities (Pope only)')
    .addSubcommand((sub) =>
      sub
        .setName('cast')
        .setDescription('Cast a Pope ability')
        .addStringOption((opt) =>
          opt
            .setName('ability')
            .setDescription('Ability to cast')
            .setRequired(true)
            .addChoices(
              { name: 'Blessing (+1 dice, 120 Faith)', value: 'BLESSING' },
              { name: 'Excommunication (block donations, 160 Faith)', value: 'EXCOMMUNICATION' },
              { name: 'Tithe (gain 150 Gold, 100 Faith)', value: 'TITHE' },
              { name: 'Interdict (block building upgrade, 200 Faith)', value: 'INTERDICT' }
            )
        )
        .addUserOption((opt) =>
          opt.setName('target_player').setDescription('Target player (for Blessing/Excommunication)').setRequired(false)
        )
        .addStringOption((opt) =>
          opt.setName('target_province').setDescription('Target province (for Interdict)').setRequired(false)
        )
    )
    .addSubcommand((sub) =>
      sub.setName('info').setDescription('View Pope status and abilities')
    ) as SlashCommandBuilder,

  async execute(interaction: ChatInputCommandInteraction) {
    const subcommand = interaction.options.getSubcommand();
    const prisma = getPrisma();

    switch (subcommand) {
      case 'cast':
        await handleCast(interaction, prisma);
        break;
      case 'info':
        await handleInfo(interaction, prisma);
        break;
    }
  },
};

async function handleCast(interaction: ChatInputCommandInteraction, prisma: any) {
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

  // Check Pope
  if (game.popePlayerId !== player.id) {
    await interaction.editReply('Only the Pope can cast abilities.');
    return;
  }

  const ability = interaction.options.getString('ability', true) as
    | 'BLESSING'
    | 'EXCOMMUNICATION'
    | 'TITHE'
    | 'INTERDICT';

  // Check ability limit
  const existingPopeOrders = await prisma.order.findMany({
    where: {
      gameId: game.id,
      playerId: player.id,
      turnNumber: game.turnNumber,
      type: OrderType.POPE_ACTION,
    },
  });

  if (existingPopeOrders.length >= POPE_ABILITIES_PER_TICK) {
    await interaction.editReply(
      `You can only cast ${POPE_ABILITIES_PER_TICK} Pope ability per tick.`
    );
    return;
  }

  // Check faith cost
  const cost = POPE_ABILITY_COSTS[ability];
  if (player.faith < cost) {
    await interaction.editReply(
      `Not enough faith. ${ability} costs ${cost} Faith, you have ${player.faith}.`
    );
    return;
  }

  // Validate targets
  let targetPlayerId: string | undefined;
  let targetProvinceId: string | undefined;

  if (ability === 'BLESSING' || ability === 'EXCOMMUNICATION') {
    const targetUser = interaction.options.getUser('target_player');
    if (!targetUser) {
      await interaction.editReply(`${ability} requires a target player.`);
      return;
    }
    const target = await getPlayer(prisma, game.id, targetUser.id);
    if (!target || !target.isAlive) {
      await interaction.editReply('Target player not found or not alive.');
      return;
    }
    if (ability === 'EXCOMMUNICATION' && target.id === player.id) {
      await interaction.editReply('Cannot excommunicate yourself.');
      return;
    }
    targetPlayerId = target.id;
  } else if (ability === 'INTERDICT') {
    const provinceIdStr = interaction.options.getString('target_province');
    if (!provinceIdStr) {
      await interaction.editReply('INTERDICT requires a target province.');
      return;
    }
    targetProvinceId = provinceIdStr.toUpperCase();
  }
  // TITHE is self-only, no target needed

  const payload = PopeActionPayload.parse({
    ability,
    targetPlayerId,
    targetProvinceId,
  });

  await upsertOrder(prisma, {
    gameId: game.id,
    playerId: player.id,
    turnNumber: game.turnNumber,
    type: OrderType.POPE_ACTION,
    payload,
  });

  await interaction.editReply({
    embeds: [
      new EmbedBuilder()
        .setTitle('Pope Ability Queued')
        .setColor(0x9b59b6)
        .setDescription(
          `**${ability}** queued (${cost} Faith, deducted at tick)\n` +
          (targetPlayerId ? `Target player: yes` : '') +
          (targetProvinceId ? `Target province: ${targetProvinceId}` : '')
        ),
    ],
  });
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

  let popeName = 'None';
  if (game.popePlayerId) {
    const pope = await getPlayerById(prisma, game.popePlayerId);
    popeName = pope?.displayName ?? 'Unknown';
  }

  const abilities = Object.entries(POPE_ABILITY_COSTS)
    .map(([name, cost]) => `**${name}**: ${cost} Faith`)
    .join('\n');

  await interaction.editReply({
    embeds: [
      new EmbedBuilder()
        .setTitle('Pope Status')
        .setColor(0x9b59b6)
        .addFields(
          { name: 'Current Pope', value: popeName, inline: true },
          { name: 'Term Until', value: game.popeUntilTurn ? `Turn ${game.popeUntilTurn}` : 'N/A', inline: true },
          { name: 'Abilities', value: abilities, inline: false },
        ),
    ],
  });
}
