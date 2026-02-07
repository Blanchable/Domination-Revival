import { PrismaClient, GameStatus, OrderType, BuildingType, Game, Player } from '@prisma/client';
import { createSeed, createRng, GameRng } from '../utils/rng';
import { loadMap, buildAdjacencyMap, minDistanceBetweenSets } from '../data/mapLoader';
import { resolveBattle, runBracketTournament, BattleSide } from './battle';
import {
  UPKEEP_REGULAR_GOLD,
  UPKEEP_REGULAR_FOOD,
  UPKEEP_MERC_GOLD,
  RECRUIT_REGULAR_GOLD,
  RECRUIT_REGULAR_FOOD,
  RECRUIT_MERC_GOLD,
  BUILDING_COSTS,
  MAX_BUILDING_TIER,
  MAX_BUILDINGS_PER_PROVINCE,
  OUTPUT_BONUS_PER_TIER,
  BARRACKS_UPKEEP_REDUCTION,
  MAX_BARRACKS_REDUCTION,
  FORTRESS_DICE_BONUS,
  BLESSING_DICE_BONUS,
  CRUSADE_DICE_BONUS,
  POPE_ELECTION_INTERVAL,
  POPE_TERM_LENGTH,
  POPE_ABILITY_COSTS,
  TITHE_GOLD_GAIN,
  DONATION_CAP_PERCENT,
  SUPPORT_LOGISTICS_COST_PER_UNIT,
  supportCooldownTurns,
  rollProvinceOutputs,
  STARTING_GOLD,
  STARTING_FOOD,
} from './rules';
import {
  MoveOrderPayloadType,
  BuildOrderPayloadType,
  UpgradeOrderPayloadType,
  RecruitOrderPayloadType,
  DonatePayloadType,
  SupportPayloadType,
  PopeActionPayloadType,
} from '../utils/validation';

export interface TickSummary {
  turnNumber: number;
  phases: string[];
  battles: number;
  captures: number;
  eliminations: string[];
  newPope: string | null;
  notifications: string[];
}

/**
 * Execute a full tick for a game. This is the core game loop.
 *
 * Resolution phases:
 * A: Validate all orders
 * B: Upkeep + disband if unpaid
 * C: Resource generation
 * D: Apply building/recruit orders (spending after generation)
 * E: Movement + battles + captures
 * F: Subregion/region bonuses
 * G: Pope selection + Pope actions
 * H: Eliminations + alliance cleanup + notifications
 */
export async function executeTick(prisma: PrismaClient, game: Game): Promise<TickSummary> {
  const seed = createSeed(game.id, game.turnNumber, new Date().toISOString());
  const rng = createRng(seed);

  const summary: TickSummary = {
    turnNumber: game.turnNumber,
    phases: [],
    battles: 0,
    captures: 0,
    eliminations: [],
    newPope: null,
    notifications: [],
  };

  // Create tick log
  const tickLog = await prisma.tickLog.create({
    data: { gameId: game.id, turnNumber: game.turnNumber, seed },
  });

  try {
    // Load map data
    const map = loadMap(game.mapId);
    const adjacencyMap = buildAdjacencyMap(map);

    // Fetch all current state
    const players = await prisma.player.findMany({
      where: { gameId: game.id, isAlive: true },
    });
    const allOrders = await prisma.order.findMany({
      where: { gameId: game.id, turnNumber: game.turnNumber },
      orderBy: { createdAt: 'asc' },
    });

    // Phase A: Validate orders (basic - filter out invalid ones)
    summary.phases.push('A: Order validation');
    const validOrders = await validateOrders(prisma, game, allOrders, adjacencyMap);

    // Phase B: Upkeep + disband
    summary.phases.push('B: Upkeep');
    await processUpkeep(prisma, game, players);

    // Phase C: Resource generation
    summary.phases.push('C: Resource generation');
    await processResourceGeneration(prisma, game, players);

    // Phase D: Building + Recruit orders
    summary.phases.push('D: Building & Recruitment');
    await processBuildingOrders(prisma, game, validOrders);
    await processRecruitOrders(prisma, game, validOrders);
    await processDonationOrders(prisma, game, validOrders);
    await processSupportOrders(prisma, game, validOrders, adjacencyMap);

    // Phase E: Movement + Battles + Captures
    summary.phases.push('E: Movement & Battles');
    const battleResults = await processMovement(prisma, game, validOrders, rng, adjacencyMap);
    summary.battles = battleResults.battleCount;
    summary.captures = battleResults.captures;

    // Phase F: Subregion/Region bonuses (computed each tick)
    summary.phases.push('F: Territory bonuses');
    // Bonuses are applied as part of resource generation, tracked implicitly

    // Phase G: Pope selection + Pope actions
    summary.phases.push('G: Pope');
    const popeResult = await processPopePhase(prisma, game, validOrders, rng);
    summary.newPope = popeResult.newPope;

    // Phase H: Eliminations + Cleanup
    summary.phases.push('H: Eliminations & cleanup');
    const eliminations = await processEliminations(prisma, game);
    summary.eliminations = eliminations;

    // Clear blessing/excommunication flags from previous tick
    await prisma.player.updateMany({
      where: { gameId: game.id },
      data: { blessingActive: false, excommunicated: false },
    });

    // Increment turn
    await prisma.game.update({
      where: { id: game.id },
      data: { turnNumber: game.turnNumber + 1 },
    });

    // Complete tick log
    await prisma.tickLog.update({
      where: { id: tickLog.id },
      data: {
        endedAt: new Date(),
        summaryJson: summary as any,
      },
    });

    return summary;
  } catch (error) {
    console.error(`Tick error for game ${game.id}:`, error);

    // Mark tick as failed
    await prisma.tickLog.update({
      where: { id: tickLog.id },
      data: {
        endedAt: new Date(),
        summaryJson: { error: String(error), ...summary } as any,
      },
    });

    throw error;
  }
}

