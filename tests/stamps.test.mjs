import test from 'node:test';
import assert from 'node:assert/strict';
import zlib from 'node:zlib';
import { voxelize, summarize } from '../src/voxelizer.js';
import { BLOCKS, CUSTOM, FULL, stairInfo } from '../src/blocks.js';
import { rotateState, stairMaskFromProps, stateMask, parseState } from '../src/blockstates.js';
import { newStamp, key, rotateStamp, stampCells, pillarTemplate, readNBT, stampFromNBT, stampToVoxels } from '../src/stampData.js';
import { toSchem, toMcfunction } from '../src/exporters.js';

const opts = { slabs: true, topSlabs: true, stairs: true, stairCorners: true, threshold: 0.5, quality: 'normal', hollow: false, materialCount: BLOCKS.length, stairMats: BLOCKS.map((b) => !!b.stairs) };

// inverse matrix for translate + rotateY(deg) + scale (column-major)
function inv(pos, scale, rotYdeg = 0) {
  const a = (-rotYdeg * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a);
  // inverse = S^-1 * R(-a) * T(-p)
  const R = [c, 0, -s, 0, 1, 0, s, 0, c]; // rotation about y by angle a (row-major 3x3)
  const m = new Array(16).fill(0);
  for (let r = 0; r < 3; r++) for (let k = 0; k < 3; k++) m[k * 4 + r] = R[r * 3 + k] / scale[r];
  for (let r = 0; r < 3; r++) m[12 + r] = -(m[r] * pos[0] + m[4 + r] * pos[1] + m[8 + r] * pos[2]);
  m[15] = 1;
  return m;
}
const vault = (pos, scale, rotY = 0, join = true) => ({
  type: 'vault', add: true, mat: 0, join, inv: inv(pos, scale, rotY),
  params: { thickness: 1, roundness: 2, flatten: 0, sx: scale[0], sy: scale[1], sz: scale[2] },
  aabb: [-100, -100, -100, 100, 100, 100],
});

test('rotateState turns facing, axis and connections clockwise', () => {
  assert.equal(rotateState('minecraft:oak_stairs[facing=north,half=bottom,shape=straight]', 1), 'minecraft:oak_stairs[facing=east,half=bottom,shape=straight]');
  assert.equal(rotateState('minecraft:oak_log[axis=x]', 1), 'minecraft:oak_log[axis=z]');
  assert.equal(rotateState('minecraft:oak_fence[east=false,north=true,south=false,west=false]', 1), 'minecraft:oak_fence[east=true,north=false,south=false,west=false]');
  assert.equal(rotateState('minecraft:stone', 3), 'minecraft:stone');
});

test('stair masks round-trip through stairInfo', () => {
  // every stair shape the voxelizer can produce maps back to the same mask
  for (let part = 1; part < 15; part++) for (const top of [false, true]) {
    if (part === 0b1001 || part === 0b0110) continue; // diagonal: not a stair
    const m = top ? 0xf0 | part : 0x0f | (part << 4);
    assert.equal(stairMaskFromProps(stairInfo(m)), m, `mask ${m.toString(2)}`);
  }
  // corner stairs written with east/west facing (as in imported schematics)
  assert.equal(stairMaskFromProps({ facing: 'east', half: 'bottom', shape: 'inner_left' }), 0x0f | (0b1011 << 4));
  assert.equal(stairMaskFromProps({ facing: 'west', half: 'top', shape: 'outer_right' }), 0xf0 | 0b0001);
  assert.equal(stateMask('minecraft:spruce_slab[type=top]'), 0xf0);
  assert.equal(parseState('lantern[hanging=true]').id, 'minecraft:lantern');
});

