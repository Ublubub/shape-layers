// Pure voxelizer: no Three.js dependency so it can run in a Web Worker or Node.
//
// Every shape is a "unit primitive" living in the cube [-0.5, 0.5]^3 of its own
// local space. To test a world point we multiply it by the shape's inverse world
// matrix and run a cheap inside/outside test. Stretching, rotating and moving a
// shape is therefore free: it is all in the matrix.
//
// Each block cell is split into 8 octants (2 x 2 x 2). We sample points in each
// octant and decide which octants are "solid". The pattern picks the block:
//   all 8                         -> full block
//   bottom 4                      -> bottom slab        top 4 -> top slab
//   bottom 4 + 1..3 of the top    -> stair (straight / outer / inner corner)
//   top 4 + 1..3 of the bottom    -> upside-down stair
// anything else falls back to comparing the lower and upper halves.

import { AIR, FULL, BOTTOM, TOP, STAIR, CUSTOM } from './blocks.js';

// Shape tests. `p` holds per-shape parameters, including the absolute scale
// (sx, sy, sz) so that thickness can be given in world units (blocks).
// Hollow shapes are split into an `outer` solid and a `cavity`: the shape is
// outer AND NOT cavity. Keeping them apart lets roofs that "join" merge properly:
// (union of outers) minus (union of cavities) -> groin vaults, T-junctions, etc.
export function makeParts(type, p = {}) {
  const sx = p.sx || 1, sy = p.sy || 1, sz = p.sz || 1;
  const t = Math.max(0, p.thickness || 0);
  switch (type) {
    case 'box': return { outer: (x, y, z) => x >= -0.5 && x <= 0.5 && y >= -0.5 && y <= 0.5 && z >= -0.5 && z <= 0.5 };
    case 'sphere': {
      const outer = (x, y, z) => x * x + y * y + z * z <= 0.25;
      const ix = 0.5 - t / sx, iy = 0.5 - t / sy, iz = 0.5 - t / sz;
      if (!(t > 0 && ix > 0 && iy > 0 && iz > 0)) return { outer };
      return { outer, cavity: (x, y, z) => (x / ix) ** 2 + (y / iy) ** 2 + (z / iz) ** 2 < 1 };
    }
    case 'cylinder': return { outer: (x, y, z) => y >= -0.5 && y <= 0.5 && x * x + z * z <= 0.25 };
    case 'tube': {
      const ix = 0.5 - (t || 0.2 * sx) / sx, iz = 0.5 - (t || 0.2 * sz) / sz;
      const outer = (x, y, z) => y >= -0.5 && y <= 0.5 && x * x + z * z <= 0.25;
      if (!(ix > 0 && iz > 0)) return { outer };
      return { outer, cavity: (x, y, z) => y >= -0.5 && y <= 0.5 && (x / ix) ** 2 + (z / iz) ** 2 < 1 };
    }
    case 'cone': return { outer: (x, y, z) => {
      if (y < -0.5 || y > 0.5) return false;
      const r = (0.5 - y) * 0.5;
      return x * x + z * z <= r * r;
    } };
    case 'pyramid': return { outer: (x, y, z) => {
      if (y < -0.5 || y > 0.5) return false;
      const h = (0.5 - y) * 0.5;
      return x >= -h && x <= h && z >= -h && z <= h;
    } };
    case 'dome': {
      // ellipsoid cap: radius 0.5 horizontally, height 1, base at y = -0.5
      const outer = (x, y, z) => {
        if (y < -0.5 || y > 0.5) return false;
        const dy = y + 0.5;
        return 4 * x * x + dy * dy + 4 * z * z <= 1;
      };
      const ix = 0.5 - t / sx, iy = 1 - t / sy, iz = 0.5 - t / sz;
      if (!(t > 0 && ix > 0 && iy > 0 && iz > 0)) return { outer };
      return { outer, cavity: (x, y, z) => y >= -0.5 && (x / ix) ** 2 + ((y + 0.5) / iy) ** 2 + (z / iz) ** 2 < 1 };
    }
    case 'torus': return { outer: (x, y, z) => {
      const q = Math.sqrt(x * x + z * z) - 0.35;
      return q * q + y * y <= 0.0225;
    } };
    case 'wedge': return { outer: (x, y, z) => z >= -0.5 && z <= 0.5 && x >= -0.5 && y >= -0.5 && x + y <= 0 };
    case 'vault': {
      const v = vaultProfile(p);
      const outer = (x, y, z) => {
        if (z < -0.5 || z > 0.5 || y < -0.5 || y > 0.5) return false;
        return (Math.abs(x) / v.a) ** v.n + (Math.abs(y - v.yc) / v.b) ** v.n <= 1;
      };
      if (!v.hollow) return { outer };
      // the cavity runs the full length (open ends) and stops at the base
      return { outer, cavity: (x, y, z) => z >= -0.5 && z <= 0.5 && y >= -0.5 &&
        (Math.abs(x) / v.ai) ** v.n + (Math.abs(y - v.yc) / v.bi) ** v.n < 1 };
    }
    default: return null;
  }
}