// ─── Phase A: Validate Orders ───────────────────────────────────────────────

async function validateOrders(
  prisma: PrismaClient,
  game: Game,
  orders: any[],
  adjacencyMap: Map<string, Set<string>>
): Promise<any[]> {
  // Basic validation - filter out obviously invalid orders
  const valid: any[] = [];

  for (const order of orders) {
    try {
      const payload = order.payload as Record<string, any>;

      switch (order.type) {
        case OrderType.MOVE: {
          const from = payload.fromProvinceId;
          const to = payload.toProvinceId;
          // Check adjacency
          if (!adjacencyMap.get(from)?.has(to)) continue;
          valid.push(order);
          break;
        }
        default:
          valid.push(order);
      }
    } catch {
      // Skip invalid orders
    }
  }

  return valid;
}

// ─── Phase B: Upkeep ────────────────────────────────────────────────────────

async function processUpkeep(prisma: PrismaClient, game: Game, players: Player[]) {
  for (const player of players) {
    // Calculate total upkeep
    const armies = await prisma.armyStack.findMany({
      where: { gameId: game.id, ownerPlayerId: player.id },
    });

    let totalRegulars = armies.reduce((s, a) => s + a.regularCount, 0);
    let totalMercs = armies.reduce((s, a) => s + a.mercCount, 0);

    // Calculate barracks reduction
    const barracks = await prisma.building.findMany({
      where: { gameId: game.id, type: BuildingType.BARRACKS, province: { ownerPlayerId: player.id } },
    });
    let barracksReduction = 0;
    for (const b of barracks) {
      barracksReduction += BARRACKS_UPKEEP_REDUCTION[b.tier] ?? 0;
    }
    barracksReduction = Math.min(barracksReduction, MAX_BARRACKS_REDUCTION);
    const upkeepMultiplier = 1 - barracksReduction / 100;

    let goldNeeded = Math.ceil(totalRegulars * UPKEEP_REGULAR_GOLD * upkeepMultiplier) +
      totalMercs * UPKEEP_MERC_GOLD;
    let foodNeeded = Math.ceil(totalRegulars * UPKEEP_REGULAR_FOOD * upkeepMultiplier);

    let currentGold = player.gold;
    let currentFood = player.food;

    // Disband mercs first if can't pay
    while ((currentGold < goldNeeded || currentFood < foodNeeded) && totalMercs > 0) {
      totalMercs--;
      goldNeeded = Math.ceil(totalRegulars * UPKEEP_REGULAR_GOLD * upkeepMultiplier) +
        totalMercs * UPKEEP_MERC_GOLD;
      foodNeeded = Math.ceil(totalRegulars * UPKEEP_REGULAR_FOOD * upkeepMultiplier);
    }

    // Then disband regulars if still can't pay
    while ((currentGold < goldNeeded || currentFood < foodNeeded) && totalRegulars > 0) {
      totalRegulars--;
      goldNeeded = Math.ceil(totalRegulars * UPKEEP_REGULAR_GOLD * upkeepMultiplier) +
        totalMercs * UPKEEP_MERC_GOLD;
      foodNeeded = Math.ceil(totalRegulars * UPKEEP_REGULAR_FOOD * upkeepMultiplier);
    }

    // Apply disbands proportionally across provinces
    const origTotal = armies.reduce((s, a) => s + a.regularCount + a.mercCount, 0);
    const newTotal = totalRegulars + totalMercs;

    if (newTotal < origTotal) {
      // Need to disband units from army stacks
      let regsToRemove = armies.reduce((s, a) => s + a.regularCount, 0) - totalRegulars;
      let mercsToRemove = armies.reduce((s, a) => s + a.mercCount, 0) - totalMercs;

      for (const army of armies) {
        const regRemove = Math.min(army.regularCount, regsToRemove);
        const mercRemove = Math.min(army.mercCount, mercsToRemove);

        if (regRemove > 0 || mercRemove > 0) {
          await prisma.armyStack.update({
            where: { id: army.id },
            data: {
              regularCount: army.regularCount - regRemove,
              mercCount: army.mercCount - mercRemove,
            },
          });
          regsToRemove -= regRemove;
          mercsToRemove -= mercRemove;
        }
      }
    }

    // Deduct upkeep
    await prisma.player.update({
      where: { id: player.id },
      data: {
        gold: Math.max(0, currentGold - goldNeeded),
        food: Math.max(0, currentFood - foodNeeded),
      },
    });
  }
}

