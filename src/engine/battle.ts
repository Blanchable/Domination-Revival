import { GameRng } from '../utils/rng';
import {
  BATTLE_BATCH_SIZE,
  DICE_MIN,
  DICE_MAX,
  DICE_RESULT_MIN,
  DICE_RESULT_MAX,
} from './rules';

export interface BattleSide {
  playerId: string;
  regulars: number;
  mercs: number;
  diceModifier: number; // from blessing, fortress, crusade etc.
}

export interface BattleRound {
  batchSize: number;
  sideALosses: number;
  sideBLosses: number;
}

export interface BattleResult {
  winner: string | null; // playerId or null if tie
  sideA: { playerId: string; survivingRegulars: number; survivingMercs: number };
  sideB: { playerId: string; survivingRegulars: number; survivingMercs: number };
  rounds: BattleRound[];
  totalRounds: number;
}

/**
 * Resolve a battle between two sides using the D6 batch system.
 *
 * Units fight in batches of up to 10 vs 10.
 * Each pair rolls 1d6 + modifier, higher kills the other. Ties re-roll.
 * Dead units are replaced from reserves until one side is depleted.
 */
export function resolveBattle(
  rng: GameRng,
  sideA: BattleSide,
  sideB: BattleSide
): BattleResult {
  // Total units per side (regulars fight before mercs)
  let aRegulars = sideA.regulars;
  let aMercs = sideA.mercs;
  let bRegulars = sideB.regulars;
  let bMercs = sideB.mercs;

  let aTotal = aRegulars + aMercs;
  let bTotal = bRegulars + bMercs;

  const rounds: BattleRound[] = [];

  while (aTotal > 0 && bTotal > 0) {
    const batchA = Math.min(BATTLE_BATCH_SIZE, aTotal);
    const batchB = Math.min(BATTLE_BATCH_SIZE, bTotal);
    const pairCount = Math.min(batchA, batchB);

    let aLosses = 0;
    let bLosses = 0;

    for (let i = 0; i < pairCount; i++) {
      // Each pair fights: roll d6 + modifier for each side
      const winner = resolveDuel(rng, sideA.diceModifier, sideB.diceModifier);
      if (winner === 'A') {
        bLosses++;
      } else {
        aLosses++;
      }
    }

    // If one side has more units in batch, the extras deal free kills
    if (batchA > pairCount) {
      // sideA has unmatched units; they deal damage to sideB
      // But sideB already committed all its batch... no extra damage
      // This follows the spec: pair 1-to-1, extras just survive
    }
    if (batchB > pairCount) {
      // Same
    }

    // Apply losses: regulars die first, then mercs
    aRegulars = Math.max(0, aRegulars - aLosses);
    if (aLosses > sideA.regulars - (sideA.regulars - aRegulars)) {
      // Simplify: just track total losses against regulars first
    }
    bRegulars = Math.max(0, bRegulars - bLosses);

    // Recalculate totals
    const newATotal = aRegulars + aMercs;
    const newBTotal = bRegulars + bMercs;

    // If we lost more than regulars available, mercs take the rest
    if (aLosses > 0) {
      const actualRegLoss = Math.min(aLosses, aRegulars + aLosses); // regulars before
      // We already reduced aRegulars; check if we need to reduce mercs
      const remainingLoss = aLosses - (sideA.regulars - aRegulars > aLosses ? aLosses : 0);
      // Simpler approach: track combined pool
    }

    // Better approach: use combined counts and track losses from the pool
    aTotal -= aLosses;
    bTotal -= bLosses;

    rounds.push({ batchSize: pairCount, sideALosses: aLosses, sideBLosses: bLosses });
  }

  // Determine surviving unit composition
  // Losses come from regulars first, then mercs
  const aTotalLost = (sideA.regulars + sideA.mercs) - aTotal;
  const aRegLost = Math.min(aTotalLost, sideA.regulars);
  const aMercLost = aTotalLost - aRegLost;

  const bTotalLost = (sideB.regulars + sideB.mercs) - bTotal;
  const bRegLost = Math.min(bTotalLost, sideB.regulars);
  const bMercLost = bTotalLost - bRegLost;

  const winner =
    aTotal > 0 && bTotal === 0
      ? sideA.playerId
      : bTotal > 0 && aTotal === 0
        ? sideB.playerId
        : null;

  return {
    winner,
    sideA: {
      playerId: sideA.playerId,
      survivingRegulars: Math.max(0, sideA.regulars - aRegLost),
      survivingMercs: Math.max(0, sideA.mercs - aMercLost),
    },
    sideB: {
      playerId: sideB.playerId,
      survivingRegulars: Math.max(0, sideB.regulars - bRegLost),
      survivingMercs: Math.max(0, sideB.mercs - bMercLost),
    },
    rounds,
    totalRounds: rounds.length,
  };
}

/**
 * Resolve a single 1v1 duel. Returns 'A' or 'B'.
 * Ties re-roll until resolved.
 */
function resolveDuel(rng: GameRng, modA: number, modB: number): 'A' | 'B' {
  for (let attempts = 0; attempts < 100; attempts++) {
    const rollA = rng.nextInt(DICE_MIN, DICE_MAX);
    const rollB = rng.nextInt(DICE_MIN, DICE_MAX);

    const finalA = clamp(rollA + modA, DICE_RESULT_MIN, DICE_RESULT_MAX);
    const finalB = clamp(rollB + modB, DICE_RESULT_MIN, DICE_RESULT_MAX);

    if (finalA > finalB) return 'A';
    if (finalB > finalA) return 'B';
    // Tie: re-roll
  }
  // Fallback after max attempts (extremely unlikely)
  return rng.nextFloat() < 0.5 ? 'A' : 'B';
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/**
 * Run a bracket tournament for 3+ sides contesting a province.
 * Returns results in elimination order, final winner first.
 */
export function runBracketTournament(
  rng: GameRng,
  participants: BattleSide[]
): { winner: BattleSide; results: BattleResult[] } {
  if (participants.length < 2) {
    return { winner: participants[0], results: [] };
  }

  // Shuffle bracket order
  const shuffled = [...participants];
  rng.shuffle(shuffled);

  const results: BattleResult[] = [];
  let remaining = [...shuffled];

  while (remaining.length > 1) {
    const nextRound: BattleSide[] = [];

    for (let i = 0; i < remaining.length; i += 2) {
      if (i + 1 >= remaining.length) {
        // Odd one out gets a bye
        nextRound.push(remaining[i]);
        continue;
      }

      const result = resolveBattle(rng, remaining[i], remaining[i + 1]);
      results.push(result);

      // Winner advances with surviving units
      if (result.winner === remaining[i].playerId) {
        nextRound.push({
          ...remaining[i],
          regulars: result.sideA.survivingRegulars,
          mercs: result.sideA.survivingMercs,
        });
      } else {
        nextRound.push({
          ...remaining[i + 1],
          regulars: result.sideB.survivingRegulars,
          mercs: result.sideB.survivingMercs,
        });
      }
    }

    remaining = nextRound;
  }

  return { winner: remaining[0], results };
}