test('joined vaults crossing at 90° open into each other (groin vault)', () => {
  const dims = [21, 8, 21], origin = [-10.5, 0, -10.5], cell = [1, 1, 1];
  const a = vault([0, 4, 0], [21, 8, 21], 0);
  const b = vault([0, 4, 0], [21, 8, 21], 90);
  const mid = (v, x, y, z) => v.kind[x + z * 21 + y * 21 * 21];
  const joined = voxelize({ dims, origin, cell, shapes: [a, b], options: opts });
  const unjoined = voxelize({ dims, origin, cell, shapes: [{ ...a, join: false }, { ...b, join: false }], options: opts });
  // walking along the first vault's axis at head height: no wall where the second vault's shell would be
  let blockedJoined = 0, blockedUnjoined = 0;
  for (let z = 1; z < 20; z++) { if (mid(joined, 10, 3, z)) blockedJoined++; if (mid(unjoined, 10, 3, z)) blockedUnjoined++; }
  assert.equal(blockedJoined, 0);
  assert.ok(blockedUnjoined > 0, 'without joining, the crossing shell blocks the hall');
  // the outer shell still exists at the crown
  assert.ok(mid(joined, 10, 7, 2));
});

test('stamp cells land in the grid and rotate their states', () => {
  const st = newStamp('t', [3, 1, 1]);
  st.blocks[key(0, 0, 0)] = 'minecraft:oak_stairs[facing=north,half=bottom,shape=straight]';
  const grid = { origin: [0, 0, 0], cell: [1, 1, 1], dims: [5, 2, 5] };
  const pal = [];
  const palette = (s) => { let i = pal.indexOf(s); if (i < 0) { i = pal.length; pal.push(s); } return i; };
  // no rotation, stamp min corner at (1, 0, 2)
  const out = stampCells(st, { turns: 0, toWorld: (x, y, z) => [x + 1, y, z + 2] }, grid, palette);
  assert.deepEqual(out, [1 + 2 * 5, 0]);
  const out2 = stampCells(st, { turns: 1, toWorld: (x, y, z) => [x, y, z] }, grid, palette);
  assert.equal(pal[out2[1]], 'minecraft:oak_stairs[facing=east,half=bottom,shape=straight]');
});

test('stamps are pasted over converted shapes and counted', () => {
  const v = voxelize({
    dims: [3, 3, 3], origin: [0, 0, 0], cell: [1, 1, 1], shapes: [], options: opts,
    custom: ['minecraft:lantern[hanging=false]'], stampCells: [13, 0],
  });
  assert.equal(v.kind[13], CUSTOM);
  const s = summarize(v, BLOCKS.length);
  assert.equal(s.custom, 1);
  assert.equal(s.perCustom.get('minecraft:lantern'), 1);
  assert.match(toMcfunction(v), /setblock ~1 ~1 ~1 minecraft:lantern\[hanging=false\]/);
});

test('rotateStamp keeps blocks inside the new bounds', () => {
  const p = pillarTemplate(9);
  const r = rotateStamp(p, 1);
  assert.deepEqual(r.size, [3, 9, 3]);
  assert.equal(Object.keys(r.blocks).length, Object.keys(p.blocks).length);
  const st = newStamp('L', [4, 1, 2]);
  st.blocks[key(3, 0, 0)] = 'minecraft:stone';
  const r1 = rotateStamp(st, 1);
  assert.deepEqual(r1.size, [2, 1, 4]);
  assert.ok(r1.blocks[key(1, 0, 3)], JSON.stringify(r1.blocks)); // NE corner -> SE corner
});

test('pillar template: stairs at the base face the column', () => {
  const p = pillarTemplate(9, 'spruce');
  assert.match(p.blocks[key(1, 0, 0)], /spruce_stairs\[facing=south,half=bottom,shape=straight\]/);
  assert.match(p.blocks[key(1, 0, 2)], /facing=north/);
  assert.match(p.blocks[key(1, 7, 0)], /half=top/);
  assert.match(p.blocks[key(1, 3, 1)], /stripped_spruce_log/);
});

test('.schem export can be imported back as a stamp', async () => {
  const st = pillarTemplate(6, 'oak');
  const v = stampToVoxels(st);
  const blob = await toSchem(v);
  const raw = zlib.gunzipSync(Buffer.from(await blob.arrayBuffer()));
  const back = stampFromNBT(readNBT(new Uint8Array(raw)), 'back');
  assert.deepEqual(back.size, st.size);
  assert.deepEqual(back.blocks, st.blocks);
});