// ─── Phase C: Resource Generation ───────────────────────────────────────────

async function processResourceGeneration(prisma: PrismaClient, game: Game, players: Player[]) {
  for (const player of players) {
    const ownerships = await prisma.provinceOwnership.findMany({
      where: { gameId: game.id, ownerPlayerId: player.id },
      include: { province: { include: { buildings: true } } },
    });

    let goldIncome = 0;
    let foodIncome = 0;
    let faithIncome = 0;

    for (const ownership of ownerships) {
      let goldBonus = 0;
      let foodBonus = 0;
      let faithBonus = 0;

      // Building bonuses
      for (const building of ownership.province.buildings) {
        switch (building.type) {
          case BuildingType.MINT:
            goldBonus += OUTPUT_BONUS_PER_TIER[building.tier] ?? 0;
            break;
          case BuildingType.GRANARY:
            foodBonus += OUTPUT_BONUS_PER_TIER[building.tier] ?? 0;
            break;
          case BuildingType.SHRINE:
            faithBonus += OUTPUT_BONUS_PER_TIER[building.tier] ?? 0;
            break;
        }
      }

      goldIncome += ownership.goldOut + goldBonus;
      foodIncome += ownership.foodOut + foodBonus;
      faithIncome += ownership.faithOut + faithBonus;
    }

    // Apply subregion bonuses (10% output boosts computed below)
    // This would require checking full subregion ownership - simplified for now
    // TODO: implement subregion bonus tracking

    await prisma.player.update({
      where: { id: player.id },
      data: {
        gold: { increment: goldIncome },
        food: { increment: foodIncome },
        faith: { increment: faithIncome },
      },
    });
  }
}

// ─── Phase D: Building Orders ───────────────────────────────────────────────

