import { PrismaClient, GameStatus, OrderType, BuildingType, Prisma } from '@prisma/client';
import { GameMap } from '../data/mapLoader';

// ─── Game Repository ────────────────────────────────────────────────────────

export async function createGame(
  prisma: PrismaClient,
  data: {
    name: string;
    mapId?: string;
    tickTime?: string;
    tickTZ?: string;
    startingProvinces?: number;
    guildId?: string;
    categoryId?: string;
    announcementChannelId?: string;
    lobbyChannelId?: string;
    mapChannelId?: string;
  }
) {
  return prisma.game.create({
    data: {
      name: data.name,
      mapId: data.mapId ?? 'default',
      tickTime: data.tickTime ?? '12:00',
      tickTZ: data.tickTZ ?? 'America/New_York',
      startingProvinces: data.startingProvinces ?? 3,
      guildId: data.guildId,
      categoryId: data.categoryId,
      announcementChannelId: data.announcementChannelId,
      lobbyChannelId: data.lobbyChannelId,
      mapChannelId: data.mapChannelId,
      status: GameStatus.CREATED,
    },
  });
}

export async function getGameById(prisma: PrismaClient, gameId: string) {
  return prisma.game.findUnique({ where: { id: gameId } });
}

export async function getGameByGuild(prisma: PrismaClient, guildId: string) {
  return prisma.game.findFirst({
    where: {
      guildId,
      status: { not: GameStatus.ENDED },
    },
    orderBy: { createdAt: 'desc' },
  });
}

export async function updateGameStatus(prisma: PrismaClient, gameId: string, status: GameStatus) {
  return prisma.game.update({
    where: { id: gameId },
    data: { status },
  });
}

export async function updateGame(prisma: PrismaClient, gameId: string, data: Prisma.GameUpdateInput) {
  return prisma.game.update({
    where: { id: gameId },
    data,
  });
}

// ─── Province Repository ────────────────────────────────────────────────────

export async function loadProvincesIntoGame(prisma: PrismaClient, gameId: string, map: GameMap) {
  const data = map.provinces.map((p) => ({
    id: p.id,
    gameId,
    name: p.name,
    subRegionId: p.subRegionId,
    regionId: p.regionId,
    adjacency: p.adjacency,
  }));

  // Batch insert in chunks of 100
  const CHUNK = 100;
  for (let i = 0; i < data.length; i += CHUNK) {
    const chunk = data.slice(i, i + CHUNK);
    await prisma.province.createMany({ data: chunk });
  }

  return data.length;
}

export async function getProvince(prisma: PrismaClient, gameId: string, provinceId: string) {
  return prisma.province.findUnique({
    where: { id_gameId: { id: provinceId, gameId } },
    include: { ownership: true, buildings: true, armyStack: true },
  });
}

export async function getPlayerProvinces(prisma: PrismaClient, gameId: string, playerId: string) {
  return prisma.provinceOwnership.findMany({
    where: { gameId, ownerPlayerId: playerId },
    include: { province: { include: { buildings: true, armyStack: true } } },
  });
}

// ─── Player Repository ──────────────────────────────────────────────────────

export async function createPlayer(
  prisma: PrismaClient,
  data: {
    gameId: string;
    discordUserId: string;
    displayName: string;
    orderChannelId?: string;
  }
) {
  return prisma.player.create({ data });
}

export async function getPlayer(prisma: PrismaClient, gameId: string, discordUserId: string) {
  return prisma.player.findUnique({
    where: { gameId_discordUserId: { gameId, discordUserId } },
  });
}

export async function getPlayerById(prisma: PrismaClient, playerId: string) {
  return prisma.player.findUnique({ where: { id: playerId } });
}

export async function getGamePlayers(prisma: PrismaClient, gameId: string) {
  return prisma.player.findMany({ where: { gameId } });
}

export async function getAlivePlayers(prisma: PrismaClient, gameId: string) {
  return prisma.player.findMany({ where: { gameId, isAlive: true } });
}

// ─── Order Repository ───────────────────────────────────────────────────────

