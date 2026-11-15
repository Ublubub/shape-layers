// Helpers for arbitrary Minecraft block states, e.g.
//   "minecraft:spruce_trapdoor[facing=north,half=top,open=true]"
// Pure functions (no Three.js) so they work in the worker and in Node tests.

import { BLOCKS } from './blocks.js';

export function parseState(s) {
  const m = /^([^\[]+)(?:\[(.*)\])?$/.exec(String(s).trim());
  let id = m ? m[1].trim() : String(s);
  if (!id.includes(':')) id = 'minecraft:' + id;
  const props = {};
  if (m && m[2]) for (const kv of m[2].split(',')) {
    const [k, v] = kv.split('=').map((x) => x && x.trim());
    if (k) props[k] = v;
  }
  return { id, name: id.split(':')[1], props };
}

export function formatState({ id, props }) {
  const keys = Object.keys(props || {}).sort();
  return keys.length ? `${id}[${keys.map((k) => `${k}=${props[k]}`).join(',')}]` : id;
}

const CW = { north: 'east', east: 'south', south: 'west', west: 'north' };

// Rotate a block state clockwise (seen from above) by `turns` quarter turns.
export function rotateState(state, turns) {
  turns = ((turns % 4) + 4) % 4;
  if (!turns) return state;
  const st = parseState(state);
  const p = { ...st.props };
  for (let t = 0; t < turns; t++) {
    if (p.facing && CW[p.facing]) p.facing = CW[p.facing];
    if (p.axis === 'x') p.axis = 'z'; else if (p.axis === 'z') p.axis = 'x';
    if (p.rotation !== undefined && /^\d+$/.test(p.rotation)) p.rotation = String((+p.rotation + 4) % 16);
    // connection flags (fences, walls, panes, vines): north -> east -> south -> west
    const sides = ['north', 'east', 'south', 'west'];
    if (sides.some((s) => p[s] !== undefined)) {
      const old = sides.map((s) => p[s]);
      sides.forEach((s, i) => { if (old[(i + 3) % 4] !== undefined) p[s] = old[(i + 3) % 4]; else delete p[s]; });
    }
  }
  return formatState({ id: st.id, props: p });
}

// Rough shape family used for previews and section views.
export function shapeFamily(name) {
  if (name.endsWith('_stairs')) return 'stairs';
  if (name.endsWith('_slab')) return 'slab';
  if (name.endsWith('_trapdoor')) return 'trapdoor';
  if (/_carpet$|pressure_plate$|^snow$/.test(name)) return 'carpet';
  if (/(_fence|_wall|^chain|iron_bars|_pane|end_rod|lightning_rod|_fence_gate)$/.test(name) || name === 'chain') return 'post';
  if (/(lantern|torch|candle|button|lever|flower_pot|^ladder|_sign|_banner|sapling|^vine|_rod$)/.test(name)) return 'small';
  if (/^(air|cave_air|void_air|structure_void)$/.test(name)) return 'air';
  return 'full';
}

// Octant mask (bit = x + 2*z + 4*y) approximating the block's shape.
// Quarter bits: 0 NW, 1 NE, 2 SW, 3 SE. A stair's tall part covers the `facing` half;
// outer corners keep only the quarter on the left/right side, inner corners add that side's half.
const HALF = { north: 0b0011, south: 0b1100, west: 0b0101, east: 0b1010 };
const LEFT = { north: 'west', west: 'south', south: 'east', east: 'north' };
const RIGHT = { north: 'east', east: 'south', south: 'west', west: 'north' };
export function stairMaskFromProps(p) {
  const f = HALF[p.facing] ? p.facing : 'north';
  const shape = p.shape || 'straight';
  let part = HALF[f];
  if (shape === 'outer_left') part &= HALF[LEFT[f]];
  else if (shape === 'outer_right') part &= HALF[RIGHT[f]];
  else if (shape === 'inner_left') part |= HALF[LEFT[f]];
  else if (shape === 'inner_right') part |= HALF[RIGHT[f]];
  return p.half === 'top' ? 0xf0 | part : 0x0f | (part << 4);
}

export function stateMask(state) {
  const st = parseState(state);
  switch (shapeFamily(st.name)) {
    case 'stairs': return stairMaskFromProps(st.props);
    case 'slab': return st.props.type === 'top' ? 0xf0 : st.props.type === 'double' ? 0xff : 0x0f;
    case 'trapdoor': {
      if (st.props.open === 'true') {
        // open trapdoor stands against the side opposite its facing
        const side = { north: 0b1100, south: 0b0011, east: 0b0101, west: 0b1010 }[st.props.facing || 'north'];
        return side | (side << 4);
      }
      return st.props.half === 'top' ? 0xf0 : 0x0f;
    }
    case 'carpet': return 0x0f;
    case 'air': return 0;
    default: return 0xff;
  }
}

// Colors: exact palette match first, then keywords, then a stable hash.
const KEYWORDS = [
  ['crimson', '#6a344b'], ['warped', '#2b6963'], ['dark_oak', '#432b1a'], ['spruce', '#735532'], ['birch', '#c4b27c'],
  ['jungle', '#a07351'], ['acacia', '#a85a32'], ['mangrove', '#763631'], ['cherry', '#e2b3ac'], ['bamboo', '#c3ad53'],
  ['pale_oak', '#e3dcd8'], ['oak', '#a2834f'], ['deepslate', '#4a4a4d'], ['blackstone', '#2b2429'], ['tuff', '#62675f'],
  ['mossy', '#6f7a63'], ['cobble', '#6b6b6b'], ['andesite', '#888a8a'], ['diorite', '#c8c8c8'], ['granite', '#956755'],
  ['calcite', '#dfe0dc'], ['red_sandstone', '#b5621f'], ['sandstone', '#d8cb9b'], ['mud', '#8a6a50'], ['nether_brick', '#2e161a'],
  ['stone_brick', '#7a7a7a'], ['polished_andesite', '#848687'], ['brick', '#976253'], ['quartz', '#ebe5de'], ['prismarine', '#63a597'], ['purpur', '#a97ea9'], ['end_stone', '#dbe0a2'],
  ['copper', '#bf6b51'], ['iron', '#c9c9c9'], ['gold', '#f2d046'], ['lantern', '#e9b04f'], ['torch', '#ffd36b'],
  ['chain', '#3c4049'], ['glass', '#bfdce6'], ['leaves', '#4f7a2c'], ['azalea', '#5e7f2e'], ['moss', '#596e2d'],
  ['vine', '#3f6b1f'], ['terracotta', '#985f45'], ['hay', '#c6a227'], ['barrel', '#7a5734'], ['bookshelf', '#6b4a2e'],
  ['lamp', '#e2a04a'], ['water', '#3f6fd8'], ['lava', '#e2621c'], ['snow', '#f0f4f5'], ['ice', '#9dbdf2'],
  ['white', '#e9ecec'], ['black', '#1d1d21'], ['red', '#a12722'], ['blue', '#35399d'], ['green', '#546d1b'],
  ['yellow', '#f8c527'], ['orange', '#f07613'], ['purple', '#792aac'], ['cyan', '#158991'], ['pink', '#ed8dac'],
  ['stone', '#7f7f7f'],
];
const colorCache = new Map();
export function stateColor(state) {
  const id = parseState(state).id;
  if (colorCache.has(id)) return colorCache.get(id);
  let c = null;
  for (const b of BLOCKS) if (b.full === id || b.slab === id || b.stairs === id) { c = b.color; break; }
  if (!c) {
    const name = id.split(':')[1];
    const log = /(_log|_wood|_stem|_hyphae)$/.test(name) && !name.startsWith('stripped_');
    for (const [k, col] of KEYWORDS) if (name.includes(k)) { c = col; break; }
    if (c && log) c = shade(c, 0.7);
  }
  if (!c) {
    let h = 0;
    for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    c = `hsl(${h % 360}, 35%, 50%)`;
  }
  colorCache.set(id, c);
  return c;
}

function shade(hex, f) {
  const n = parseInt(hex.slice(1), 16);
  const r = Math.round(((n >> 16) & 255) * f), g = Math.round(((n >> 8) & 255) * f), b = Math.round((n & 255) * f);
  return '#' + ((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1);
}

export function stateLabel(state) {
  const st = parseState(state);
  const nice = st.name.replace(/_/g, ' ');
  const props = Object.entries(st.props).filter(([k]) => k !== 'waterlogged').map(([k, v]) => `${k}=${v}`);
  return props.length ? `${nice} (${props.join(', ')})` : nice;
}