async function processBuildingOrders(prisma: PrismaClient, game: Game, orders: any[]) {
  const buildOrders = orders.filter((o) => o.type === OrderType.BUILD);
  const upgradeOrders = orders.filter((o) => o.type === OrderType.UPGRADE);

  for (const order of buildOrders) {
    const payload = order.payload as BuildOrderPayloadType;
    const player = await prisma.player.findUnique({ where: { id: order.playerId } });
    if (!player) continue;

    const cost = BUILDING_COSTS[1];
    if (player.gold < cost) continue;

    // Check province ownership
    const province = await prisma.province.findUnique({
      where: { id_gameId: { id: payload.provinceId, gameId: game.id } },
      include: { buildings: true },
    });
    if (!province || province.ownerPlayerId !== player.id) continue;
    if (province.buildings.length >= MAX_BUILDINGS_PER_PROVINCE) continue;
    if (province.buildings.some((b) => b.type === payload.buildingType as BuildingType)) continue;

    // Check interdict
    // (interdict blocking is handled in Pope phase, but we check if it was set last turn)

    await prisma.building.create({
      data: {
        gameId: game.id,
        provinceId: payload.provinceId,
        type: payload.buildingType as BuildingType,
        tier: 1,
      },
    });

    await prisma.player.update({
      where: { id: player.id },
      data: { gold: { decrement: cost } },
    });
  }

  for (const order of upgradeOrders) {
    const payload = order.payload as UpgradeOrderPayloadType;
    const player = await prisma.player.findUnique({ where: { id: order.playerId } });
    if (!player) continue;

    const building = await prisma.building.findFirst({
      where: {
        gameId: game.id,
        provinceId: payload.provinceId,
        type: payload.buildingType as BuildingType,
      },
    });
    if (!building || building.tier >= MAX_BUILDING_TIER) continue;

    const nextTier = building.tier + 1;
    const cost = BUILDING_COSTS[nextTier];
    if (player.gold < cost) continue;

    await prisma.building.update({
      where: { id: building.id },
      data: { tier: nextTier },
    });

    await prisma.player.update({
      where: { id: player.id },
      data: { gold: { decrement: cost } },
    });
  }
}

// ─── Phase D: Recruit Orders ────────────────────────────────────────────────

async function processRecruitOrders(prisma: PrismaClient, game: Game, orders: any[]) {
  const recruitOrders = orders.filter((o) => o.type === OrderType.RECRUIT);

  for (const order of recruitOrders) {
    const payload = order.payload as RecruitOrderPayloadType;
    const player = await prisma.player.findUnique({ where: { id: order.playerId } });
    if (!player) continue;

    const goldCost =
      payload.regularCount * RECRUIT_REGULAR_GOLD + payload.mercCount * RECRUIT_MERC_GOLD;
    const foodCost = payload.regularCount * RECRUIT_REGULAR_FOOD;

    if (player.gold < goldCost || player.food < foodCost) continue;

    // Check province
    const province = await prisma.province.findUnique({
      where: { id_gameId: { id: payload.provinceId, gameId: game.id } },
    });
    if (!province || province.ownerPlayerId !== player.id) continue;

    // Deduct resources
    await prisma.player.update({
      where: { id: player.id },
      data: {
        gold: { decrement: goldCost },
        food: { decrement: foodCost },
      },
    });

    // Add units
    await prisma.armyStack.upsert({
      where: { provinceId_gameId: { provinceId: payload.provinceId, gameId: game.id } },
      create: {
        gameId: game.id,
        provinceId: payload.provinceId,
        ownerPlayerId: player.id,
        regularCount: payload.regularCount,
        mercCount: payload.mercCount,
      },
      update: {
        regularCount: { increment: payload.regularCount },
        mercCount: { increment: payload.mercCount },
      },
    });
  }
}

// ─── Phase D: Donation Orders ───────────────────────────────────────────────

async function processDonationOrders(prisma: PrismaClient, game: Game, orders: any[]) {
  const donationOrders = orders.filter((o) => o.type === OrderType.DONATE);

  for (const order of donationOrders) {
    const payload = order.payload as DonatePayloadType;
    const sender = await prisma.player.findUnique({ where: { id: order.playerId } });
    if (!sender || sender.excommunicated) continue;

    const recipient = await prisma.player.findUnique({ where: { id: payload.recipientPlayerId } });
    if (!recipient || !recipient.isAlive || recipient.excommunicated) continue;

    // Check caps
    const goldCap = Math.floor(sender.gold * DONATION_CAP_PERCENT);
    const foodCap = Math.floor(sender.food * DONATION_CAP_PERCENT);

    const gold = Math.min(payload.gold, goldCap, sender.gold);
    const food = Math.min(payload.food, foodCap, sender.food);

    if (gold <= 0 && food <= 0) continue;

    await prisma.player.update({
      where: { id: sender.id },
      data: { gold: { decrement: gold }, food: { decrement: food } },
    });

    await prisma.player.update({
      where: { id: recipient.id },
      data: { gold: { increment: gold }, food: { increment: food } },
    });
  }
}

// ─── Phase D: Support Orders ────────────────────────────────────────────────

