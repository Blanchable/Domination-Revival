import { readFileSync } from 'fs';
import { join } from 'path';

export interface MapProvince {
  id: string;
  name: string;
  subRegionId: string;
  regionId: string;
  adjacency: string[];
}

export interface MapSubRegion {
  id: string;
  name: string;
  regionId: string;
  provinceIds: string[];
}

export interface MapRegion {
  id: string;
  name: string;
  subRegionIds: string[];
}

export interface GameMap {
  id: string;
  name: string;
  regions: MapRegion[];
  subRegions: MapSubRegion[];
  provinces: MapProvince[];
}

/** In-memory cache of loaded maps */
const mapCache = new Map<string, GameMap>();

/**
 * Load a map definition from the /map directory.
 * Caches in memory for fast repeated access.
 */
export function loadMap(mapId: string = 'default'): GameMap {
  if (mapCache.has(mapId)) {
    return mapCache.get(mapId)!;
  }

  const mapPath = join(__dirname, '../../map/map.json');
  const raw = readFileSync(mapPath, 'utf-8');
  const map: GameMap = JSON.parse(raw);

  // Build adjacency index for fast lookups
  mapCache.set(map.id, map);
  return map;
}

/**
 * Get adjacency set for fast neighbor lookups.
 */
export function buildAdjacencyMap(map: GameMap): Map<string, Set<string>> {
  const adj = new Map<string, Set<string>>();
  for (const p of map.provinces) {
    adj.set(p.id, new Set(p.adjacency));
  }
  return adj;
}

/**
 * Multi-source BFS to compute shortest distances from a set of source provinces.
 * Returns a Map from provinceId -> distance.
 */
export function bfsDistances(
  adjacencyMap: Map<string, Set<string>>,
  sources: string[]
): Map<string, number> {
  const dist = new Map<string, number>();
  const queue: string[] = [];

  for (const s of sources) {
    if (adjacencyMap.has(s)) {
      dist.set(s, 0);
      queue.push(s);
    }
  }

  let head = 0;
  while (head < queue.length) {
    const current = queue[head++];
    const currentDist = dist.get(current)!;
    const neighbors = adjacencyMap.get(current);
    if (!neighbors) continue;

    for (const n of neighbors) {
      if (!dist.has(n)) {
        dist.set(n, currentDist + 1);
        queue.push(n);
      }
    }
  }

  return dist;
}

/**
 * Compute minimum distance between two sets of provinces.
 */
export function minDistanceBetweenSets(
  adjacencyMap: Map<string, Set<string>>,
  setA: string[],
  setB: string[]
): number {
  const distances = bfsDistances(adjacencyMap, setA);
  let minDist = Infinity;
  for (const b of setB) {
    const d = distances.get(b);
    if (d !== undefined && d < minDist) {
      minDist = d;
    }
  }
  return minDist === Infinity ? -1 : minDist;
}
