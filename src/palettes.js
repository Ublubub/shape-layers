// Block palettes with a vertical gradient: each entry has a weight at the TOP and at the
// BOTTOM of the element it is used in, e.g. moss that gets more common toward the floor.
// Picks are deterministic (hash of the block position + seed), so a wall looks the same
// every time it is converted.

const P = (id, name, entries) => ({ id, name, entries: entries.map(([b, top, bottom]) => ({ state: 'minecraft:' + b, top, bottom })) });

export const PRESET_PALETTES = [
  P('panel-stone', 'Stone panels', [['polished_andesite', 40, 40], ['stone_bricks', 40, 35], ['chiseled_stone_bricks', 8, 8], ['andesite', 12, 17]]),
  P('worn-stone', 'Worn stone bricks', [['stone_bricks', 60, 30], ['cracked_stone_bricks', 15, 20], ['mossy_stone_bricks', 5, 35], ['polished_andesite', 20, 15]]),
  P('mossy-cobble', 'Mossy cobblestone', [['cobblestone', 65, 30], ['mossy_cobblestone', 20, 55], ['stone', 15, 15]]),
  P('tuff-deepslate', 'Tuff into deepslate', [['tuff_bricks', 50, 15], ['polished_tuff', 30, 15], ['chiseled_tuff_bricks', 10, 5], ['deepslate_bricks', 10, 40], ['cobbled_deepslate', 0, 25]]),
  P('old-spruce', 'Weathered spruce', [['spruce_planks', 70, 45], ['stripped_spruce_wood', 20, 25], ['dark_oak_planks', 10, 30]]),
  P('sandstone-ruin', 'Sandstone ruins', [['sandstone', 40, 25], ['smooth_sandstone', 30, 20], ['cut_sandstone', 22, 20], ['chiseled_sandstone', 5, 5], ['mud_bricks', 3, 30]]),
  P('deepslate-mix', 'Deepslate mix', [['deepslate_bricks', 45, 35], ['cracked_deepslate_bricks', 15, 25], ['deepslate_tiles', 30, 20], ['polished_deepslate', 10, 20]]),
];

export const clonePresets = () => JSON.parse(JSON.stringify(PRESET_PALETTES));

// Small integer hash -> [0, 1)
export function hash01(x, y, z, seed = 0) {
  let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(z | 0, 2147483647) + Math.imul(seed | 0, 1274126177)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1103515245);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** Pick a block from a palette. t = 0 at the bottom of the element, 1 at the top. */
export function pickFromPalette(pal, t, r) {
  const ws = pal.entries.map((e) => Math.max(0, (e.bottom ?? 0) + ((e.top ?? 0) - (e.bottom ?? 0)) * Math.min(1, Math.max(0, t))));
  const sum = ws.reduce((a, b) => a + b, 0);
  if (!sum) return pal.entries[0] ? pal.entries[0].state : 'minecraft:stone';
  let x = r * sum;
  for (let i = 0; i < ws.length; i++) { x -= ws[i]; if (x < 0) return pal.entries[i].state; }
  return pal.entries[pal.entries.length - 1].state;
}

// Resolve a cell spec: either a block state or "pal:<id>".
export function resolveSpec(spec, palettes, t, r) {
  if (typeof spec === 'string' && spec.startsWith('pal:')) {
    const pal = palettes.find((p) => p.id === spec.slice(4));
    return pal ? pickFromPalette(pal, t, r) : 'minecraft:stone';
  }
  return spec;
}