async function processSupportOrders(
  prisma: PrismaClient,
  game: Game,
  orders: any[],
  adjacencyMap: Map<string, Set<string>>
) {
  const supportOrders = orders.filter((o) => o.type === OrderType.SUPPORT);

  for (const order of supportOrders) {
    const payload = order.payload as SupportPayloadType;
    const sender = await prisma.player.findUnique({ where: { id: order.playerId } });
    if (!sender || !sender.isAlive) continue;

    const recipient = await prisma.player.findUnique({ where: { id: payload.recipientPlayerId } });
    if (!recipient || !recipient.isAlive) continue;

    // Check cooldown
    const cooldown = await prisma.supportCooldown.findUnique({
      where: {
        gameId_senderPlayerId_receiverPlayerId: {
          gameId: game.id,
          senderPlayerId: sender.id,
          receiverPlayerId: recipient.id,
        },
      },
    });

    if (cooldown && cooldown.cooldownUntilTurn > game.turnNumber) continue;

    // Compute distance
    const senderProvinces = await prisma.provinceOwnership.findMany({
      where: { gameId: game.id, ownerPlayerId: sender.id },
    });
    const recipientProvinces = await prisma.provinceOwnership.findMany({
      where: { gameId: game.id, ownerPlayerId: recipient.id },
    });

    const distance = minDistanceBetweenSets(
      adjacencyMap,
      senderProvinces.map((p) => p.provinceId),
      recipientProvinces.map((p) => p.provinceId)
    );

    if (distance < 0) continue; // unreachable

    // Logistics cost
    const totalUnits = payload.troops + payload.mercs;
    const logisticsCost = totalUnits * SUPPORT_LOGISTICS_COST_PER_UNIT;
    if (sender.gold < logisticsCost) continue;

    // Check sender has enough units
    const senderArmies = await prisma.armyStack.findMany({
      where: { gameId: game.id, ownerPlayerId: sender.id },
    });
    const totalSenderReg = senderArmies.reduce((s, a) => s + a.regularCount, 0);
    const totalSenderMerc = senderArmies.reduce((s, a) => s + a.mercCount, 0);

    if (payload.troops > totalSenderReg || payload.mercs > totalSenderMerc) continue;

    // Deduct from sender (from first available stacks)
    let regsToSend = payload.troops;
    let mercsToSend = payload.mercs;

    for (const army of senderArmies) {
      const regTake = Math.min(regsToSend, army.regularCount);
      const mercTake = Math.min(mercsToSend, army.mercCount);

      if (regTake > 0 || mercTake > 0) {
        await prisma.armyStack.update({
          where: { id: army.id },
          data: {
            regularCount: { decrement: regTake },
            mercCount: { decrement: mercTake },
          },
        });
        regsToSend -= regTake;
        mercsToSend -= mercTake;
      }
      if (regsToSend === 0 && mercsToSend === 0) break;
    }

    // Add to recipient's target province
    let targetProvinceId = payload.toProvinceId;
    if (!targetProvinceId) {
      // Default: first owned province
      targetProvinceId = recipientProvinces[0]?.provinceId;
    }
    if (!targetProvinceId) continue;

    await prisma.armyStack.upsert({
      where: { provinceId_gameId: { provinceId: targetProvinceId, gameId: game.id } },
      create: {
        gameId: game.id,
        provinceId: targetProvinceId,
        ownerPlayerId: recipient.id,
        regularCount: payload.troops,
        mercCount: payload.mercs,
      },
      update: {
        regularCount: { increment: payload.troops },
        mercCount: { increment: payload.mercs },
      },
    });

    // Deduct logistics cost
    await prisma.player.update({
      where: { id: sender.id },
      data: { gold: { decrement: logisticsCost } },
    });

    // Set cooldown
    const cdTurns = supportCooldownTurns(distance);
    await prisma.supportCooldown.upsert({
      where: {
        gameId_senderPlayerId_receiverPlayerId: {
          gameId: game.id,
          senderPlayerId: sender.id,
          receiverPlayerId: recipient.id,
        },
      },
      create: {
        gameId: game.id,
        senderPlayerId: sender.id,
        receiverPlayerId: recipient.id,
        lastSentTurn: game.turnNumber,
        cooldownUntilTurn: game.turnNumber + cdTurns,
      },
      update: {
        lastSentTurn: game.turnNumber,
        cooldownUntilTurn: game.turnNumber + cdTurns,
      },
    });
  }
}

// ─── Phase E: Movement + Battles ────────────────────────────────────────────

interface MovementResult {
  battleCount: number;
  captures: number;
}

