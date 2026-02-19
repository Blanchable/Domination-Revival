/**
 * Generates a map with 700+ provinces organized into subregions and regions.
 * Outputs map/map.json.
 *
 * Structure:
 * - 10 Regions
 * - ~7 Subregions per Region (70 total)
 * - ~10 Provinces per Subregion (700+ total)
 *
 * Adjacency is generated as a grid-like graph with local connections.
 */

import { writeFileSync } from 'fs';
import { join } from 'path';

interface MapProvince {
  id: string;
  name: string;
  subRegionId: string;
  regionId: string;
  adjacency: string[];
}

interface MapSubRegion {
  id: string;
  name: string;
  regionId: string;
  provinceIds: string[];
}

interface MapRegion {
  id: string;
  name: string;
  subRegionIds: string[];
}

interface GameMap {
  id: string;
  name: string;
  regions: MapRegion[];
  subRegions: MapSubRegion[];
  provinces: MapProvince[];
}

// Region theme names for flavor
const REGION_NAMES = [
  'Nordheim',
  'Valdris',
  'Calanthia',
  'Duskmere',
  'Ironpeak',
  'Solara',
  'Thornwall',
  'Misthollow',
  'Ashenvale',
  'Stormreach',
];

const SUBREGION_PREFIXES = [
  'Upper', 'Lower', 'East', 'West', 'North', 'South', 'Central',
  'Inner', 'Outer', 'Greater',
];

const PROVINCE_SUFFIXES = [
  'shire', 'vale', 'feld', 'keep', 'hold', 'march', 'haven',
  'moor', 'dale', 'crest', 'ford', 'wick', 'bury', 'glen',
  'brook', 'ridge', 'gate', 'hill', 'port', 'wood',
];

const PROVINCE_PREFIXES = [
  'Stone', 'Iron', 'Gold', 'Silver', 'Dark', 'Bright', 'Red',
  'Green', 'White', 'Black', 'Blue', 'Grey', 'Old', 'New',
  'High', 'Low', 'Deep', 'Far', 'Storm', 'Sun', 'Moon',
  'Frost', 'Fire', 'Dawn', 'Dusk', 'Oak', 'Elm', 'Ash',
  'Wolf', 'Bear', 'Hawk', 'Fox', 'Stag', 'Lion', 'Crow',
  'Swan', 'Raven', 'Eagle', 'Pike', 'Thorn',
];

