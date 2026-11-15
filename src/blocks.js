// Block palette. Each entry has a full block and its matching slab.
// Colors are rough averages of the vanilla textures, good enough for previews.
export const BLOCKS = [
  { id: 'stone',            name: 'Stone',             full: 'minecraft:stone',            slab: 'minecraft:stone_slab',             color: '#7f7f7f' },
  { id: 'cobblestone',      name: 'Cobblestone',       full: 'minecraft:cobblestone',      slab: 'minecraft:cobblestone_slab',       color: '#6b6b6b' },
  { id: 'stone_bricks',     name: 'Stone Bricks',      full: 'minecraft:stone_bricks',     slab: 'minecraft:stone_brick_slab',       color: '#7a7a7a' },
  { id: 'smooth_stone',     name: 'Smooth Stone',      full: 'minecraft:smooth_stone',     slab: 'minecraft:smooth_stone_slab',      color: '#a3a3a3' },
  { id: 'andesite',         name: 'Andesite',          full: 'minecraft:andesite',         slab: 'minecraft:andesite_slab',          color: '#888a8a' },
  { id: 'deepslate_bricks', name: 'Deepslate Bricks',  full: 'minecraft:deepslate_bricks', slab: 'minecraft:deepslate_brick_slab',   color: '#47474a' },
  { id: 'blackstone',       name: 'Blackstone',        full: 'minecraft:blackstone',       slab: 'minecraft:blackstone_slab',        color: '#2b2429' },
  { id: 'bricks',           name: 'Bricks',            full: 'minecraft:bricks',           slab: 'minecraft:brick_slab',             color: '#976253' },
  { id: 'sandstone',        name: 'Sandstone',         full: 'minecraft:sandstone',        slab: 'minecraft:sandstone_slab',         color: '#d8cb9b' },
  { id: 'red_sandstone',    name: 'Red Sandstone',     full: 'minecraft:red_sandstone',    slab: 'minecraft:red_sandstone_slab',     color: '#b5621f' },
  { id: 'quartz',           name: 'Quartz',            full: 'minecraft:quartz_block',     slab: 'minecraft:quartz_slab',            color: '#ebe5de' },
  { id: 'prismarine',       name: 'Prismarine',        full: 'minecraft:prismarine',       slab: 'minecraft:prismarine_slab',        color: '#63a597' },
  { id: 'mud_bricks',       name: 'Mud Bricks',        full: 'minecraft:mud_bricks',       slab: 'minecraft:mud_brick_slab',         color: '#8a6a50' },
  { id: 'oak',              name: 'Oak Planks',        full: 'minecraft:oak_planks',       slab: 'minecraft:oak_slab',               color: '#a2834f' },
  { id: 'spruce',           name: 'Spruce Planks',     full: 'minecraft:spruce_planks',    slab: 'minecraft:spruce_slab',            color: '#735532' },
  { id: 'birch',            name: 'Birch Planks',      full: 'minecraft:birch_planks',     slab: 'minecraft:birch_slab',             color: '#c4b27c' },
  { id: 'dark_oak',         name: 'Dark Oak Planks',   full: 'minecraft:dark_oak_planks',  slab: 'minecraft:dark_oak_slab',          color: '#432b1a' },
  { id: 'cherry',           name: 'Cherry Planks',     full: 'minecraft:cherry_planks',    slab: 'minecraft:cherry_slab',            color: '#e2b3ac' },
  { id: 'cut_copper',       name: 'Waxed Cut Copper',  full: 'minecraft:waxed_cut_copper', slab: 'minecraft:waxed_cut_copper_slab',  color: '#bf6b51' },
  { id: 'purpur',           name: 'Purpur',            full: 'minecraft:purpur_block',     slab: 'minecraft:purpur_slab',            color: '#a97ea9' },
  { id: 'end_stone_bricks', name: 'End Stone Bricks',  full: 'minecraft:end_stone_bricks', slab: 'minecraft:end_stone_brick_slab',   color: '#dbe0a2' },
  { id: 'nether_bricks',    name: 'Nether Bricks',     full: 'minecraft:nether_bricks',    slab: 'minecraft:nether_brick_slab',      color: '#2e161a' },
];

export function blockIndex(id) {
  const i = BLOCKS.findIndex((b) => b.id === id);
  return i < 0 ? 0 : i;
}

// Voxel kinds stored in the grid
export const AIR = 0, FULL = 1, BOTTOM = 2, TOP = 3;

export function blockState(matIdx, kind) {
  const b = BLOCKS[matIdx] || BLOCKS[0];
  if (kind === FULL) return b.full;
  return `${b.slab}[type=${kind === BOTTOM ? 'bottom' : 'top'}]`;
}