async function processMovement(
  prisma: PrismaClient,
  game: Game,
  orders: any[],
  rng: GameRng,
  adjacencyMap: Map<string, Set<string>>
): Promise<MovementResult> {
  const moveOrders = orders.filter((o) => o.type === OrderType.MOVE);
  let battleCount = 0;
  let captures = 0;

  // Group moves by target province
  const targetMap = new Map<string, any[]>();
  for (const order of moveOrders) {
    const payload = order.payload as MoveOrderPayloadType;
    const target = payload.toProvinceId;
    if (!targetMap.has(target)) targetMap.set(target, []);
    targetMap.get(target)!.push(order);
  }

  // First: deduct committed units from origin provinces
  for (const order of moveOrders) {
    const payload = order.payload as MoveOrderPayloadType;

    const army = await prisma.armyStack.findUnique({
      where: { provinceId_gameId: { provinceId: payload.fromProvinceId, gameId: game.id } },
    });

    if (!army || army.ownerPlayerId !== order.playerId) continue;

    // Auto-scale down if not enough troops
    const actualTroops = Math.min(payload.troopsCommitted, army.regularCount);
    const actualMercs = Math.min(payload.mercsCommitted, army.mercCount);

    // Update order payload with actual values
    order._actualTroops = actualTroops;
    order._actualMercs = actualMercs;

    // Deduct from origin
    await prisma.armyStack.update({
      where: { id: army.id },
      data: {
        regularCount: { decrement: actualTroops },
        mercCount: { decrement: actualMercs },
      },
    });
  }

  // Process each target province
  for (const [targetProvinceId, movesInto] of targetMap) {
    const targetProvince = await prisma.province.findUnique({
      where: { id_gameId: { id: targetProvinceId, gameId: game.id } },
      include: { armyStack: true, buildings: true },
    });
    if (!targetProvince) continue;

    // Build list of combatants
    const combatants: BattleSide[] = [];

    // Movers
    for (const order of movesInto) {
      const actualTroops = order._actualTroops ?? 0;
      const actualMercs = order._actualMercs ?? 0;
      if (actualTroops === 0 && actualMercs === 0) continue;

      // Get player's dice modifier
      const player = await prisma.player.findUnique({ where: { id: order.playerId } });
      let modifier = 0;
      if (player?.blessingActive) modifier += BLESSING_DICE_BONUS;
      // TODO: check crusade region ability

      combatants.push({
        playerId: order.playerId,
        regulars: actualTroops,
        mercs: actualMercs,
        diceModifier: modifier,
      });
    }

    // Defender (if province is owned and has troops)
    const hasHostileMover = combatants.some(
      (c) => c.playerId !== targetProvince.ownerPlayerId
    );

    if (
      targetProvince.ownerPlayerId &&
      targetProvince.armyStack &&
      hasHostileMover &&
      (targetProvince.armyStack.regularCount > 0 || targetProvince.armyStack.mercCount > 0)
    ) {
      const defenderPlayer = await prisma.player.findUnique({
        where: { id: targetProvince.ownerPlayerId },
      });

      let defMod = 0;
      if (defenderPlayer?.blessingActive) defMod += BLESSING_DICE_BONUS;

      // Fortress bonus
      const fortress = targetProvince.buildings.find((b) => b.type === BuildingType.FORTRESS);
      if (fortress) {
        defMod += FORTRESS_DICE_BONUS[fortress.tier] ?? 0;
      }

      combatants.push({
        playerId: targetProvince.ownerPlayerId,
        regulars: targetProvince.armyStack.regularCount,
        mercs: targetProvince.armyStack.mercCount,
        diceModifier: defMod,
      });
    }

    if (combatants.length === 0) continue;

    // If only one mover and no defender, peaceful capture/move
    if (combatants.length === 1) {
      const mover = combatants[0];

      if (targetProvince.ownerPlayerId === mover.playerId) {
        // Moving into own province: add units
        await prisma.armyStack.upsert({
          where: { provinceId_gameId: { provinceId: targetProvinceId, gameId: game.id } },
          create: {
            gameId: game.id,
            provinceId: targetProvinceId,
            ownerPlayerId: mover.playerId,
            regularCount: mover.regulars,
            mercCount: mover.mercs,
          },
          update: {
            regularCount: { increment: mover.regulars },
            mercCount: { increment: mover.mercs },
          },
        });
      } else {
        // Capture unclaimed/undefended province
        await captureProvince(prisma, game, targetProvinceId, mover, rng);
        captures++;
      }
      continue;
    }

    // Battle!
    if (combatants.length === 2) {
      const result = resolveBattle(rng, combatants[0], combatants[1]);
      battleCount++;

      // Log battle
      await prisma.battleLog.create({
        data: {
          gameId: game.id,
          turnNumber: game.turnNumber,
          provinceId: targetProvinceId,
          attackerPlayerId: combatants[0].playerId,
          defenderPlayerId: combatants[1].playerId,
          attackerUnits: { regulars: combatants[0].regulars, mercs: combatants[0].mercs },
          defenderUnits: { regulars: combatants[1].regulars, mercs: combatants[1].mercs },
          resultJson: result as any,
        },
      });

      if (result.winner) {
        const winnerSide = result.winner === combatants[0].playerId
          ? result.sideA
          : result.sideB;

        const winnerBattle: BattleSide = {
          playerId: result.winner,
          regulars: winnerSide.survivingRegulars,
          mercs: winnerSide.survivingMercs,
          diceModifier: 0,
        };

        if (result.winner !== targetProvince.ownerPlayerId) {
          await captureProvince(prisma, game, targetProvinceId, winnerBattle, rng);
          captures++;
        } else {
          // Defender won: update their army stack
          await prisma.armyStack.upsert({
            where: { provinceId_gameId: { provinceId: targetProvinceId, gameId: game.id } },
            create: {
              gameId: game.id,
              provinceId: targetProvinceId,
              ownerPlayerId: result.winner,
              regularCount: winnerSide.survivingRegulars,
              mercCount: winnerSide.survivingMercs,
            },
            update: {
              regularCount: winnerSide.survivingRegulars,
              mercCount: winnerSide.survivingMercs,
            },
          });
        }
      }
    } else {
      // 3+ way: tournament bracket
      const tournament = runBracketTournament(rng, combatants);
      battleCount += tournament.results.length;

      // Log all battles
      for (const result of tournament.results) {
        await prisma.battleLog.create({
          data: {
            gameId: game.id,
            turnNumber: game.turnNumber,
            provinceId: targetProvinceId,
            attackerPlayerId: result.sideA.playerId,
            defenderPlayerId: result.sideB.playerId,
            attackerUnits: { regulars: result.sideA.survivingRegulars, mercs: result.sideA.survivingMercs },
            defenderUnits: { regulars: result.sideB.survivingRegulars, mercs: result.sideB.survivingMercs },
            resultJson: result as any,
          },
        });
      }

      if (tournament.winner.playerId !== targetProvince.ownerPlayerId) {
        await captureProvince(prisma, game, targetProvinceId, tournament.winner, rng);
        captures++;
      } else {
        await prisma.armyStack.upsert({
          where: { provinceId_gameId: { provinceId: targetProvinceId, gameId: game.id } },
          create: {
            gameId: game.id,
            provinceId: targetProvinceId,
            ownerPlayerId: tournament.winner.playerId,
            regularCount: tournament.winner.regulars,
            mercCount: tournament.winner.mercs,
          },
          update: {
            regularCount: tournament.winner.regulars,
            mercCount: tournament.winner.mercs,
          },
        });
      }
    }
  }

  return { battleCount, captures };
}

