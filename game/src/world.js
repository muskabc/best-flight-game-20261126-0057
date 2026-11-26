// world.js — the archipelago: island heightfield, runways, ring course, missions.
// Everything here is pure data and math; nothing draws and nothing reads input.

export const WATER_Y = 0;

// Islands: centre (x,z), peak height, spread. The two big ones carry runways.
export const ISLANDS = [
  { name: "Home Isle", x: 0, z: 0, peak: 30, spread: 560 },
  { name: "Far Isle", x: 1500, z: -900, peak: 34, spread: 600 },
  { name: "Palm Cay", x: -900, z: -700, peak: 26, spread: 340 },
  { name: "Gull Rock", x: 700, z: 800, peak: 34, spread: 300 },
  { name: "Ember Atoll", x: -1400, z: 600, peak: 22, spread: 380 },
  { name: "North Spire", x: 300, z: -1600, peak: 72, spread: 420 },
];

// Runways are axis-aligned strips (long side along x). y is the flattened height.
export const RUNWAYS = [
  { name: "Home Strip", x: 0, z: 0, len: 340, wid: 26, y: 12 },
  { name: "Far Strip", x: 1500, z: -900, len: 320, wid: 26, y: 16 },
];

// The ring course for mission 1: centre + radius, flown in order.
export const RINGS = [
  { x: 420, y: 95, z: -260, r: 26 },
  { x: 820, y: 120, z: -520, r: 26 },
  { x: 1180, y: 90, z: -760, r: 26 },
  { x: 1500, y: 130, z: -1050, r: 26 },
  { x: 1050, y: 105, z: -1350, r: 26 },
  { x: 420, y: 85, z: -1100, r: 26 },
];

// Delivery beacon for mission 3 (over Ember Atoll).
export const BEACON = { x: -1400, y: 70, z: 600, r: 60 };

export const MISSIONS = [
  {
    id: "rings",
    title: "Mission 1 · Ring Runner",
    brief: "Fly through all 6 rings in order, then land back at Home Strip.",
    fuel: 100,
    wind: 0,
  },
  {
    id: "hop",
    title: "Mission 2 · Island Hop",
    brief: "Take off from Home Strip and land at Far Strip. Gentle touchdown!",
    fuel: 100,
    wind: 2,
  },
  {
    id: "storm",
    title: "Mission 3 · Storm Delivery",
    brief: "Reach the beacon over Ember Atoll on 55% fuel, in gusty wind, then land anywhere safe.",
    fuel: 55,
    wind: 7,
  },
  {
    id: "free",
    title: "Free Flight",
    brief: "No goals. Explore the islands, practise landings.",
    fuel: 100,
    wind: 1,
  },
];

// Deterministic little noise so the terrain is identical on every load.
function ripple(x, z) {
  return (
    Math.sin(x * 0.011 + z * 0.017) * 2.4 +
    Math.sin(x * 0.004 - z * 0.006) * 3.6 +
    Math.cos((x + z) * 0.0021) * 2.0
  );
}

function smooth01(t) {
  const c = Math.max(0, Math.min(1, t));
  return c * c * (3 - 2 * c);
}

// Height of the ground at (x, z). Water sits at WATER_Y; land rises above it.
export function groundHeight(x, z) {
  let h = -6;
  for (const isl of ISLANDS) {
    const dx = x - isl.x;
    const dz = z - isl.z;
    const d2 = dx * dx + dz * dz;
    const s2 = isl.spread * isl.spread;
    h += isl.peak * Math.exp(-d2 / (2 * s2));
  }
  if (h > -2) h += ripple(x, z) * Math.min(1, (h + 2) / 14);
  // Flatten each runway strip and blend the edges back into the hill.
  for (const rw of RUNWAYS) {
    const dx = Math.abs(x - rw.x);
    const dz = Math.abs(z - rw.z);
    const mx = rw.len / 2 + 90;
    const mz = rw.wid / 2 + 70;
    if (dx < mx && dz < mz) {
      const tx = 1 - smooth01((dx - rw.len / 2) / 90);
      const tz = 1 - smooth01((dz - rw.wid / 2) / 70);
      const t = Math.min(tx, tz);
      h = h * (1 - t) + rw.y * t;
    }
  }
  return h;
}

// True when (x, z) lies on a runway strip; returns the runway or null.
export function runwayAt(x, z) {
  for (const rw of RUNWAYS) {
    if (Math.abs(x - rw.x) <= rw.len / 2 && Math.abs(z - rw.z) <= rw.wid / 2) return rw;
  }
  return null;
}

// Colour for a terrain cell from its height and slope. Returns an [r,g,b] triple.
export function terrainColour(h, slope) {
  if (h < 0.4) return [38, 96, 140]; // shallow water
  if (h < 2.2) return [214, 196, 140]; // sand
  if (h < 20) return [92, 158, 74]; // grass
  if (h < 32) return [70, 128, 62]; // deep grass / scrub
  if (h < 48) return [128, 116, 96]; // rock
  return [232, 236, 240]; // snow cap
}

// Seeded RNG (mulberry32) so clouds and trees sit in the same place every load.
export function makeRng(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Scattered palms: fixed positions on land, used by the renderer as billboards.
export function scatterTrees(seed, count) {
  const rng = makeRng(seed);
  const trees = [];
  let guard = 0;
  while (trees.length < count && guard < count * 40) {
    guard++;
    const isl = ISLANDS[Math.floor(rng() * ISLANDS.length)];
    const x = isl.x + (rng() * 2 - 1) * isl.spread * 0.85;
    const z = isl.z + (rng() * 2 - 1) * isl.spread * 0.85;
    const h = groundHeight(x, z);
    if (h > 2.5 && h < 26 && !runwayAt(x, z)) trees.push({ x, y: h, z, s: 0.8 + rng() * 0.7 });
  }
  return trees;
}

// Clouds drift slowly; their base positions are seeded too.
export function scatterClouds(seed, count) {
  const rng = makeRng(seed);
  const clouds = [];
  for (let i = 0; i < count; i++) {
    clouds.push({
      x: (rng() * 2 - 1) * 2600,
      y: 180 + rng() * 130,
      z: (rng() * 2 - 1) * 2600,
      s: 60 + rng() * 120,
    });
  }
  return clouds;
}