function generate(): GameMap {
  const regions: MapRegion[] = [];
  const subRegions: MapSubRegion[] = [];
  const provinces: MapProvince[] = [];

  const usedNames = new Set<string>();

  function uniqueProvinceName(): string {
    let attempts = 0;
    while (attempts < 1000) {
      const prefix = PROVINCE_PREFIXES[Math.floor(Math.random() * PROVINCE_PREFIXES.length)];
      const suffix = PROVINCE_SUFFIXES[Math.floor(Math.random() * PROVINCE_SUFFIXES.length)];
      const name = `${prefix}${suffix}`;
      if (!usedNames.has(name)) {
        usedNames.add(name);
        return name;
      }
      attempts++;
    }
    // Fallback: append number
    const name = `Province_${provinces.length + 1}`;
    usedNames.add(name);
    return name;
  }

  let provinceCounter = 0;

  // Create 10 regions, each with 7 subregions, each with 10 provinces
  for (let r = 0; r < 10; r++) {
    const regionId = `R${String(r + 1).padStart(2, '0')}`;
    const regionName = REGION_NAMES[r];
    const regionSubRegionIds: string[] = [];

    for (let s = 0; s < 7; s++) {
      const subRegionId = `${regionId}_S${String(s + 1).padStart(2, '0')}`;
      const subRegionName = `${SUBREGION_PREFIXES[s]} ${regionName}`;
      const subProvinceIds: string[] = [];

      for (let p = 0; p < 10; p++) {
        provinceCounter++;
        const provinceId = `P${String(provinceCounter).padStart(4, '0')}`;
        const provinceName = uniqueProvinceName();

        subProvinceIds.push(provinceId);
        provinces.push({
          id: provinceId,
          name: provinceName,
          subRegionId,
          regionId,
          adjacency: [], // filled below
        });
      }

      regionSubRegionIds.push(subRegionId);
      subRegions.push({
        id: subRegionId,
        name: subRegionName,
        regionId,
        provinceIds: subProvinceIds,
      });
    }

    regions.push({
      id: regionId,
      name: regionName,
      subRegionIds: regionSubRegionIds,
    });
  }

  // Build adjacency: treat provinces as a grid (28 cols x 25 rows = 700)
  // provinces within same subregion are neighbors, plus cross-subregion connections
  const COLS = 28;
  const ROWS = Math.ceil(provinces.length / COLS);

  // Index map for fast lookup
  const idToIdx = new Map<string, number>();
  provinces.forEach((p, i) => idToIdx.set(p.id, i));

  // Grid adjacency: connect to neighbors in a 2D grid layout
  for (let i = 0; i < provinces.length; i++) {
    const row = Math.floor(i / COLS);
    const col = i % COLS;
    const neighbors: string[] = [];

    // 4-directional + diagonals for richer connectivity
    const offsets = [
      [-1, 0], [1, 0], [0, -1], [0, 1], // cardinal
      [-1, -1], [-1, 1], [1, -1], [1, 1], // diagonal (optional, adds richness)
    ];

    for (const [dr, dc] of offsets) {
      const nr = row + dr;
      const nc = col + dc;
      if (nr >= 0 && nr < ROWS && nc >= 0 && nc < COLS) {
        const ni = nr * COLS + nc;
        if (ni < provinces.length) {
          neighbors.push(provinces[ni].id);
        }
      }
    }

    provinces[i].adjacency = neighbors;
  }

  // Also ensure intra-subregion connectivity (chain within subregion)
  for (const sr of subRegions) {
    for (let i = 0; i < sr.provinceIds.length - 1; i++) {
      const a = sr.provinceIds[i];
      const b = sr.provinceIds[i + 1];
      const provA = provinces[idToIdx.get(a)!];
      const provB = provinces[idToIdx.get(b)!];
      if (!provA.adjacency.includes(b)) provA.adjacency.push(b);
      if (!provB.adjacency.includes(a)) provB.adjacency.push(a);
    }
  }

  // Cross-region connections: connect last province of each region to first province of next region
  for (let r = 0; r < regions.length - 1; r++) {
    const region1 = regions[r];
    const region2 = regions[r + 1];
    const lastSR1 = subRegions.find(s => s.id === region1.subRegionIds[region1.subRegionIds.length - 1])!;
    const firstSR2 = subRegions.find(s => s.id === region2.subRegionIds[0])!;
    const lastP = lastSR1.provinceIds[lastSR1.provinceIds.length - 1];
    const firstP = firstSR2.provinceIds[0];
    const provA = provinces[idToIdx.get(lastP)!];
    const provB = provinces[idToIdx.get(firstP)!];
    if (!provA.adjacency.includes(firstP)) provA.adjacency.push(firstP);
    if (!provB.adjacency.includes(lastP)) provB.adjacency.push(lastP);
  }

  // Wrap-around: connect last region to first
  {
    const lastRegion = regions[regions.length - 1];
    const firstRegion = regions[0];
    const lastSR = subRegions.find(s => s.id === lastRegion.subRegionIds[lastRegion.subRegionIds.length - 1])!;
    const firstSR = subRegions.find(s => s.id === firstRegion.subRegionIds[0])!;
    const lastP = lastSR.provinceIds[lastSR.provinceIds.length - 1];
    const firstP = firstSR.provinceIds[0];
    const provA = provinces[idToIdx.get(lastP)!];
    const provB = provinces[idToIdx.get(firstP)!];
    if (!provA.adjacency.includes(firstP)) provA.adjacency.push(firstP);
    if (!provB.adjacency.includes(lastP)) provB.adjacency.push(lastP);
  }

  // Deduplicate adjacency lists
  for (const p of provinces) {
    p.adjacency = [...new Set(p.adjacency)];
  }

  const map: GameMap = {
    id: 'default',
    name: 'The Grand Realm',
    regions,
    subRegions,
    provinces,
  };

  console.log(`Generated map: ${regions.length} regions, ${subRegions.length} subregions, ${provinces.length} provinces`);
  console.log(`Average adjacency: ${(provinces.reduce((s, p) => s + p.adjacency.length, 0) / provinces.length).toFixed(1)}`);

  return map;
}

const map = generate();
const outPath = join(__dirname, '../../map/map.json');
writeFileSync(outPath, JSON.stringify(map, null, 2));
console.log(`Map written to ${outPath}`);