/**
 * Handle province capture: change ownership, reroll outputs, destroy buildings, set garrison.
 */
async function captureProvince(
  prisma: PrismaClient,
  game: Game,
  provinceId: string,
  winner: { playerId: string; regulars: number; mercs: number },
  rng: GameRng
) {
  // Roll new resource outputs
  const outputs = rollProvinceOutputs(rng);

  // Delete old ownership
  await prisma.provinceOwnership.deleteMany({
    where: { gameId: game.id, provinceId },
  });

  // Delete buildings (destroyed on capture)
  await prisma.building.deleteMany({
    where: { gameId: game.id, provinceId },
  });

  // Delete old army stack
  await prisma.armyStack.deleteMany({
    where: { gameId: game.id, provinceId },
  });

  // Set new owner
  await prisma.province.update({
    where: { id_gameId: { id: provinceId, gameId: game.id } },
    data: { ownerPlayerId: winner.playerId },
  });

  // Create new ownership with rolled outputs
  await prisma.provinceOwnership.create({
    data: {
      gameId: game.id,
      provinceId,
      ownerPlayerId: winner.playerId,
      goldOut: outputs.goldOut,
      foodOut: outputs.foodOut,
      faithOut: outputs.faithOut,
    },
  });

  // Place winning army
  await prisma.armyStack.create({
    data: {
      gameId: game.id,
      provinceId,
      ownerPlayerId: winner.playerId,
      regularCount: winner.regulars,
      mercCount: winner.mercs,
    },
  });
}

