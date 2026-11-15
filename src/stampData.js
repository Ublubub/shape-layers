// Stamp data helpers with no Three.js / DOM dependency (usable in Node tests).
// A stamp is a block-exact structure. Two storage formats:
//   small:  { id, name, size: [w, h, d], blocks: { "x,y,z": "minecraft:block[props]" }, rev }
//   big:    { id, name, size, dense: { palette: [states], data: base64(Uint16 per cell, 0 = air,
//             n = palette[n-1]) }, rev }        cell index = x + z*w + y*w*d
// Big imports (whole halls, facades) use the dense format so they stay compact and fast.

import { CUSTOM, stairInfo } from './blocks.js';
import { rotateState, stateMask } from './blockstates.js';

export const SMALL_LIMIT = 20000;       // blocks; above this a stamp is stored dense
export const MAX_AXIS = 512;            // largest import per axis
export const MAX_IMPORT_CELLS = 16_000_000;

export function newStamp(name = 'Stamp', size = [3, 6, 3]) {
  return { id: 'st' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), name, size: [...size], blocks: {}, rev: 0 };
}

export const key = (x, y, z) => `${x},${y},${z}`;
export const unkey = (k) => k.split(',').map(Number);
const isAir = (st) => !st || /^minecraft:(air|cave_air|void_air|structure_void)(\[|$)/.test(st);

// ---------------------------------------------------------------- dense format
function u16ToBase64(arr) {
  const bytes = new Uint8Array(arr.buffer, arr.byteOffset, arr.byteLength);
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
function base64ToU16(b64) {
  const s = atob(b64);
  const bytes = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) bytes[i] = s.charCodeAt(i);
  return new Uint16Array(bytes.buffer);
}
export const isDense = (s) => !!(s && s.dense);
function cellsOf(s) {
  if (!s._cells) Object.defineProperty(s, '_cells', { value: base64ToU16(s.dense.data), enumerable: false, writable: true, configurable: true });
  return s._cells;
}

export function blockCount(s) {
  if (!isDense(s)) return Object.keys(s.blocks || {}).length;
  if (s._count === undefined) {
    let n = 0;
    for (const v of cellsOf(s)) if (v) n++;
    Object.defineProperty(s, '_count', { value: n, enumerable: false, writable: true, configurable: true });
  }
  return s._count;
}

/** Call fn(x, y, z, state) for every block of a stamp (both formats). */
export function forEachBlock(s, fn) {
  const [W, , D] = s.size;
  if (isDense(s)) {
    const cells = cellsOf(s), pal = s.dense.palette, WD = W * D;
    for (let i = 0; i < cells.length; i++) {
      const v = cells[i];
      if (!v) continue;
      const y = Math.floor(i / WD), r = i - y * WD, z = Math.floor(r / W);
      fn(r - z * W, y, z, pal[v - 1]);
    }
    return;
  }
  for (const [k, st] of Object.entries(s.blocks || {})) {
    const [x, y, z] = unkey(k);
    fn(x, y, z, st);
  }
}

/**
 * Build a stamp of the given size by calling fill(set), where set(x, y, z, state) places a block.
 * Small results use the editable map format, big ones the dense format.
 */
export function buildStamp(name, size, fill) {
  const [W, H, D] = size;
  if (W > MAX_AXIS || H > MAX_AXIS || D > MAX_AXIS || W * H * D > MAX_IMPORT_CELLS) {
    throw new Error(`Too big: ${W}×${H}×${D}. Select a smaller area (max ${MAX_AXIS} per side, ${(MAX_IMPORT_CELLS / 1e6).toFixed(0)} million cells).`);
  }
  const cells = new Uint16Array(W * H * D);
  const palette = [], pIdx = new Map();
  let count = 0;
  fill((x, y, z, st) => {
    if (isAir(st) || x < 0 || y < 0 || z < 0 || x >= W || y >= H || z >= D) return;
    let p = pIdx.get(st);
    if (p === undefined) {
      if (palette.length >= 65534) return;
      p = palette.length; palette.push(st); pIdx.set(st, p);
    }
    const i = x + z * W + y * W * D;
    if (!cells[i]) count++;
    cells[i] = p + 1;
  });
  const s = newStamp(name, size);
  if (count <= SMALL_LIMIT) {
    const WD = W * D;
    for (let i = 0; i < cells.length; i++) {
      const v = cells[i];
      if (!v) continue;
      const y = Math.floor(i / WD), r = i - y * WD, z = Math.floor(r / W);
      s.blocks[key(r - z * W, y, z)] = palette[v - 1];
    }
    return s;
  }
  delete s.blocks;
  s.dense = { palette, data: u16ToBase64(cells) };
  Object.defineProperty(s, '_cells', { value: cells, enumerable: false, writable: true, configurable: true });
  Object.defineProperty(s, '_count', { value: count, enumerable: false, writable: true, configurable: true });
  return s;
}

// Voxel grid (same layout as the voxelizer output) for drawing a stamp on its own.
export function stampToVoxels(stamp) {
  const [W, H, D] = stamp.size;
  const n = W * H * D;
  const kind = new Uint8Array(n), mat = new Uint8Array(n), meta = new Uint16Array(n);
  if (isDense(stamp)) {
    const cells = cellsOf(stamp);
    for (let i = 0; i < n; i++) if (cells[i]) { kind[i] = CUSTOM; meta[i] = cells[i] - 1; }
    return { W, H, D, kind, mat, meta, custom: [...stamp.dense.palette] };
  }
  const custom = [], idx = new Map();
  forEachBlock(stamp, (x, y, z, st) => {
    if (x < 0 || y < 0 || z < 0 || x >= W || y >= H || z >= D) return;
    let p = idx.get(st);
    if (p === undefined) { p = custom.length; custom.push(st); idx.set(st, p); }
    const i = x + z * W + y * W * D;
    kind[i] = CUSTOM; meta[i] = p;
  });
  return { W, H, D, kind, mat, meta, custom };
}

// Rotate a whole stamp clockwise (seen from above) by quarter turns.
export function rotateStamp(stamp, turns = 1) {
  turns = ((turns % 4) + 4) % 4;
  let s = stamp;
  for (let t = 0; t < turns; t++) {
    const [W, H, D] = s.size;
    const src = s;
    const r = buildStamp(s.name, [D, H, W], (set) => forEachBlock(src, (x, y, z, st) => set(D - 1 - z, y, x, rotateState(st, 1))));
    s = { ...r, id: stamp.id, name: stamp.name, rev: stamp.rev, gen: stamp.gen };
    if (r._cells) { Object.defineProperty(s, '_cells', { value: r._cells, enumerable: false, writable: true, configurable: true }); }
  }
  return s;
}

/** Copy the blocks inside box [x0, y0, z0, x1, y1, z1] (inclusive) into a new stamp. */
export function cropStamp(stamp, box, name) {
  const [x0, y0, z0, x1, y1, z1] = box;
  const size = [x1 - x0 + 1, y1 - y0 + 1, z1 - z0 + 1];
  return buildStamp(name || `${stamp.name} piece`, size, (set) => forEachBlock(stamp, (x, y, z, st) => {
    if (x >= x0 && x <= x1 && y >= y0 && y <= y1 && z >= z0 && z <= z1) set(x - x0, y - y0, z - z0, st);
  }));
}

/**
 * Learn a palette from the blocks in a stamp (optionally inside box). Each block's weight at the
 * bottom and at the top comes from how often it appears in the lower and upper half, so the
 * gradient of a real worn wall is reproduced. fullOnly keeps cube-shaped blocks (good for walls).
 */
export function paletteFromStamp(stamp, box = null, { name = 'From build', fullOnly = true, max = 8 } = {}) {
  const [x0, y0, z0, x1, y1, z1] = box || [0, 0, 0, stamp.size[0] - 1, stamp.size[1] - 1, stamp.size[2] - 1];
  const mid = (y0 + y1) / 2;
  const lo = new Map(), hi = new Map();
  let nLo = 0, nHi = 0;
  const maskCache = new Map();
  forEachBlock(stamp, (x, y, z, st) => {
    if (x < x0 || x > x1 || y < y0 || y > y1 || z < z0 || z > z1) return;
    if (fullOnly) {
      let m = maskCache.get(st);
      if (m === undefined) { m = stateMask(st); maskCache.set(st, m); }
      if (m !== 0xff) return;
    }
    if (y <= mid) { lo.set(st, (lo.get(st) || 0) + 1); nLo++; }
    if (y >= mid) { hi.set(st, (hi.get(st) || 0) + 1); nHi++; }
  });
  const states = [...new Set([...lo.keys(), ...hi.keys()])]
    .map((st) => ({ st, total: (lo.get(st) || 0) + (hi.get(st) || 0) }))
    .sort((a, b) => b.total - a.total).slice(0, max);
  return {
    id: 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
    name,
    entries: states.map(({ st }) => ({
      state: st,
      top: nHi ? Math.round(((hi.get(st) || 0) / nHi) * 100) : 0,
      bottom: nLo ? Math.round(((lo.get(st) || 0) / nLo) * 100) : 0,
    })),
  };
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
  const rot = new Map(); // state -> palette index after rotation (cached: big stamps reuse few states)
  forEachBlock(stamp, (x, y, z, st) => {
    const [wx, wy, wz] = placement.toWorld(x + 0.5, y + 0.5, z + 0.5);
    const cx = Math.floor((wx - grid.origin[0]) / grid.cell[0]);
    const cy = Math.floor((wy - grid.origin[1]) / grid.cell[1]);
    const cz = Math.floor((wz - grid.origin[2]) / grid.cell[2]);
    if (cx < 0 || cy < 0 || cz < 0 || cx >= W || cy >= H || cz >= D) return;
    let p = rot.get(st);
    if (p === undefined) { p = palette(rotateState(st, placement.turns)); rot.set(st, p); }
    out.push(cx + cz * W + cy * W * D, p);
  });
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

// ---------------------------------------------------------------- import (.schem / .litematic / .nbt)
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
      case 12: { // long arrays keep full 64-bit precision (Litematica packs block data into them)
        const n = view.getInt32(o); o += 4;
        const a = new BigInt64Array(n);
        for (let i = 0; i < n; i++) { a[i] = view.getBigInt64(o); o += 8; }
        return a;
      }
      default: throw new Error('Unknown NBT tag ' + t);
    }
  };
  const type = view.getUint8(o); o += 1;
  const name = str();
  return { name, value: payload(type) };
}

