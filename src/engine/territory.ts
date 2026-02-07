import { PrismaClient, Game } from '@prisma/client';
import { loadMap, GameMap, MapSubRegion, MapRegion } from '../data/mapLoader';
import { GameRng } from '../utils/rng';
import {
  SubregionBonusType,
  SUBREGION_BONUS_POOL,
  RegionAbilityType,
} from './rules';

export interface ActiveSubregionBonus {
  subRegionId: string;
  playerId: string;
  bonusType: SubregionBonusType;
}

export interface ActiveRegionAbility {
  regionId: string;
  playerId: string;
  abilityType: RegionAbilityType;
}

/**
 * Check which subregions are fully owned by a single player.
 * Returns bonus assignments for each completed subregion.
 */
export async function computeSubregionBonuses(
  prisma: PrismaClient,
  game: Game,
  rng: GameRng
): Promise<ActiveSubregionBonus[]> {
  const map = loadMap(game.mapId);
  const bonuses: ActiveSubregionBonus[] = [];

  for (const sr of map.subRegions) {
    const owner = await getSubregionSingleOwner(prisma, game.id, sr);
    if (!owner) continue;

    // Deterministic bonus selection based on subregion
    const bonusIdx = rng.nextInt(0, SUBREGION_BONUS_POOL.length - 1);
    bonuses.push({
      subRegionId: sr.id,
      playerId: owner,
      bonusType: SUBREGION_BONUS_POOL[bonusIdx],
    });
  }

  return bonuses;
}

/**
 * Check which regions are fully owned by a single player.
 * Returns ability assignments.
 */
export async function computeRegionAbilities(
  prisma: PrismaClient,
  game: Game
): Promise<ActiveRegionAbility[]> {
  const map = loadMap(game.mapId);
  const abilities: ActiveRegionAbility[] = [];

  // Map region to a deterministic ability
  const regionAbilityPool: RegionAbilityType[] = [
    RegionAbilityType.FORCED_MARCH,
    RegionAbilityType.LEVY,
    RegionAbilityType.TREASURY_WINDFALL,
    RegionAbilityType.CRUSADE,
  ];

  for (let i = 0; i < map.regions.length; i++) {
    const region = map.regions[i];
    const owner = await getRegionSingleOwner(prisma, game.id, region, map);
    if (!owner) continue;

    abilities.push({
      regionId: region.id,
      playerId: owner,
      abilityType: regionAbilityPool[i % regionAbilityPool.length],
    });
  }

  return abilities;
}

/**
 * Check if all provinces in a subregion belong to the same player.
 * Returns the player ID or null.
 */
async function getSubregionSingleOwner(
  prisma: PrismaClient,
  gameId: string,
  subRegion: MapSubRegion
): Promise<string | null> {
  if (subRegion.provinceIds.length === 0) return null;

  const provinces = await prisma.province.findMany({
    where: {
      gameId,
      id: { in: subRegion.provinceIds },
    },
    select: { ownerPlayerId: true },
  });

  if (provinces.length !== subRegion.provinceIds.length) return null;

  const owners = new Set(provinces.map((p) => p.ownerPlayerId).filter(Boolean));
  if (owners.size !== 1) return null;

  return owners.values().next().value ?? null;
}

/**
 * Check if all provinces in a region belong to the same player.
 */
async function getRegionSingleOwner(
  prisma: PrismaClient,
  gameId: string,
  region: MapRegion,
  map: GameMap
): Promise<string | null> {
  // Get all province IDs in the region
  const provinceIds: string[] = [];
  for (const srId of region.subRegionIds) {
    const sr = map.subRegions.find((s) => s.id === srId);
    if (sr) provinceIds.push(...sr.provinceIds);
  }

  if (provinceIds.length === 0) return null;

  const provinces = await prisma.province.findMany({
    where: {
      gameId,
      id: { in: provinceIds },
    },
    select: { ownerPlayerId: true },
  });

  if (provinces.length !== provinceIds.length) return null;

  const owners = new Set(provinces.map((p) => p.ownerPlayerId).filter(Boolean));
  if (owners.size !== 1) return null;

  return owners.values().next().value ?? null;
}

/**
 * Apply subregion bonus modifiers to resource totals.
 */
export function applySubregionBonuses(
  bonuses: ActiveSubregionBonus[],
  playerId: string,
  baseGold: number,
  baseFood: number,
  baseFaith: number,
  baseUpkeepReduction: number
): { goldMult: number; foodMult: number; faithMult: number; upkeepReduction: number } {
  let goldMult = 1.0;
  let foodMult = 1.0;
  let faithMult = 1.0;
  let upkeepReduction = baseUpkeepReduction;

  for (const bonus of bonuses) {
    if (bonus.playerId !== playerId) continue;

    switch (bonus.bonusType) {
      case SubregionBonusType.GOLD_OUTPUT_10:
        goldMult += 0.10;
        break;
      case SubregionBonusType.FOOD_OUTPUT_10:
        foodMult += 0.10;
        break;
      case SubregionBonusType.FAITH_OUTPUT_10:
        faithMult += 0.10;
        break;
      case SubregionBonusType.UPKEEP_REDUCTION_5:
        upkeepReduction += 5;
        break;
    }
  }

  return { goldMult, foodMult, faithMult, upkeepReduction };
}
