// Run with: node --test tests/
import test from 'node:test';
import assert from 'node:assert/strict';
import { voxelize, summarize } from '../src/voxelizer.js';
import { BLOCKS, FULL, BOTTOM, TOP } from '../src/blocks.js';
import { toMcfunction, toSchem } from '../src/exporters.js';

// inverse of a translate+scale matrix (column-major, like three.js)
function inv(pos, scale) {
  const m = new Array(16).fill(0);
  m[0] = 1 / scale[0]; m[5] = 1 / scale[1]; m[10] = 1 / scale[2]; m[15] = 1;
  m[12] = -pos[0] / scale[0]; m[13] = -pos[1] / scale[1]; m[14] = -pos[2] / scale[2];
  return m;
}
const shape = (type, pos, scale, add = true, mat = 0) => ({
  type, add, mat, inv: inv(pos, scale),
  aabb: [pos[0] - scale[0] / 2, pos[1] - scale[1] / 2, pos[2] - scale[2] / 2, pos[0] + scale[0] / 2, pos[1] + scale[1] / 2, pos[2] + scale[2] / 2],
});
const opts = { slabs: true, topSlabs: true, threshold: 0.5, quality: 'normal', hollow: false, materialCount: BLOCKS.length };
const job = (shapes, dims, size, o = {}, origin = size.map((s) => -s / 2)) => ({
  dims, origin, cell: size.map((s, i) => s / dims[i]), shapes, options: { ...opts, ...o },
});

test('box fills every cell with full blocks', () => {
  const v = voxelize(job([shape('box', [0, 0, 0], [4, 4, 4])], [4, 4, 4], [4, 4, 4]));
  assert.ok(v.kind.every((k) => k === FULL));
});

test('a 1.5-block-tall box becomes a full layer + a bottom slab layer', () => {
  const v = voxelize(job([shape('box', [0, 0.75, 0], [3, 1.5, 3])], [3, 2, 3], [3, 2, 3], {}, [-1.5, 0, -1.5]));
  const WD = 9;
  for (let i = 0; i < WD; i++) assert.equal(v.kind[i], FULL);
  // shape spans y 0..1.5 inside a 0..2 volume: top layer is half filled
  for (let i = WD; i < 2 * WD; i++) assert.equal(v.kind[i], BOTTOM);
});

test('sphere produces both slab types when smoothing', () => {
  const v = voxelize(job([shape('sphere', [0, 0, 0], [16, 16, 16])], [16, 16, 16], [16, 16, 16]));
  const s = summarize(v, BLOCKS.length);
  assert.ok(s.full > 1000);
  assert.ok(v.kind.includes(BOTTOM) && v.kind.includes(TOP));
});

test('no slabs option uses only full blocks', () => {
  const v = voxelize(job([shape('sphere', [0, 0, 0], [16, 16, 16])], [16, 16, 16], [16, 16, 16], { slabs: false }));
  assert.ok(!v.kind.includes(BOTTOM) && !v.kind.includes(TOP));
});

test('subtract carves and hollow removes interior', () => {
  const solid = summarize(voxelize(job([shape('box', [0, 0, 0], [8, 8, 8])], [8, 8, 8], [8, 8, 8])), BLOCKS.length);
  const carved = summarize(voxelize(job([shape('box', [0, 0, 0], [8, 8, 8]), shape('box', [0, 0, 0], [4, 4, 4], false)], [8, 8, 8], [8, 8, 8])), BLOCKS.length);
  const hollow = summarize(voxelize(job([shape('box', [0, 0, 0], [8, 8, 8])], [8, 8, 8], [8, 8, 8], { hollow: true })), BLOCKS.length);
  assert.equal(solid.full, 512);
  assert.equal(carved.full, 512 - 64);
  assert.equal(hollow.full, 512 - 216);
});

test('material comes from the shape that covers the cell', () => {
  const v = voxelize(job([shape('box', [0, 0, 0], [4, 4, 4], true, 0), shape('box', [1, 0, 0], [2, 4, 4], true, 5)], [4, 4, 4], [4, 4, 4]));
  assert.equal(v.mat[0], 0);
  assert.equal(v.mat[3], 5);
});