export async function upsertOrder(
  prisma: PrismaClient,
  data: {
    gameId: string;
    playerId: string;
    turnNumber: number;
    type: OrderType;
    payload: Prisma.InputJsonValue;
    orderId?: string; // for updating specific order
  }
) {
  if (data.orderId) {
    return prisma.order.update({
      where: { id: data.orderId },
      data: { payload: data.payload, updatedAt: new Date() },
    });
  }

  return prisma.order.create({
    data: {
      gameId: data.gameId,
      playerId: data.playerId,
      turnNumber: data.turnNumber,
      type: data.type,
      payload: data.payload,
    },
  });
}

export async function getOrdersForTurn(prisma: PrismaClient, gameId: string, turnNumber: number) {
  return prisma.order.findMany({
    where: { gameId, turnNumber },
    orderBy: { createdAt: 'asc' },
  });
}

export async function getPlayerOrders(
  prisma: PrismaClient,
  gameId: string,
  playerId: string,
  turnNumber: number
) {
  return prisma.order.findMany({
    where: { gameId, playerId, turnNumber },
    orderBy: { createdAt: 'asc' },
  });
}

export async function deleteOrder(prisma: PrismaClient, orderId: string) {
  return prisma.order.delete({ where: { id: orderId } });
}

// ─── Draft Repository ───────────────────────────────────────────────────────

export async function createDraftPick(
  prisma: PrismaClient,
  data: {
    gameId: string;
    playerId: string;
    provinceId: string;
    round: number;
    pickIndex: number;
  }
) {
  return prisma.draftPick.create({ data });
}

export async function getDraftPicks(prisma: PrismaClient, gameId: string) {
  return prisma.draftPick.findMany({
    where: { gameId },
    orderBy: [{ round: 'asc' }, { pickIndex: 'asc' }],
  });
}

// ─── Alliance Repository ────────────────────────────────────────────────────

export async function createAlliance(
  prisma: PrismaClient,
  data: {
    gameId: string;
    name: string;
    creatorPlayerId: string;
    channelId?: string;
  }
) {
  return prisma.alliance.create({
    data: {
      ...data,
      members: {
        create: { playerId: data.creatorPlayerId },
      },
    },
    include: { members: true },
  });
}

export async function addAllianceMember(prisma: PrismaClient, allianceId: string, playerId: string) {
  return prisma.allianceMember.create({
    data: { allianceId, playerId },
  });
}

export async function getPlayerAlliance(prisma: PrismaClient, gameId: string, playerId: string) {
  const membership = await prisma.allianceMember.findFirst({
    where: {
      playerId,
      alliance: { gameId },
    },
    include: { alliance: { include: { members: true } } },
  });
  return membership?.alliance ?? null;
}

// ─── Tick Log Repository ────────────────────────────────────────────────────

export async function createTickLog(
  prisma: PrismaClient,
  data: { gameId: string; turnNumber: number; seed: string }
) {
  return prisma.tickLog.create({ data });
}

export async function completeTickLog(
  prisma: PrismaClient,
  tickLogId: string,
  summaryJson: Prisma.InputJsonValue
) {
  return prisma.tickLog.update({
    where: { id: tickLogId },
    data: { endedAt: new Date(), summaryJson },
  });
}

export async function getTickLog(prisma: PrismaClient, gameId: string, turnNumber: number) {
  return prisma.tickLog.findUnique({
    where: { gameId_turnNumber: { gameId, turnNumber } },
  });
}

// ─── Battle Log Repository ─────────────────────────────────────────────────

export async function createBattleLog(
  prisma: PrismaClient,
  data: {
    gameId: string;
    turnNumber: number;
    provinceId: string;
    attackerPlayerId?: string;
    defenderPlayerId?: string;
    attackerUnits: Prisma.InputJsonValue;
    defenderUnits: Prisma.InputJsonValue;
    resultJson: Prisma.InputJsonValue;
  }
) {
  return prisma.battleLog.create({ data });
}

// ─── Notification Log ───────────────────────────────────────────────────────

export async function createNotification(
  prisma: PrismaClient,
  data: {
    gameId: string;
    turnNumber: number;
    playerId?: string;
    message: string;
  }
) {
  return prisma.notificationLog.create({ data });
}
