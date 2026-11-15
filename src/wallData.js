// Walls: a cross-section PROFILE (depth x rows) extruded along a length.
// Profile coordinates: d = 0 is the BACK of the wall, the highest d is the FRONT
// (the side facing the room); r = 0 is the bottom row.
// One row can be the "stretch row": it repeats so the profile fits any wall height,
// with the rows below it anchored to the floor and the rows above anchored to the top.
// Cells hold a block state or "pal:<id>" (a palette with a vertical gradient).
//
// In the wall's local space: x = along the length, y = up, z = depth (front = +z).
// "facing=north" in a profile therefore points to the BACK of the wall.

import { newStamp, key, stairState } from './stampData.js';
import { resolveSpec, hash01 } from './palettes.js';

export function newWall(profile, length = 12, height = null) {
  return { length, height: height ?? profile.rows, seed: Math.floor(Math.random() * 1e6), profile: JSON.parse(JSON.stringify(profile)) };
}

// Profile row used for target row y of a wall that is `H` rows tall.
export function profileRow(profile, y, H) {
  const R = profile.rows, sr = profile.stretchRow;
  if (sr === null || sr === undefined || sr < 0 || sr >= R) return y < R ? y : -1;
  const above = R - sr - 1; // rows anchored to the top
  if (H >= R) {
    if (y < sr) return y;
    if (y >= H - above) return R - (H - y);
    return sr;
  }
  // shorter than the profile: keep the bottom rows, then the top rows
  const keepBottom = Math.max(0, H - above);
  if (y < Math.min(sr, keepBottom)) return y;
  return R - (H - y) >= 0 ? R - (H - y) : -1;
}

// Expand a wall into a stamp (block-exact) using the given palettes.
export function wallToStamp(wall, palettes = []) {
  const p = wall.profile;
  const L = Math.max(1, Math.round(wall.length)), H = Math.max(1, Math.round(wall.height ?? p.rows)), Dp = p.depth;
  const s = newStamp('wall', [L, H, Dp]);
  s.id = 'wall';
  for (let y = 0; y < H; y++) {
    const r = profileRow(p, y, H);
    if (r < 0) continue;
    const t = H > 1 ? y / (H - 1) : 0.5;
    for (let d = 0; d < Dp; d++) {
      const spec = p.cells[`${d},${r}`];
      if (!spec) continue;
      for (let x = 0; x < L; x++) {
        const st = resolveSpec(spec, palettes, t, hash01(x, y, d, wall.seed || 0));
        if (st) s.blocks[key(x, y, d)] = st;
      }
    }
  }
  return s;
}

const cells = (list) => Object.fromEntries(list.map(([d, r, b]) => [`${d},${r}`, b.startsWith('pal:') ? b : 'minecraft:' + b]));

// Built-in profiles. Stairs with facing=north lean against the wall (tall side at the back).
export const PRESET_PROFILES = [
  {
    id: 'hall', name: 'Hall wall: stone panels, spruce beam', depth: 2, rows: 9, stretchRow: 3,
    cells: cells([
      [0, 0, 'polished_andesite'], [1, 0, 'stone_brick_stairs[facing=north,half=bottom,shape=straight]'],
      [0, 1, 'stone_bricks'], [0, 2, 'pal:panel-stone'], [0, 3, 'pal:panel-stone'], [0, 4, 'pal:panel-stone'], [0, 5, 'stone_bricks'],
      [0, 6, 'stripped_spruce_log[axis=x]'], [1, 6, 'spruce_slab[type=top]'],
      [0, 7, 'stripped_spruce_log[axis=x]'], [1, 7, 'spruce_stairs[facing=north,half=top,shape=straight]'],
      [0, 8, 'stone_bricks'],
    ]),
  },
  {
    id: 'worn', name: 'Worn stone (moss toward the floor)', depth: 1, rows: 3, stretchRow: 1,
    cells: cells([[0, 0, 'pal:worn-stone'], [0, 1, 'pal:worn-stone'], [0, 2, 'pal:worn-stone']]),
  },
  {
    id: 'layered', name: 'Layered: plinth, field, cornice', depth: 3, rows: 6, stretchRow: 3,
    cells: cells([
      [0, 0, 'pal:mossy-cobble'], [1, 0, 'pal:mossy-cobble'], [2, 0, 'cobblestone_stairs[facing=north,half=bottom,shape=straight]'],
      [0, 1, 'pal:worn-stone'], [1, 1, 'stone_brick_stairs[facing=north,half=bottom,shape=straight]'],
      [0, 2, 'pal:worn-stone'], [0, 3, 'pal:worn-stone'],
      [0, 4, 'pal:worn-stone'], [1, 4, 'stone_brick_stairs[facing=north,half=top,shape=straight]'],
      [0, 5, 'stone_bricks'], [1, 5, 'stone_bricks'], [2, 5, 'stone_brick_slab[type=bottom]'],
    ]),
  },
  {
    id: 'timber', name: 'Timber frame: spruce posts and beams', depth: 1, rows: 5, stretchRow: 2,
    cells: cells([
      [0, 0, 'stripped_spruce_log[axis=x]'], [0, 1, 'pal:old-spruce'], [0, 2, 'pal:old-spruce'], [0, 3, 'pal:old-spruce'], [0, 4, 'stripped_spruce_log[axis=x]'],
    ]),
  },
  {
    id: 'tuff', name: 'Tuff into deepslate, thick', depth: 2, rows: 4, stretchRow: 2,
    cells: cells([
      [0, 0, 'pal:tuff-deepslate'], [1, 0, 'polished_deepslate_stairs[facing=north,half=bottom,shape=straight]'],
      [0, 1, 'pal:tuff-deepslate'], [0, 2, 'pal:tuff-deepslate'],
      [0, 3, 'polished_tuff'], [1, 3, 'tuff_brick_stairs[facing=north,half=top,shape=straight]'],
    ]),
  },
];

