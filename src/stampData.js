// Stamp data helpers with no Three.js / DOM dependency (usable in Node tests).
// A stamp is a small block-exact structure:
//   { id, name, size: [w, h, d], blocks: { "x,y,z": "minecraft:block[props]" }, rev }

import { CUSTOM, stairInfo } from './blocks.js';
import { rotateState } from './blockstates.js';

export function newStamp(name = 'Stamp', size = [3, 6, 3]) {
  return { id: 'st' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), name, size: [...size], blocks: {}, rev: 0 };
}

export const key = (x, y, z) => `${x},${y},${z}`;
export const unkey = (k) => k.split(',').map(Number);

// Voxel grid (same layout as the voxelizer output) for drawing a stamp on its own.
export function stampToVoxels(stamp) {
  const [W, H, D] = stamp.size;
  const n = W * H * D;
  const kind = new Uint8Array(n), mat = new Uint8Array(n), meta = new Uint8Array(n);
  const custom = [], idx = new Map();
  for (const [k, st] of Object.entries(stamp.blocks)) {
    const [x, y, z] = unkey(k);
    if (x < 0 || y < 0 || z < 0 || x >= W || y >= H || z >= D) continue;
    let p = idx.get(st);
    if (p === undefined) { p = custom.length; custom.push(st); idx.set(st, p); }
    const i = x + z * W + y * W * D;
    kind[i] = CUSTOM; meta[i] = p;
  }
  return { W, H, D, kind, mat, meta, custom };
}

// Rotate a whole stamp clockwise (seen from above) by quarter turns.
export function rotateStamp(stamp, turns = 1) {
  turns = ((turns % 4) + 4) % 4;
  let s = stamp;
  for (let t = 0; t < turns; t++) {
    const [W, H, D] = s.size;
    const blocks = {};
    for (const [k, st] of Object.entries(s.blocks)) {
      const [x, y, z] = unkey(k);
      blocks[key(D - 1 - z, y, x)] = rotateState(st, 1);
    }
    s = { ...s, size: [D, H, W], blocks };
  }
  return s;
}

/**
 * Cells to paste for one stamp placement.
 * placement = { toWorld(lx, ly, lz) -> [x, y, z], turns }   (local coords in blocks, stamp min corner = 0)
 * grid = { origin: [x,y,z], cell: [cx,cy,cz], dims: [W,H,D] }
 * palette(state) -> index into the custom palette
 * Returns a flat array [cellIndex, paletteIndex, ...].
 */
export function stampCells(stamp, placement, grid, palette) {
  const out = [];
  const [W, H, D] = grid.dims;
  for (const [k, st] of Object.entries(stamp.blocks)) {
    const [x, y, z] = unkey(k);
    const [wx, wy, wz] = placement.toWorld(x + 0.5, y + 0.5, z + 0.5);
    const cx = Math.floor((wx - grid.origin[0]) / grid.cell[0]);
    const cy = Math.floor((wy - grid.origin[1]) / grid.cell[1]);
    const cz = Math.floor((wz - grid.origin[2]) / grid.cell[2]);
    if (cx < 0 || cy < 0 || cz < 0 || cx >= W || cy >= H || cz >= D) continue;
    out.push(cx + cz * W + cy * W * D, palette(rotateState(st, placement.turns)));
  }
  return out;
}

// Stair state whose tall part points at the given quarters (bits: 0 NW, 1 NE, 2 SW, 3 SE).
export function stairState(block, part, upsideDown = false) {
  const mask = upsideDown ? 0xf0 | part : 0x0f | (part << 4);
  const s = stairInfo(mask);
  return `minecraft:${block}[facing=${s.facing},half=${s.half},shape=${s.shape}]`;
}

/**
 * Starter pillar: 1-wide log column, stair ring at the base (tall side toward the column),
 * trapdoor bands, an upside-down stair capital and a plank cap. 3 wide, `h` tall.
 */
export function pillarTemplate(h = 9, wood = 'spruce') {
  const s = newStamp(`${wood[0].toUpperCase() + wood.slice(1)} pillar`, [3, h, 3]);
  const b = s.blocks;
  const ring = [];
  for (let dz = 0; dz < 3; dz++) for (let dx = 0; dx < 3; dx++) if (dx !== 1 || dz !== 1) ring.push([dx, dz]);
  // quarters of a ring cell that face the column
  const towardCenter = (dx, dz) => {
    const xs = dx === 0 ? [1] : dx === 2 ? [0] : [0, 1];
    const zs = dz === 0 ? [1] : dz === 2 ? [0] : [0, 1];
    let part = 0;
    for (const qx of xs) for (const qz of zs) part |= 1 << (qx + 2 * qz);
    return part;
  };
  for (let y = 0; y < h - 1; y++) b[key(1, y, 1)] = `minecraft:stripped_${wood}_log[axis=y]`;
  for (const [dx, dz] of ring) b[key(dx, 0, dz)] = stairState(`${wood}_stairs`, towardCenter(dx, dz));
  // open trapdoors standing against the column on the 4 sides
  const sides = [[1, 0, 'north'], [1, 2, 'south'], [0, 1, 'west'], [2, 1, 'east']];
  for (const y of [1, 2, h - 3]) {
    if (y <= 0 || y >= h - 2) continue;
    for (const [dx, dz, f] of sides) b[key(dx, y, dz)] = `minecraft:${wood}_trapdoor[facing=${f},half=${y === h - 3 ? 'top' : 'bottom'},open=true]`;
  }
  for (const [dx, dz] of ring) b[key(dx, h - 2, dz)] = stairState(`${wood}_stairs`, towardCenter(dx, dz), true);
  for (let dz = 0; dz < 3; dz++) for (let dx = 0; dx < 3; dx++) b[key(dx, h - 1, dz)] = `minecraft:${wood}_planks`;
  return s;
}