const stateOf = (p) => {
  const props = p.Properties ? Object.entries(p.Properties).map(([k, v]) => `${k}=${v}`).sort().join(',') : '';
  return props ? `${p.Name}[${props}]` : p.Name;
};

// Litematica packs palette indices tightly across 64-bit longs (values may span two longs).
function litematicaCells(longs, bits, count, fn) {
  const words = new Uint32Array(longs.buffer, longs.byteOffset, longs.length * 2); // [lo, hi] per long (little-endian hosts)
  const mask = bits >= 32 ? 0xffffffff : (1 << bits) - 1;
  for (let i = 0; i < count; i++) {
    const bit = i * bits, w = bit >>> 5, off = bit & 31;
    let v = words[w] >>> off;
    if (off + bits > 32) v |= words[w + 1] << (32 - off);
    fn(i, (v & mask) >>> 0);
  }
}

// Parse an (already decompressed) Sponge .schem (v2/v3), Litematica .litematic or vanilla
// structure .nbt into a stamp.
export function stampFromNBT(nbt, name = 'Imported') {
  let r = nbt.value;
  // Litematica: one or more regions, each with its own palette and packed block data
  if (r.Regions && typeof r.Regions === 'object') {
    const regions = Object.values(r.Regions).map((g) => {
      const pos = [g.Position.x, g.Position.y, g.Position.z];
      const sz = [g.Size.x, g.Size.y, g.Size.z];
      const min = pos.map((p, i) => (sz[i] < 0 ? p + sz[i] + 1 : p));
      return { g, min, abs: sz.map(Math.abs) };
    });
    const lo = [0, 1, 2].map((i) => Math.min(...regions.map((q) => q.min[i])));
    const hi = [0, 1, 2].map((i) => Math.max(...regions.map((q) => q.min[i] + q.abs[i])));
    const size = hi.map((h, i) => h - lo[i]);
    return buildStamp(name, size, (set) => {
      for (const { g, min, abs } of regions) {
        const pal = (g.BlockStatePalette || []).map(stateOf);
        const bits = Math.max(2, 32 - Math.clz32(Math.max(1, pal.length - 1)));
        const [sx, sy, sz] = abs, layer = sx * sz;
        const off = min.map((m, i) => m - lo[i]);
        litematicaCells(g.BlockStates, bits, sx * sy * sz, (i, v) => {
          const st = pal[v];
          if (!st) return;
          const y = Math.floor(i / layer), rem = i - y * layer, z = Math.floor(rem / sx), x = rem - z * sx;
          set(x + off[0], y + off[1], z + off[2], st);
        });
      }
    });
  }
  if (r.Schematic) r = r.Schematic;
  // vanilla structure block file
  if (Array.isArray(r.size) && Array.isArray(r.palette) && Array.isArray(r.blocks)) {
    const pal = r.palette.map(stateOf);
    return buildStamp(name, r.size, (set) => { for (const bl of r.blocks) set(bl.pos[0], bl.pos[1], bl.pos[2], pal[bl.state]); });
  }
  // Sponge schematic v2 / v3
  const W = r.Width & 0xffff, H = r.Height & 0xffff, L = r.Length & 0xffff;
  const palette = r.Palette || (r.Blocks && r.Blocks.Palette);
  const data = r.BlockData || (r.Blocks && r.Blocks.Data);
  if (!palette || !data || !W) throw new Error('Not a schematic this tool understands (.schem, .litematic or structure .nbt)');
  const byId = [];
  for (const [st, id] of Object.entries(palette)) byId[id] = st;
  return buildStamp(name, [W, H, L], (set) => {
    let i = 0, o = 0;
    const total = W * H * L;
    while (o < data.length && i < total) {
      let v = 0, shift = 0, b;
      do { b = data[o++]; v |= (b & 0x7f) << shift; shift += 7; } while (b & 0x80);
      const x = i % W, z = Math.floor(i / W) % L, y = Math.floor(i / (W * L));
      set(x, y, z, byId[v]);
      i++;
    }
  });
}

export async function stampFromFile(file) {
  let bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes[0] === 0x1f && bytes[1] === 0x8b) {
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
    bytes = new Uint8Array(await new Response(stream).arrayBuffer());
  }
  return stampFromNBT(readNBT(bytes), file.name.replace(/\.(schem|schematic|nbt|litematic)$/i, ''));
}
