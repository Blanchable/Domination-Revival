import seedrandom from 'seedrandom';
import { createHash } from 'crypto';

export interface GameRng {
  /** Returns integer in [min, max] inclusive */
  nextInt(min: number, max: number): number;
  /** Returns float in [0, 1) */
  nextFloat(): number;
  /** Shuffle array in-place using Fisher-Yates */
  shuffle<T>(arr: T[]): T[];
  /** Pick one element randomly */
  pick<T>(arr: T[]): T;
  /** Weighted random index; weights need not sum to 1 */
  weightedIndex(weights: number[]): number;
}

/**
 * Create a deterministic seed string from game parameters.
 */
export function createSeed(gameId: string, turnNumber: number, extra?: string): string {
  const raw = `${gameId}:${turnNumber}:${extra ?? ''}`;
  return createHash('sha256').update(raw).digest('hex');
}

/**
 * Create a deterministic RNG from a seed string.
 */
export function createRng(seed: string): GameRng {
  const rng = seedrandom(seed);

  const nextFloat = (): number => rng();

  const nextInt = (min: number, max: number): number => {
    return Math.floor(nextFloat() * (max - min + 1)) + min;
  };

  const shuffle = <T>(arr: T[]): T[] => {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = nextInt(0, i);
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  };

  const pick = <T>(arr: T[]): T => {
    return arr[nextInt(0, arr.length - 1)];
  };

  const weightedIndex = (weights: number[]): number => {
    const total = weights.reduce((a, b) => a + b, 0);
    let r = nextFloat() * total;
    for (let i = 0; i < weights.length; i++) {
      r -= weights[i];
      if (r <= 0) return i;
    }
    return weights.length - 1;
  };

  return { nextInt, nextFloat, shuffle, pick, weightedIndex };
}