// ─── Phase G: Pope ──────────────────────────────────────────────────────────

async function processPopePhase(
  prisma: PrismaClient,
  game: Game,
  orders: any[],
  rng: GameRng
): Promise<{ newPope: string | null }> {
  let newPope: string | null = null;

  // Pope election every 3 turns
  if (game.turnNumber > 0 && game.turnNumber % POPE_ELECTION_INTERVAL === 0) {
    const alivePlayers = await prisma.player.findMany({
      where: { gameId: game.id, isAlive: true },
    });

    if (alivePlayers.length > 0) {
      // Weight by faith output total
      const weights: number[] = [];
      for (const player of alivePlayers) {
        const faithTotal = await prisma.provinceOwnership.aggregate({
          where: { gameId: game.id, ownerPlayerId: player.id },
          _sum: { faithOut: true },
        });
        // Minimum weight of 1
        weights.push(Math.max(1, faithTotal._sum.faithOut ?? 0));
      }

      const chosenIdx = rng.weightedIndex(weights);
      const chosenPlayer = alivePlayers[chosenIdx];

      await prisma.game.update({
        where: { id: game.id },
        data: {
          popePlayerId: chosenPlayer.id,
          popeUntilTurn: game.turnNumber + POPE_TERM_LENGTH,
        },
      });

      newPope = chosenPlayer.displayName;
    }
  }

  // Process Pope actions
  const popeOrders = orders.filter((o) => o.type === OrderType.POPE_ACTION);

  for (const order of popeOrders) {
    if (order.playerId !== game.popePlayerId) continue;

    const payload = order.payload as PopeActionPayloadType;
    const pope = await prisma.player.findUnique({ where: { id: order.playerId } });
    if (!pope) continue;

    const cost = POPE_ABILITY_COSTS[payload.ability];
    if (pope.faith < cost) continue;

    // Deduct faith
    await prisma.player.update({
      where: { id: pope.id },
      data: { faith: { decrement: cost } },
    });

    switch (payload.ability) {
      case 'BLESSING': {
        if (payload.targetPlayerId) {
          await prisma.player.update({
            where: { id: payload.targetPlayerId },
            data: { blessingActive: true },
          });
        }
        break;
      }
      case 'EXCOMMUNICATION': {
        if (payload.targetPlayerId && payload.targetPlayerId !== pope.id) {
          await prisma.player.update({
            where: { id: payload.targetPlayerId },
            data: { excommunicated: true },
          });
        }
        break;
      }
      case 'TITHE': {
        await prisma.player.update({
          where: { id: pope.id },
          data: { gold: { increment: TITHE_GOLD_GAIN } },
        });
        break;
      }
      case 'INTERDICT': {
        // Province can't be upgraded next tick - mark via a notification
        // For MVP, the interdict effect is handled by checking notifications next tick
        if (payload.targetProvinceId) {
          await prisma.notificationLog.create({
            data: {
              gameId: game.id,
              turnNumber: game.turnNumber,
              message: `INTERDICT:${payload.targetProvinceId}`,
            },
          });
        }
        break;
      }
    }
  }

  return { newPope };
}

// ─── Phase H: Eliminations ──────────────────────────────────────────────────

async function processEliminations(prisma: PrismaClient, game: Game): Promise<string[]> {
  const eliminated: string[] = [];

  const alivePlayers = await prisma.player.findMany({
    where: { gameId: game.id, isAlive: true },
  });

  for (const player of alivePlayers) {
    const provinceCount = await prisma.provinceOwnership.count({
      where: { gameId: game.id, ownerPlayerId: player.id },
    });

    if (provinceCount === 0) {
      // Eliminate player
      await prisma.player.update({
        where: { id: player.id },
        data: { isAlive: false, gold: 0, food: 0, faith: 0 },
      });

      // Disband all armies
      await prisma.armyStack.deleteMany({
        where: { gameId: game.id, ownerPlayerId: player.id },
      });

      // Remove from alliances
      await prisma.allianceMember.deleteMany({
        where: { playerId: player.id },
      });

      eliminated.push(player.displayName);
    }
  }

  return eliminated;
}
