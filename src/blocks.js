// Block palette. Each entry has a full block, its matching slab and stairs (null = none exists).
// Colors are rough averages of the vanilla textures, good enough for previews.
const B = (id, name, full, slab, stairs, color) => ({ id, name, full: 'minecraft:' + full, slab: 'minecraft:' + slab, stairs: stairs && 'minecraft:' + stairs, color });

export const BLOCKS = [
  B('stone', 'Stone', 'stone', 'stone_slab', 'stone_stairs', '#7f7f7f'),
  B('cobblestone', 'Cobblestone', 'cobblestone', 'cobblestone_slab', 'cobblestone_stairs', '#6b6b6b'),
  B('stone_bricks', 'Stone Bricks', 'stone_bricks', 'stone_brick_slab', 'stone_brick_stairs', '#7a7a7a'),
  B('mossy_stone_bricks', 'Mossy Stone Bricks', 'mossy_stone_bricks', 'mossy_stone_brick_slab', 'mossy_stone_brick_stairs', '#6f7a63'),
  B('smooth_stone', 'Smooth Stone', 'smooth_stone', 'smooth_stone_slab', null, '#a3a3a3'),
  B('andesite', 'Andesite', 'andesite', 'andesite_slab', 'andesite_stairs', '#888a8a'),
  B('tuff_bricks', 'Tuff Bricks', 'tuff_bricks', 'tuff_brick_slab', 'tuff_brick_stairs', '#62675f'),
  B('polished_tuff', 'Polished Tuff', 'polished_tuff', 'polished_tuff_slab', 'polished_tuff_stairs', '#636a64'),
  B('cobbled_deepslate', 'Cobbled Deepslate', 'cobbled_deepslate', 'cobbled_deepslate_slab', 'cobbled_deepslate_stairs', '#4d4d50'),
  B('polished_deepslate', 'Polished Deepslate', 'polished_deepslate', 'polished_deepslate_slab', 'polished_deepslate_stairs', '#48484a'),
  B('deepslate_bricks', 'Deepslate Bricks', 'deepslate_bricks', 'deepslate_brick_slab', 'deepslate_brick_stairs', '#47474a'),
  B('deepslate_tiles', 'Deepslate Tiles', 'deepslate_tiles', 'deepslate_tile_slab', 'deepslate_tile_stairs', '#363638'),
  B('blackstone', 'Blackstone', 'blackstone', 'blackstone_slab', 'blackstone_stairs', '#2b2429'),
  B('bricks', 'Bricks', 'bricks', 'brick_slab', 'brick_stairs', '#976253'),
  B('mud_bricks', 'Mud Bricks', 'mud_bricks', 'mud_brick_slab', 'mud_brick_stairs', '#8a6a50'),
  B('sandstone', 'Sandstone', 'sandstone', 'sandstone_slab', 'sandstone_stairs', '#d8cb9b'),
  B('red_sandstone', 'Red Sandstone', 'red_sandstone', 'red_sandstone_slab', 'red_sandstone_stairs', '#b5621f'),
  B('quartz', 'Quartz', 'quartz_block', 'quartz_slab', 'quartz_stairs', '#ebe5de'),
  B('prismarine', 'Prismarine', 'prismarine', 'prismarine_slab', 'prismarine_stairs', '#63a597'),
  B('oak', 'Oak Planks', 'oak_planks', 'oak_slab', 'oak_stairs', '#a2834f'),
  B('spruce', 'Spruce Planks', 'spruce_planks', 'spruce_slab', 'spruce_stairs', '#735532'),
  B('birch', 'Birch Planks', 'birch_planks', 'birch_slab', 'birch_stairs', '#c4b27c'),
  B('jungle', 'Jungle Planks', 'jungle_planks', 'jungle_slab', 'jungle_stairs', '#a07351'),
  B('acacia', 'Acacia Planks', 'acacia_planks', 'acacia_slab', 'acacia_stairs', '#a85a32'),
  B('dark_oak', 'Dark Oak Planks', 'dark_oak_planks', 'dark_oak_slab', 'dark_oak_stairs', '#432b1a'),
  B('mangrove', 'Mangrove Planks', 'mangrove_planks', 'mangrove_slab', 'mangrove_stairs', '#763631'),
  B('cherry', 'Cherry Planks', 'cherry_planks', 'cherry_slab', 'cherry_stairs', '#e2b3ac'),
  B('bamboo', 'Bamboo Planks', 'bamboo_planks', 'bamboo_slab', 'bamboo_stairs', '#c3ad53'),
  B('cut_copper', 'Waxed Cut Copper', 'waxed_cut_copper', 'waxed_cut_copper_slab', 'waxed_cut_copper_stairs', '#bf6b51'),
  B('purpur', 'Purpur', 'purpur_block', 'purpur_slab', 'purpur_stairs', '#a97ea9'),
  B('end_stone_bricks', 'End Stone Bricks', 'end_stone_bricks', 'end_stone_brick_slab', 'end_stone_brick_stairs', '#dbe0a2'),
  B('nether_bricks', 'Nether Bricks', 'nether_bricks', 'nether_brick_slab', 'nether_brick_stairs', '#2e161a'),
];

