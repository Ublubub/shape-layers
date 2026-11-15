// Pure voxelizer: no Three.js dependency so it can run in a Web Worker or Node.
//
// Every shape is a "unit primitive" living in the cube [-0.5, 0.5]^3 of its own
// local space. To test a world point we multiply it by the shape's inverse world
// matrix and run a cheap inside/outside test. Stretching, rotating and moving a
// shape is therefore free: it is all in the matrix.
//
// Each block cell is split into a lower and an upper half. We sample points in
// each half and measure how much of it is "solid":
//   both halves solid  -> full block
//   only lower half    -> bottom slab
//   only upper half    -> top slab
// This is what lets curves (domes, spheres, ramps) get smoothed with slabs.

import { AIR, FULL, BOTTOM, TOP } from './blocks.js';

export const INSIDE = {
  box: (x, y, z) => x >= -0.5 && x <= 0.5 && y >= -0.5 && y <= 0.5 && z >= -0.5 && z <= 0.5,
  sphere: (x, y, z) => x * x + y * y + z * z <= 0.25,
  cylinder: (x, y, z) => y >= -0.5 && y <= 0.5 && x * x + z * z <= 0.25,
  cone: (x, y, z) => {
    if (y < -0.5 || y > 0.5) return false;
    const r = (0.5 - y) * 0.5;
    return x * x + z * z <= r * r;
  },
  pyramid: (x, y, z) => {
    if (y < -0.5 || y > 0.5) return false;
    const h = (0.5 - y) * 0.5;
    return x >= -h && x <= h && z >= -h && z <= h;
  },
  dome: (x, y, z) => {
    if (y < -0.5 || y > 0.5) return false;
    const dy = y + 0.5;
    return 4 * x * x + dy * dy + 4 * z * z <= 1;
  },
  torus: (x, y, z) => {
    const q = Math.sqrt(x * x + z * z) - 0.35;
    return q * q + y * y <= 0.0225; // minor radius 0.15
  },
  wedge: (x, y, z) => z >= -0.5 && z <= 0.5 && x >= -0.5 && y >= -0.5 && x + y <= 0,
  tube: (x, y, z) => {
    if (y < -0.5 || y > 0.5) return false;
    const d = x * x + z * z;
    return d <= 0.25 && d >= 0.09; // inner radius 0.3
  },
};

export const QUALITY = {
  fast: { xz: 2, y: 1 },
  normal: { xz: 3, y: 2 },
  high: { xz: 4, y: 3 },
};

/**
 * job = {
 *   dims: [W, H, D], origin: [x, y, z], cell: [cx, cy, cz],
 *   shapes: [{ type, add: bool, mat: int, inv: Float[16] (column-major), aabb: [minx,miny,minz,maxx,maxy,maxz] }],
 *   options: { slabs, topSlabs, threshold, quality, hollow, materialCount }
 * }
 * returns { W, H, D, kind: Uint8Array, mat: Uint8Array }   index = x + z*W + y*W*D
 */
export function voxelize(job, onProgress) {
  const [W, H, D] = job.dims;
  const [ox, oy, oz] = job.origin;
  const [cx, cy, cz] = job.cell;
  const opt = job.options;
  const q = QUALITY[opt.quality] || QUALITY.normal;
  const S = q.xz, SY = q.y;
  const perHalf = S * S * SY;
  const need = opt.threshold * perHalf;

  const shapes = job.shapes.map((s) => ({ ...s, test: INSIDE[s.type] })).filter((s) => s.test);
  const total = W * H * D;
  const kind = new Uint8Array(total);
  const mat = new Uint8Array(total);
  const counts = new Float64Array(Math.max(1, opt.materialCount));

  // sample offsets inside a cell (fractions)
  const fxz = [];
  for (let a = 0; a < S; a++) fxz.push((a + 0.5) / S);
  const fyLo = [], fyHi = [];
  for (let b = 0; b < SY; b++) {
    fyLo.push(((b + 0.5) / SY) * 0.5);
    fyHi.push(0.5 + ((b + 0.5) / SY) * 0.5);
  }

  const rowShapes = [];
  const active = [];
  const usedMats = [];

  for (let j = 0; j < H; j++) {
    const y0 = oy + j * cy, y1 = y0 + cy;
    rowShapes.length = 0;
    let anyAdd = false;
    for (const s of shapes) {
      if (s.aabb[1] <= y1 && s.aabb[4] >= y0) { rowShapes.push(s); if (s.add) anyAdd = true; }
    }
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

          let lo = 0, hi = 0;
          for (let half = 0; half < 2; half++) {
            const fys = half === 0 ? fyLo : fyHi;
            for (let b = 0; b < SY; b++) {
              const py = y0 + fys[b] * cy;
              for (let a = 0; a < S; a++) {
                const px = x0 + fxz[a] * cx;
                for (let c = 0; c < S; c++) {
                  const pz = z0 + fxz[c] * cz;
                  let occ = false, owner = 0;
                  for (let n = 0; n < active.length; n++) {
                    const s = active[n], m = s.inv;
                    const lx = m[0] * px + m[4] * py + m[8] * pz + m[12];
                    const ly = m[1] * px + m[5] * py + m[9] * pz + m[13];
                    const lz = m[2] * px + m[6] * py + m[10] * pz + m[14];
                    if (s.test(lx, ly, lz)) {
                      if (s.add) { occ = true; owner = s.mat; } else occ = false;
                    }
                  }
                  if (occ) {
                    if (half === 0) lo++; else hi++;
                    counts[owner]++;
                  }
                }
              }
            }
          }

          let kd = AIR;
          if (opt.slabs) {
            const L = lo >= need, U = hi >= need;
            if (L && U) kd = FULL;
            else if (L) kd = BOTTOM;
            else if (U && opt.topSlabs) kd = TOP;
            else if (lo + hi >= need * 2) kd = FULL;
          } else if (lo + hi >= need * 2) kd = FULL;

          if (kd !== AIR) {
            const idx = i + k * W + j * W * D;
            kind[idx] = kd;
            let best = usedMats[0], bc = -1;
            for (const mi of usedMats) if (counts[mi] > bc) { bc = counts[mi]; best = mi; }
            mat[idx] = best;
          }
        }
      }
    }
    if (onProgress && (j & 3) === 0) onProgress((j + 1) / H);
  }

  if (opt.hollow) hollowOut(kind, W, H, D);
  return { W, H, D, kind, mat };
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
  const perMat = Array.from({ length: materialCount }, () => ({ full: 0, slab: 0 }));
  const perLayer = [];
  const WD = v.W * v.D;
  let full = 0, slab = 0;
  for (let y = 0; y < v.H; y++) {
    let lf = 0, ls = 0;
    for (let i = y * WD, e = i + WD; i < e; i++) {
      const k = v.kind[i];
      if (!k) continue;
      if (k === FULL) { lf++; perMat[v.mat[i]].full++; } else { ls++; perMat[v.mat[i]].slab++; }
    }
    perLayer.push({ full: lf, slab: ls });
    full += lf; slab += ls;
  }
  return { full, slab, perMat, perLayer };
}
