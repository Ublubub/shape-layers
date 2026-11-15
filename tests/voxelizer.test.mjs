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