// ---------------------------------------------------------------- import (.schem / .nbt)
export function readNBT(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const dec = new TextDecoder();
  let o = 0;
  const str = () => { const n = view.getUint16(o); o += 2; const s = dec.decode(bytes.subarray(o, o + n)); o += n; return s; };
  const payload = (t) => {
    switch (t) {
      case 1: { const v = view.getInt8(o); o += 1; return v; }
      case 2: { const v = view.getInt16(o); o += 2; return v; }
      case 3: { const v = view.getInt32(o); o += 4; return v; }
      case 4: { const v = view.getBigInt64(o); o += 8; return Number(v); }
      case 5: { const v = view.getFloat32(o); o += 4; return v; }
      case 6: { const v = view.getFloat64(o); o += 8; return v; }
      case 7: { const n = view.getInt32(o); o += 4; const v = bytes.slice(o, o + n); o += n; return v; }
      case 8: return str();
      case 9: { const et = view.getUint8(o); o += 1; const n = view.getInt32(o); o += 4; const a = []; for (let i = 0; i < n; i++) a.push(payload(et)); return a; }
      case 10: { const r = {}; for (;;) { const tt = view.getUint8(o); o += 1; if (!tt) return r; const name = str(); r[name] = payload(tt); } }
      case 11: { const n = view.getInt32(o); o += 4; const a = new Int32Array(n); for (let i = 0; i < n; i++) { a[i] = view.getInt32(o); o += 4; } return a; }
      case 12: { const n = view.getInt32(o); o += 4; const a = []; for (let i = 0; i < n; i++) { a.push(Number(view.getBigInt64(o))); o += 8; } return a; }
      default: throw new Error('Unknown NBT tag ' + t);
    }
  };
  const type = view.getUint8(o); o += 1;
  const name = str();
  return { name, value: payload(type) };
}

const MAX_STAMP = 64;
const isAir = (st) => /^minecraft:(air|cave_air|void_air|structure_void)(\[|$)/.test(st);

// Parse an (already decompressed) Sponge .schem (v2/v3) or vanilla structure .nbt into a stamp.
export function stampFromNBT(nbt, name = 'Imported') {
  let r = nbt.value;
  if (r.Schematic) r = r.Schematic;
  // vanilla structure block file
  if (Array.isArray(r.size) && Array.isArray(r.palette) && Array.isArray(r.blocks)) {
    const [w, h, d] = r.size;
    if (w > MAX_STAMP || h > MAX_STAMP || d > MAX_STAMP) throw new Error(`Too big for a stamp (${w}×${h}×${d}, max ${MAX_STAMP})`);
    const pal = r.palette.map((p) => {
      const props = p.Properties ? Object.entries(p.Properties).map(([k, v]) => `${k}=${v}`).join(',') : '';
      return props ? `${p.Name}[${props}]` : p.Name;
    });
    const s = newStamp(name, [w, h, d]);
    for (const bl of r.blocks) {
      const st = pal[bl.state];
      if (!st || isAir(st)) continue;
      s.blocks[key(bl.pos[0], bl.pos[1], bl.pos[2])] = st;
    }
    return s;
  }
  const W = r.Width & 0xffff, H = r.Height & 0xffff, L = r.Length & 0xffff;
  const palette = r.Palette || (r.Blocks && r.Blocks.Palette);
  const data = r.BlockData || (r.Blocks && r.Blocks.Data);
  if (!palette || !data || !W) throw new Error('Not a schematic this tool understands (.schem v2/v3 or structure .nbt)');
  if (W > MAX_STAMP || H > MAX_STAMP || L > MAX_STAMP) throw new Error(`Too big for a stamp (${W}×${H}×${L}, max ${MAX_STAMP})`);
  const byId = [];
  for (const [st, id] of Object.entries(palette)) byId[id] = st;
  const s = newStamp(name, [W, H, L]);
  let i = 0, o = 0;
  while (o < data.length && i < W * H * L) {
    let v = 0, shift = 0, b;
    do { b = data[o++]; v |= (b & 0x7f) << shift; shift += 7; } while (b & 0x80);
    const st = byId[v];
    if (st && !isAir(st)) {
      const x = i % W, z = Math.floor(i / W) % L, y = Math.floor(i / (W * L));
      s.blocks[key(x, y, z)] = st;
    }
    i++;
  }
  return s;
}

export async function stampFromFile(file) {
  let bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes[0] === 0x1f && bytes[1] === 0x8b) {
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
    bytes = new Uint8Array(await new Response(stream).arrayBuffer());
  }
  return stampFromNBT(readNBT(bytes), file.name.replace(/\.(schem|schematic|nbt)$/i, ''));
}
