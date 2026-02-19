/**
 * Centralized game rules and constants.
 * All tunable game values live here.
 */

// ─── Army Costs ─────────────────────────────────────────────────────────────

export const RECRUIT_REGULAR_GOLD = 2;
export const RECRUIT_REGULAR_FOOD = 2;
export const UPKEEP_REGULAR_GOLD = 1;
export const UPKEEP_REGULAR_FOOD = 1;

export const RECRUIT_MERC_GOLD = 6;
export const UPKEEP_MERC_GOLD = 2;

// ─── Building Costs (Gold) ──────────────────────────────────────────────────

export const BUILDING_COSTS: Record<number, number> = {
  1: 120,   // Build tier 1
  2: 220,   // Upgrade to tier 2
  3: 360,   // Upgrade to tier 3
  4: 520,   // Upgrade to tier 4
};

export const MAX_BUILDING_TIER = 4;
export const MAX_BUILDINGS_PER_PROVINCE = 3;

// ─── Building Bonuses ───────────────────────────────────────────────────────

/** Per-tier output bonus for Mint, Granary, Shrine */
export const OUTPUT_BONUS_PER_TIER: Record<number, number> = {
  1: 5,
  2: 10,
  3: 15,
  4: 20,
};

/** Per-tier global upkeep reduction % for Barracks */
export const BARRACKS_UPKEEP_REDUCTION: Record<number, number> = {
  1: 5,
  2: 8,
  3: 10,
  4: 12,
};
export const MAX_BARRACKS_REDUCTION = 30; // cap %

/** Per-tier defender dice bonus for Fortress */
export const FORTRESS_DICE_BONUS: Record<number, number> = {
  1: 1,
  2: 2,
  3: 3,
  4: 4,
};

// ─── Battle ─────────────────────────────────────────────────────────────────

export const BATTLE_BATCH_SIZE = 10;
export const DICE_MIN = 1;
export const DICE_MAX = 6;
export const DICE_RESULT_MIN = 1;
export const DICE_RESULT_MAX = 6;

// ─── Pope ───────────────────────────────────────────────────────────────────

export const POPE_ELECTION_INTERVAL = 3; // every N turns
export const POPE_TERM_LENGTH = 3; // turns

export const POPE_ABILITY_COSTS: Record<string, number> = {
  BLESSING: 120,
  EXCOMMUNICATION: 160,
  TITHE: 100,
  INTERDICT: 200,
};

export const POPE_ABILITIES_PER_TICK = 1;
export const TITHE_GOLD_GAIN = 150;
export const BLESSING_DICE_BONUS = 1;

// ─── Alliance / Donations ───────────────────────────────────────────────────

export const DONATION_CAP_PERCENT = 0.4; // max 40% of sender's current resource
export const SUPPORT_LOGISTICS_COST_PER_UNIT = 1; // Gold per unit

// Support cooldown: 2 + floor(distance / 4) turns
export function supportCooldownTurns(distance: number): number {
  return 2 + Math.floor(distance / 4);
}

// ─── Starting Resources ─────────────────────────────────────────────────────

export const STARTING_GOLD = 300;
export const STARTING_FOOD = 300;
export const STARTING_FAITH = 0;
export const STARTING_REGULAR_TROOPS = 80;
export const STARTING_MERCS = 0;

// ─── Province Resource Profile ──────────────────────────────────────────────

/** Roll random resource profile for a captured province. Sum <= 100, at least one > 0. */
export function rollProvinceOutputs(rng: { nextInt: (min: number, max: number) => number }): {
  goldOut: number;
  foodOut: number;
  faithOut: number;
} {
  // Random partition with constraints
  let goldOut = 0;
  let foodOut = 0;
  let faithOut = 0;

  // Generate 3 random values and normalize to sum <= 100
  const raw1 = rng.nextInt(0, 100);
  const raw2 = rng.nextInt(0, 100);
  const raw3 = rng.nextInt(0, 100);
  const total = raw1 + raw2 + raw3;

  if (total === 0) {
    // Ensure at least one > 0
    goldOut = rng.nextInt(1, 50);
  } else {
    goldOut = Math.floor((raw1 / total) * 100);
    foodOut = Math.floor((raw2 / total) * 100);
    faithOut = Math.floor((raw3 / total) * 100);

    // Adjust to ensure sum <= 100
    const currentSum = goldOut + foodOut + faithOut;
    if (currentSum > 100) {
      const excess = currentSum - 100;
      faithOut = Math.max(0, faithOut - excess);
    }

    // Ensure at least one > 0
    if (goldOut + foodOut + faithOut === 0) {
      goldOut = rng.nextInt(1, 30);
    }
  }

  return { goldOut, foodOut, faithOut };
}

// ─── Subregion Bonus Pool ───────────────────────────────────────────────────

export enum SubregionBonusType {
  GOLD_OUTPUT_10 = 'GOLD_OUTPUT_10',
  FOOD_OUTPUT_10 = 'FOOD_OUTPUT_10',
  FAITH_OUTPUT_10 = 'FAITH_OUTPUT_10',
  UPKEEP_REDUCTION_5 = 'UPKEEP_REDUCTION_5',
}

export const SUBREGION_BONUS_POOL = [
  SubregionBonusType.GOLD_OUTPUT_10,
  SubregionBonusType.FOOD_OUTPUT_10,
  SubregionBonusType.FAITH_OUTPUT_10,
  SubregionBonusType.UPKEEP_REDUCTION_5,
];

// ─── Region Ability Pool ────────────────────────────────────────────────────

export enum RegionAbilityType {
  FORCED_MARCH = 'FORCED_MARCH',
  LEVY = 'LEVY',
  TREASURY_WINDFALL = 'TREASURY_WINDFALL',
  CRUSADE = 'CRUSADE',
}

export const REGION_ABILITY_COOLDOWN = 3; // turns
export const LEVY_TROOP_COUNT = 50;
export const TREASURY_WINDFALL_GOLD = 400;
export const CRUSADE_DICE_BONUS = 2;
