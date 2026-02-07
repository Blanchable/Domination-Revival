import { PrismaClient } from '@prisma/client';

/**
 * Acquire a PostgreSQL advisory lock for tick processing.
 * Returns true if lock acquired, false otherwise.
 * Uses a hash of the gameId as the lock key.
 */
export async function acquireTickLock(prisma: PrismaClient, gameId: string): Promise<boolean> {
  // Convert gameId UUID to a 32-bit integer for advisory lock
  const lockKey = hashToInt32(gameId);

  const result = await prisma.$queryRawUnsafe<{ pg_try_advisory_lock: boolean }[]>(
    `SELECT pg_try_advisory_lock($1)`,
    lockKey
  );

  return result[0]?.pg_try_advisory_lock ?? false;
}

/**
 * Release the advisory lock for tick processing.
 */
export async function releaseTickLock(prisma: PrismaClient, gameId: string): Promise<void> {
  const lockKey = hashToInt32(gameId);
  await prisma.$queryRawUnsafe(`SELECT pg_advisory_unlock($1)`, lockKey);
}

function hashToInt32(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash |= 0; // Convert to 32bit integer
  }
  return Math.abs(hash);
}