export function blockIndex(id) {
  const i = BLOCKS.findIndex((b) => b.id === id);
  return i < 0 ? 0 : i;
}

// Voxel kinds stored in the grid
export const AIR = 0, FULL = 1, BOTTOM = 2, TOP = 3, STAIR = 4;

/**
 * Turn an octant mask (bit = x + 2*z + 4*y; x+ = east, z+ = south, y+ = up)
 * into Minecraft stair properties. "facing" is the side the tall back of the stair is on.
 */
export function stairInfo(mask) {
  const low = mask & 0xf, high = (mask >> 4) & 0xf;
  const half = low === 0xf && high !== 0xf ? 'bottom' : 'top';
  const part = half === 'bottom' ? high : low; // quarter bits: 0 NW, 1 NE, 2 SW, 3 SE
  const n = (part & 1) + ((part >> 1) & 1) + ((part >> 2) & 1) + ((part >> 3) & 1);
  if (n === 2) {
    const facing = part === 0b0011 ? 'north' : part === 0b1100 ? 'south' : part === 0b0101 ? 'west' : 'east';
    return { facing, half, shape: 'straight' };
  }
  if (n === 1) {
    const qi = Math.log2(part);
    const north = qi < 2, east = (qi & 1) === 1;
    const facing = north ? 'north' : 'south';
    // looking toward `facing`: north -> right is east, south -> right is west
    const right = north ? east : !east;
    return { facing, half, shape: right ? 'outer_right' : 'outer_left' };
  }
  // 3 quarters: inner corner, find the missing quarter
  const qi = Math.log2(~part & 0xf);
  const missingSouth = qi >= 2, missingEast = (qi & 1) === 1;
  const facing = missingSouth ? 'north' : 'south';
  const sideEast = !missingEast;
  const right = facing === 'north' ? sideEast : !sideEast;
  return { facing, half, shape: right ? 'inner_right' : 'inner_left' };
}

export function blockState(matIdx, kind, meta = 0) {
  const b = BLOCKS[matIdx] || BLOCKS[0];
  if (kind === FULL) return b.full;
  if (kind === STAIR && b.stairs) {
    const s = stairInfo(meta);
    return `${b.stairs}[facing=${s.facing},half=${s.half},shape=${s.shape}]`;
  }
  return `${b.slab}[type=${kind === BOTTOM ? 'bottom' : 'top'}]`;
}

export function blockLabel(matIdx, kind, meta = 0) {
  const b = BLOCKS[matIdx] || BLOCKS[0];
  if (kind === FULL) return b.name;
  if (kind === STAIR) {
    const s = stairInfo(meta);
    const shape = s.shape === 'straight' ? '' : ', ' + s.shape.replace('_', ' ');
    return `${b.name} stairs (facing ${s.facing}${s.half === 'top' ? ', upside-down' : ''}${shape})`;
  }
  return `${b.name} slab (${kind === BOTTOM ? 'bottom' : 'top'})`;
}