test('exporters', async () => {
  const v = voxelize(job([shape('box', [0, 0.75, 0], [3, 1.5, 3])], [3, 2, 3], [3, 2, 3], {}, [-1.5, 0, -1.5]));
  const mc = toMcfunction(v);
  assert.match(mc, /fill ~0 ~0 ~0 ~2 ~0 ~0 minecraft:stone\n/);
  assert.match(mc, /minecraft:stone_slab\[type=bottom\]/);
  const blob = await toSchem(v);
  const head = new Uint8Array(await blob.arrayBuffer()).slice(0, 2);
  assert.deepEqual([...head], [0x1f, 0x8b]); // gzip magic
});

import { STAIR, stairInfo, blockState } from '../src/blocks.js';
import { makeTest, vaultProfile } from '../src/voxelizer.js';

test('stairInfo maps octant masks to Minecraft stair states', () => {
  // bottom half + top north half (z-) -> facing north, straight
  assert.deepEqual(stairInfo(0x0f | (0b0011 << 4)), { facing: 'north', half: 'bottom', shape: 'straight' });
  assert.deepEqual(stairInfo(0x0f | (0b1010 << 4)), { facing: 'east', half: 'bottom', shape: 'straight' });
  // upside-down: top half + bottom west half
  assert.deepEqual(stairInfo(0xf0 | 0b0101), { facing: 'west', half: 'top', shape: 'straight' });
  // outer corner: only NE quarter on top
  assert.deepEqual(stairInfo(0x0f | (0b0010 << 4)), { facing: 'north', half: 'bottom', shape: 'outer_right' });
  // inner corner: missing SE quarter -> north half + west half
  assert.deepEqual(stairInfo(0x0f | (0b0111 << 4)), { facing: 'north', half: 'bottom', shape: 'inner_left' });
  assert.equal(blockState(0, STAIR, 0x0f | (0b0011 << 4)), 'minecraft:stone_stairs[facing=north,half=bottom,shape=straight]');
});

test('a 45° ramp turns into stairs when stairs are enabled', () => {
  // wedge: high side at -x (west), sloping down toward +x
  const v = voxelize(job([shape('wedge', [0, 0, 0], [8, 8, 8])], [8, 8, 8], [8, 8, 8], { stairs: true, stairCorners: true, stairMats: BLOCKS.map((b) => !!b.stairs) }));
  let stairs = 0;
  for (let i = 0; i < v.kind.length; i++) if (v.kind[i] === STAIR) { stairs++; assert.equal(stairInfo(v.meta[i]).facing, 'west'); }
  assert.ok(stairs >= 8, 'expected a diagonal of stairs, got ' + stairs);
});

test('materials without stairs fall back to slabs', () => {
  const smooth = BLOCKS.findIndex((b) => b.id === 'smooth_stone');
  const v = voxelize(job([shape('wedge', [0, 0, 0], [8, 8, 8], true, smooth)], [8, 8, 8], [8, 8, 8], { stairs: true, stairMats: BLOCKS.map((b) => !!b.stairs) }));
  assert.ok(!v.kind.includes(STAIR));
});

test('vault profile: base at -0.5, crown at 0.5, flatten keeps the span', () => {
  for (const flatten of [0, 0.4, 0.8]) for (const roundness of [1.5, 2, 4]) {
    const p = vaultProfile({ roundness, flatten });
    assert.ok(Math.abs(p.yc + p.b - 0.5) < 1e-9);
    // the curve passes through the corners (±0.5, -0.5)
    const lhs = (0.5 / p.a) ** p.n + Math.abs((-0.5 - p.yc) / p.b) ** p.n;
    assert.ok(Math.abs(lhs - 1) < 1e-9);
  }
  // hollow shell of thickness 1 on a 19-wide vault: the crown is solid, the middle is air
  const t = makeTest('vault', { thickness: 1, roundness: 2, flatten: 0, sx: 19, sy: 7, sz: 10 });
  assert.equal(t(0, 0.45, 0), true);
  assert.equal(t(0, -0.2, 0), false);
  assert.equal(t(0.48, -0.49, 0), true); // sits on the outer pillar
});