export function makeTest(type, p = {}) {
  const parts = makeParts(type, p);
  if (!parts) return null;
  const { outer, cavity } = parts;
  return cavity ? (x, y, z) => outer(x, y, z) && !cavity(x, y, z) : outer;
}

// Barrel vault profile in unit space (span x in [-0.5, 0.5], base y = -0.5, crown y = 0.5).
// A super-ellipse |x/a|^n + |(y-yc)/b|^n = 1. `roundness` is n (2 = elliptical,
// higher = boxier, lower = pointier). `flatten` (0..0.9) sinks the curve's center
// below the base, giving a segmental arch that meets its supports at an angle.
export function vaultProfile(p = {}) {
  const n = Math.min(8, Math.max(1, p.roundness || 2));
  const d = Math.min(0.9, Math.max(0, p.flatten || 0));
  const b = 1 / (1 - d); // crown at y = 0.5, base sits d*b above the curve's center
  const yc = 0.5 - b;
  const a = 0.5 / Math.pow(1 - Math.pow(d, n), 1 / n);
  const t = Math.max(0, p.thickness || 0);
  const ai = a - t / (p.sx || 1), bi = b - t / (p.sy || 1);
  return { n, d, a, b, yc, ai, bi, hollow: t > 0 && ai > 0 && bi > 0 };
}

export const QUALITY = { fast: 1, normal: 2, high: 3 }; // samples per octant per axis

// octant bit = ox + 2*oz + 4*oy   (ox: +x/east, oz: +z/south, oy: top)
const LOW = 0x0f, HIGH = 0xf0;
const popcount4 = (m) => (m & 1) + ((m >> 1) & 1) + ((m >> 2) & 1) + ((m >> 3) & 1);
const diagonal = (m) => m === 0b1001 || m === 0b0110;

/**
 * job = {
 *   dims: [W, H, D], origin: [x, y, z], cell: [cx, cy, cz],
 *   shapes: [{ type, add, mat, inv: Float[16] (column-major), aabb: [6], params }],
 *   options: { slabs, topSlabs, stairs, stairCorners, threshold, quality, hollow, materialCount, stairMats: bool[] }
 * }
 * returns { W, H, D, kind, mat, meta }   index = x + z*W + y*W*D ; meta = octant mask for stairs
 */
export function voxelize(job, onProgress) {
  const [W, H, D] = job.dims;
  const [ox, oy, oz] = job.origin;
  const [cx, cy, cz] = job.cell;
  const opt = job.options;
  const q = QUALITY[opt.quality] || 2;
  const perOct = q * q * q;
  const need = opt.threshold * perOct;

  // Joined shapes (roofs) use their outer solid; their cavities are applied after all
  // shapes, and only carve material owned by joined shapes.
  const shapes = job.shapes.map((s) => {
    const parts = makeParts(s.type, s.params);
    if (!parts) return null;
    const joined = !!(s.join && s.add);
    return { ...s, joined, test: joined ? parts.outer : makeTest(s.type, s.params), cavity: joined ? parts.cavity || null : null };
  }).filter(Boolean);
  const total = W * H * D;
  const kind = new Uint8Array(total);
  const mat = new Uint8Array(total);
  const meta = new Uint8Array(total);
  const counts = new Float64Array(Math.max(1, opt.materialCount));
  const oct = new Int32Array(8);

  // sample fractions along one axis, per octant half
  const fr = [[], []];
  for (let h = 0; h < 2; h++) for (let a = 0; a < q; a++) fr[h].push(h * 0.5 + ((a + 0.5) / q) * 0.5);

  const rowShapes = [], active = [], usedMats = [];

  for (let j = 0; j < H; j++) {
    const y0 = oy + j * cy, y1 = y0 + cy;
    rowShapes.length = 0;
    let anyAdd = false;
    for (const s of shapes) if (s.aabb[1] <= y1 && s.aabb[4] >= y0) { rowShapes.push(s); if (s.add) anyAdd = true; }
    if (anyAdd) {
      for (let k = 0; k < D; k++) {
        const z0 = oz + k * cz, z1 = z0 + cz;
        for (let i = 0; i < W; i++) {
          const x0 = ox + i * cx, x1 = x0 + cx;
          active.length = 0;
          let hasAdd = false;
          for (const s of rowShapes) {
            const b = s.aabb;
            if (b[0] <= x1 && b[3] >= x0 && b[2] <= z1 && b[5] >= z0) { active.push(s); if (s.add) hasAdd = true; }
          }
          if (!hasAdd) continue;

          usedMats.length = 0;
          for (const s of active) if (s.add) { counts[s.mat] = 0; usedMats.push(s.mat); }
          oct.fill(0);

          for (let hy = 0; hy < 2; hy++) for (let hz = 0; hz < 2; hz++) for (let hx = 0; hx < 2; hx++) {
            const bit = hx + 2 * hz + 4 * hy;
            for (const fy of fr[hy]) {
              const py = y0 + fy * cy;
              for (const fz of fr[hz]) {
                const pz = z0 + fz * cz;
                for (const fx of fr[hx]) {
                  const px = x0 + fx * cx;
                  let occ = false, owner = 0, ownerJoined = false, inCavity = false;
                  for (let n = 0; n < active.length; n++) {
                    const s = active[n], m = s.inv;
                    const lx = m[0] * px + m[4] * py + m[8] * pz + m[12];
                    const ly = m[1] * px + m[5] * py + m[9] * pz + m[13];
                    const lz = m[2] * px + m[6] * py + m[10] * pz + m[14];
                    if (s.test(lx, ly, lz)) {
                      if (s.add) { occ = true; owner = s.mat; ownerJoined = s.joined; } else occ = false;
                    }
                    if (s.cavity && !inCavity && s.cavity(lx, ly, lz)) inCavity = true;
                  }
                  if (occ && ownerJoined && inCavity) occ = false;
                  if (occ) { oct[bit]++; counts[owner]++; }
                }
              }
            }
          }

          let best = usedMats[0], bc = -1;
          for (const mi of usedMats) if (counts[mi] > bc) { bc = counts[mi]; best = mi; }

          let mask = 0;
          for (let b = 0; b < 8; b++) if (oct[b] >= need) mask |= 1 << b;
          const lo = oct[0] + oct[1] + oct[2] + oct[3], hi = oct[4] + oct[5] + oct[6] + oct[7];
          const kd = decide(mask, lo, hi, need * 4, opt, !opt.stairMats || opt.stairMats[best]);

          if (kd !== AIR) {
            const idx = i + k * W + j * W * D;
            kind[idx] = kd;
            mat[idx] = best;
            if (kd === STAIR) meta[idx] = mask;
          }
        }
      }
    }
    if (onProgress && (j & 3) === 0) onProgress((j + 1) / H);
  }

  if (opt.hollow) hollowOut(kind, W, H, D);
  // stamps: exact blocks pasted on top of everything ([cellIndex, paletteIndex] pairs)
  const custom = job.custom || [];
  const cells = job.stampCells || [];
  for (let n = 0; n + 1 < cells.length; n += 2) {
    const idx = cells[n];
    if (idx < 0 || idx >= total) continue;
    kind[idx] = CUSTOM; meta[idx] = cells[n + 1]; mat[idx] = 0;
  }
  return { W, H, D, kind, mat, meta, custom };
}

