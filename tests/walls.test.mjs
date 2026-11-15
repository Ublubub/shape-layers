import test from 'node:test';
import assert from 'node:assert/strict';
import { PRESET_PALETTES, pickFromPalette, hash01, resolveSpec } from '../src/palettes.js';
import { PRESET_PROFILES, newWall, wallToStamp, profileRow, generatePillar, DEFAULT_PILLAR } from '../src/wallData.js';
import { key } from '../src/stampData.js';

test('palette gradient: moss is more common at the bottom than at the top', () => {
  const pal = PRESET_PALETTES.find((p) => p.id === 'worn-stone');
  const count = (t) => { let n = 0; for (let i = 0; i < 4000; i++) if (pickFromPalette(pal, t, hash01(i, 7, 3, 42)).includes('mossy')) n++; return n / 4000; };
  const bottom = count(0), top = count(1);
  assert.ok(bottom > 0.25 && bottom < 0.45, `bottom ${bottom}`);
  assert.ok(top < 0.1, `top ${top}`);
});

test('palette picks are deterministic', () => {
  const pal = PRESET_PALETTES[0];
  assert.equal(pickFromPalette(pal, 0.3, hash01(1, 2, 3, 9)), pickFromPalette(pal, 0.3, hash01(1, 2, 3, 9)));
  assert.equal(resolveSpec('minecraft:stone', PRESET_PALETTES, 0, 0.5), 'minecraft:stone');
});

test('stretch row keeps the plinth at the floor and the beam at the top', () => {
  const p = PRESET_PROFILES.find((x) => x.id === 'hall'); // 9 rows, stretch row 3
  assert.deepEqual([...Array(12)].map((_, y) => profileRow(p, y, 12)), [0, 1, 2, 3, 3, 3, 3, 4, 5, 6, 7, 8]);
  assert.deepEqual([...Array(9)].map((_, y) => profileRow(p, y, 9)), [0, 1, 2, 3, 4, 5, 6, 7, 8]);
  const short = [...Array(6)].map((_, y) => profileRow(p, y, 6));
  assert.equal(short[0], 0); assert.equal(short[5], 8); // still has plinth and top
});

test('wallToStamp extrudes the profile along the length', () => {
  const w = newWall(PRESET_PROFILES.find((x) => x.id === 'hall'), 10, 12);
  w.seed = 5;
  const st = wallToStamp(w, PRESET_PALETTES);
  assert.deepEqual(st.size, [10, 12, 2]);
  for (let x = 0; x < 10; x++) {
    assert.equal(st.blocks[key(x, 0, 0)], 'minecraft:polished_andesite');
    assert.match(st.blocks[key(x, 10, 1)], /spruce_stairs\[facing=north,half=top/); // beam corbel, second row from the top
    assert.ok(!st.blocks[key(x, 5, 1)]); // recessed field, front layer is air
  }
});

test('pillar generator: skirt base footprint, wraps, bands and capital', () => {
  const s = generatePillar(DEFAULT_PILLAR);
  assert.deepEqual(s.size, [5, 10, 5]);
  assert.match(s.blocks[key(2, 0, 0)], /spruce_stairs\[facing=south/); // outer step faces the column
  assert.equal(s.blocks[key(2, 0, 1)], 'minecraft:spruce_planks');
  assert.match(s.blocks[key(2, 2, 1)], /spruce_trapdoor\[facing=north,half=bottom,open=true\]/); // lower wrap
  assert.match(s.blocks[key(2, 5, 1)], /acacia_trapdoor/); // band
  assert.match(s.blocks[key(2, 9, 1)], /half=top/); // capital stairs
  assert.match(s.blocks[key(2, 4, 2)], /stripped_spruce_log/);
});
