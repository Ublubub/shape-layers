import test from 'node:test';
import assert from 'node:assert/strict';
import zlib from 'node:zlib';
import { buildStamp, isDense, blockCount, forEachBlock, cropStamp, paletteFromStamp, stampFromNBT, readNBT, stampToVoxels, stampCells, rotateStamp, key } from '../src/stampData.js';
import { toSchem } from '../src/exporters.js';

// ---- minimal NBT writer for building test files
function nbt(root) {
  const out = [];
  const u8 = (v) => out.push(v & 255);
  const i16 = (v) => { u8(v >> 8); u8(v); };
  const i32 = (v) => { u8(v >>> 24); u8(v >>> 16); u8(v >>> 8); u8(v); };
  const i64 = (b) => { for (let k = 7; k >= 0; k--) u8(Number((b >> BigInt(k * 8)) & 0xffn)); };
  const str = (s) => { const b = Buffer.from(s, 'utf8'); i16(b.length); for (const c of b) u8(c); };
  const type = (v) => v instanceof BigInt64Array ? 12 : typeof v === 'string' ? 8 : Array.isArray(v) ? 9 : typeof v === 'object' ? 10 : 3;
  const payload = (v) => {
    const t = type(v);
    if (t === 3) i32(v);
    else if (t === 8) str(v);
    else if (t === 12) { i32(v.length); for (const b of v) i64(BigInt.asUintN(64, b)); }
    else if (t === 9) { u8(v.length ? type(v[0]) : 0); i32(v.length); v.forEach(payload); }
    else { for (const [k, x] of Object.entries(v)) { u8(type(x)); str(k); payload(x); } u8(0); }
  };
  u8(10); str(''); payload(root);
  return new Uint8Array(out);
}

// pack palette indices the way Litematica does (tightly, spanning longs)
function packLitematica(values, bits) {
  const longs = new BigInt64Array(Math.ceil((values.length * bits) / 64));
  values.forEach((v, i) => {
    const bit = i * bits, w = Math.floor(bit / 64), off = bit % 64;
    longs[w] = BigInt.asIntN(64, BigInt.asUintN(64, longs[w]) | (BigInt(v) << BigInt(off)));
    if (off + bits > 64) longs[w + 1] = BigInt.asIntN(64, BigInt.asUintN(64, longs[w + 1]) | (BigInt(v) >> BigInt(64 - off)));
  });
  return longs;
}

test('litematica import: packed block states spanning longs, negative region size', () => {
  const pal = [{ Name: 'minecraft:air' }, { Name: 'minecraft:stone_bricks' }, { Name: 'minecraft:oak_stairs', Properties: { facing: 'east', half: 'bottom', shape: 'straight', waterlogged: 'false' } },
    { Name: 'minecraft:lantern', Properties: { hanging: 'true', waterlogged: 'false' } }, { Name: 'minecraft:glass' }];
  const sx = 5, sy = 4, sz = 3; // 60 cells, 3 bits each -> crosses long boundaries
  const values = [];
  for (let y = 0; y < sy; y++) for (let z = 0; z < sz; z++) for (let x = 0; x < sx; x++) values.push((x + y + z) % 5);
  const root = {
    Version: 6, MinecraftDataVersion: 3953,
    Regions: { main: { Position: { x: 10, y: 64, z: -5 }, Size: { x: -sx, y: sy, z: sz }, BlockStatePalette: pal, BlockStates: packLitematica(values, 3) } },
  };
  const st = stampFromNBT(readNBT(nbt(root)), 'lit');
  assert.deepEqual(st.size, [5, 4, 3]);
  let n = 0;
  forEachBlock(st, (x, y, z, s) => {
    n++;
    const v = (x + y + z) % 5;
    assert.ok(s.startsWith(pal[v].Name), `${x},${y},${z}: ${s} vs ${pal[v].Name}`);
  });
  assert.equal(n, values.filter((v) => v !== 0).length);
  assert.equal(st.blocks[key(1, 1, 0)], 'minecraft:oak_stairs[facing=east,half=bottom,shape=straight,waterlogged=false]');
});

test('big builds use the dense format and still round-trip', async () => {
  const W = 40, H = 30, D = 30; // 36,000 blocks > small limit
  const st = buildStamp('hall', [W, H, D], (set) => {
    for (let y = 0; y < H; y++) for (let z = 0; z < D; z++) for (let x = 0; x < W; x++) set(x, y, z, y < 15 ? 'minecraft:mossy_stone_bricks' : 'minecraft:stone_bricks');
  });
  assert.ok(isDense(st));
  assert.equal(blockCount(st), W * H * D);
  const json = JSON.parse(JSON.stringify(st)); // survives saving
  assert.equal(blockCount(json), W * H * D);
  const v = stampToVoxels(json);
  assert.equal(v.custom.length, 2);
  // schem export -> import keeps every block
  const raw = zlib.gunzipSync(Buffer.from(await (await toSchem(v)).arrayBuffer()));
  const back = stampFromNBT(readNBT(new Uint8Array(raw)), 'back');
  assert.equal(blockCount(back), W * H * D);
  // paste
  const pal = [];
  const cells = stampCells(json, { turns: 0, toWorld: (x, y, z) => [x, y, z] }, { origin: [0, 0, 0], cell: [1, 1, 1], dims: [W, H, D] }, (s) => { let i = pal.indexOf(s); if (i < 0) { i = pal.length; pal.push(s); } return i; });
  assert.equal(cells.length, W * H * D * 2);
  assert.equal(rotateStamp(json, 1).size.join(), [D, H, W].join());
});

test('more than 256 different block states survive', () => {
  const st = buildStamp('many', [300, 1, 1], (set) => { for (let x = 0; x < 300; x++) set(x, 0, 0, `minecraft:oak_sign[rotation=${x % 16},waterlogged=false,x${x}=1]`); });
  const v = stampToVoxels(st);
  assert.equal(v.custom.length, 300);
  assert.equal(v.custom[v.meta[299]], 'minecraft:oak_sign[rotation=11,waterlogged=false,x299=1]');
});

test('crop a piece and learn a gradient palette from a worn wall', () => {
  const st = buildStamp('wall', [10, 10, 1], (set) => {
    for (let y = 0; y < 10; y++) for (let x = 0; x < 10; x++) {
      const mossy = y < 5 ? x < 6 : x < 1; // 60% moss at the bottom, 10% at the top
      set(x, y, 0, mossy ? 'minecraft:mossy_stone_bricks' : 'minecraft:stone_bricks');
    }
    set(0, 9, 0, 'minecraft:stone_brick_stairs[facing=north,half=bottom,shape=straight]'); // not a full block
  });
  const piece = cropStamp(st, [2, 0, 0, 4, 2, 0], 'piece');
  assert.deepEqual(piece.size, [3, 3, 1]);
  assert.equal(blockCount(piece), 9);
  const p = paletteFromStamp(st, null, { name: 'worn' });
  const moss = p.entries.find((e) => e.state.includes('mossy'));
  assert.ok(moss.bottom > 50 && moss.top < 20, JSON.stringify(p.entries));
  assert.ok(!p.entries.some((e) => e.state.includes('stairs')));
});