function decide(mask, lo, hi, needHalf, opt, canStair) {
  if (mask === 0xff) return FULL;
  const low = mask & LOW, high = (mask & HIGH) >> 4;
  if (opt.stairs && canStair) {
    if (low === 0xf) {
      const c = popcount4(high);
      if (c === 2 && !diagonal(high)) return STAIR;
      if ((c === 1 || c === 3) && opt.stairCorners) return STAIR;
    }
    if (high === 0xf && opt.topSlabs) {
      const c = popcount4(low);
      if (c === 2 && !diagonal(low)) return STAIR;
      if ((c === 1 || c === 3) && opt.stairCorners) return STAIR;
    }
  }
  if (opt.slabs) {
    const L = lo >= needHalf, U = hi >= needHalf;
    if (L && U) return FULL;
    if (L) return BOTTOM;
    if (U && opt.topSlabs) return TOP;
  }
  return lo + hi >= needHalf * 2 ? FULL : AIR;
}

// Remove full blocks that are completely enclosed by other full blocks.
export function hollowOut(kind, W, H, D) {
  const src = kind.slice();
  const WD = W * D;
  for (let y = 1; y < H - 1; y++)
    for (let z = 1; z < D - 1; z++)
      for (let x = 1; x < W - 1; x++) {
        const i = x + z * W + y * WD;
        if (src[i] !== FULL) continue;
        if (src[i - 1] === FULL && src[i + 1] === FULL && src[i - W] === FULL && src[i + W] === FULL &&
            src[i - WD] === FULL && src[i + WD] === FULL) kind[i] = AIR;
      }
}

export function summarize(v, materialCount) {
  const perMat = Array.from({ length: materialCount }, () => ({ full: 0, slab: 0, stair: 0 }));
  const perCustom = new Map(); // block id -> count
  const perLayer = [];
  const WD = v.W * v.D;
  let full = 0, slab = 0, stair = 0, custom = 0;
  for (let y = 0; y < v.H; y++) {
    let lf = 0, ls = 0, lt = 0, lc = 0;
    for (let i = y * WD, e = i + WD; i < e; i++) {
      const k = v.kind[i];
      if (!k) continue;
      if (k === CUSTOM) {
        lc++;
        const id = String(v.custom[v.meta[i]]).split('[')[0];
        perCustom.set(id, (perCustom.get(id) || 0) + 1);
        continue;
      }
      const m = perMat[v.mat[i]];
      if (k === FULL) { lf++; m.full++; } else if (k === STAIR) { lt++; m.stair++; } else { ls++; m.slab++; }
    }
    perLayer.push({ full: lf, slab: ls, stair: lt, custom: lc });
    full += lf; slab += ls; stair += lt; custom += lc;
  }
  return { full, slab, stair, custom, perMat, perCustom, perLayer };
}