// ---------------------------------------------------------------- pillar generator
// Quarters of a ring cell (in an n x n footprint centered on c) that face the column.
function towardCenter(dx, dz, c) {
  const xs = dx < c ? [1] : dx > c ? [0] : [0, 1];
  const zs = dz < c ? [1] : dz > c ? [0] : [0, 1];
  let part = 0;
  for (const qx of xs) for (const qz of zs) part |= 1 << (qx + 2 * qz);
  return part;
}
const ringCells = (c, dist) => {
  const out = [];
  for (let dz = c - dist; dz <= c + dist; dz++) for (let dx = c - dist; dx <= c + dist; dx++) {
    if (Math.max(Math.abs(dx - c), Math.abs(dz - c)) === dist) out.push([dx, dz]);
  }
  return out;
};

/**
 * Parametric pillar -> stamp.
 * o = { height, column, wood, bandWood, base: 'none'|'stairs'|'skirt', lowerWrap, upperWrap,
 *       bands: [heights], capital: 'none'|'stairs'|'stairs-cap', name }
 */
export function generatePillar(o) {
  const H = Math.max(3, Math.round(o.height || 9));
  const wood = o.wood || 'spruce', band = o.bandWood || wood;
  const skirt = o.base === 'skirt';
  const n = skirt ? 5 : 3, c = (n - 1) / 2;
  const s = newStamp(o.name || `${wood} pillar`, [n, H, n]);
  const b = s.blocks;
  const capRows = o.capital === 'stairs-cap' ? 2 : o.capital === 'stairs' ? 1 : 0;
  const top = H - 1;
  const capStairY = H - capRows; // first capital row
  // column
  for (let y = 0; y < (o.capital === 'stairs-cap' ? H - 1 : H); y++) b[key(c, y, c)] = o.column || `minecraft:stripped_${wood}_log[axis=y]`;
  // base
  let baseTop = 0;
  if (o.base === 'stairs') {
    for (const [dx, dz] of ringCells(c, 1)) b[key(dx, 0, dz)] = stairState(`${wood}_stairs`, towardCenter(dx, dz, c));
    baseTop = 1;
  } else if (skirt) {
    for (const [dx, dz] of ringCells(c, 2)) b[key(dx, 0, dz)] = stairState(`${wood}_stairs`, towardCenter(dx, dz, c));
    for (const [dx, dz] of ringCells(c, 1)) b[key(dx, 0, dz)] = `minecraft:${wood}_planks`;
    for (const [dx, dz] of ringCells(c, 1)) b[key(dx, 1, dz)] = stairState(`${wood}_stairs`, towardCenter(dx, dz, c));
    baseTop = 2;
  }
  // open trapdoors standing against the 4 faces of the column
  const faces = [[c, c - 1, 'north'], [c, c + 1, 'south'], [c - 1, c, 'west'], [c + 1, c, 'east']];
  const wrap = (y, half = 'bottom') => { for (const [dx, dz, f] of faces) b[key(dx, y, dz)] = `minecraft:${wood}_trapdoor[facing=${f},half=${half},open=true]`; };
  for (let i = 0; i < (o.lowerWrap || 0); i++) { const y = baseTop + i; if (y < capStairY) wrap(y); }
  for (let i = 0; i < (o.upperWrap || 0); i++) { const y = capStairY - 1 - i; if (y >= baseTop) wrap(y, 'top'); }
  // bands: closed trapdoors forming a thin collar
  for (const y of o.bands || []) {
    if (y < baseTop || y >= capStairY) continue;
    for (const [dx, dz] of ringCells(c, 1)) b[key(dx, y, dz)] = `minecraft:${band}_trapdoor[facing=north,half=top,open=false]`;
  }
  // capital
  if (capRows) {
    for (const [dx, dz] of ringCells(c, 1)) b[key(dx, capStairY, dz)] = stairState(`${wood}_stairs`, towardCenter(dx, dz, c), true);
    if (o.capital === 'stairs-cap') for (let dz = c - 1; dz <= c + 1; dz++) for (let dx = c - 1; dx <= c + 1; dx++) b[key(dx, top, dz)] = `minecraft:${wood}_planks`;
  }
  return s;
}

export const DEFAULT_PILLAR = {
  name: 'Hall pillar', height: 10, wood: 'spruce', bandWood: 'acacia', column: 'minecraft:stripped_spruce_log[axis=y]',
  base: 'skirt', lowerWrap: 3, upperWrap: 2, bands: [5], capital: 'stairs',
};
