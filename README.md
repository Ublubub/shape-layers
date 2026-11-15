# ▦ Shape Layers

Sketch odd 3D structures in the browser using simple shapes, then turn them into **layer-by-layer Minecraft build plans**. Curves are smoothed with **slabs and stairs**.

Stack spheres, domes, barrel vaults, cones, tori and ramps. Stretch, rotate, repeat and carve them. Pick a size in blocks, and you get:

- a **3D block preview**, which you can cut down layer by layer
- a **2D plan for each layer** (top-down, with a grid, rulers, the layer below shown faintly, and the block name on hover)
- a **material list** with stacks, shulker boxes, and how many blocks to craft into slabs
- **exports**: `.schem` (WorldEdit / Litematica), `.mcfunction` (commands), a CSV material list, PNG layers, and a printable layer sheet

No build step and no backend: the whole thing is static files, so it runs on GitHub Pages as is.

## Running it

ES modules and Web Workers don't load from `file://`, so serve the folder with any static server:

```bash
npx serve .          # or: npm start
# or
python -m http.server 5173
```

Then open the URL it prints, e.g. http://localhost:5173.

Run the tests with `npm test` (needs Node 18 or newer).

### Publishing on GitHub Pages

1. Push this folder to a GitHub repo.
2. Go to **Settings → Pages → Build and deployment**, choose *Deploy from a branch*, then pick `main` and `/ (root)`.
3. The site appears at `https://<you>.github.io/<repo>/`.

## How to use it

First time? A **welcome screen** offers one-click starts (build a hall, load an example, start empty); **? Help** brings it back. The app starts in a simple mode; switch on **Advanced** (top right) to see every fine-tuning setting (fill threshold, quality, corner stairs, scale, mirror…). Follow the numbered steps in the header: **1 Design → 2 Blocks → 3 Layers**; the *Next step* card on the right always points to what comes next.

| Step | What you do |
|---|---|
| **1 · Design** | Add shapes. Click a shape to select it. Use the gizmo to **Move (W)**, **Stretch (R)** or **Rotate (E)**, or type exact numbers. Set a shape to **Carve** to cut holes (doors, hollow towers, arches). Shapes are applied top to bottom, so order matters for carving. |
| **Parts** | Shapes can belong to a **part** (Pillars, Walls, Roof…), like Lego pieces. Each part header can **select** the whole part (move it with the gizmo), **turn** it 90°, **duplicate** it, **solo** it (show and convert only that part), or hide it. Set a shape's part in the *Part* field. |
| **🧱 Wall builder** | Paint a wall's **cross-section** (back → front, bottom → top) so each layer can step forward or back: plinths, recessed panels, beams, cornices. The **stretch row** repeats so the profile fits any height. Paint with **palettes** to mix blocks with a **gradient** (e.g. more moss near the floor); edit palettes with top/bottom weights and a live preview. Save profiles as **wall styles**. |
| **🗿 Pillar builder** | A pillar from settings: column block, base (stair ring or a wide two-step skirt), trapdoor wraps at the bottom and top, bands at chosen heights, capital. Creates a stamp you can place, repeat or fine-tune; ⚙ re-opens the settings. |
| **Hall builder** | Enter pillar count, width, gap, height and hall length. It places the pillar rows and a **vaulted roof** that lands exactly on the outer faces of the end pillars (e.g. 4 pillars, 1 wide, 5 apart = 19 blocks). Afterwards, select the roof to change its **rise**, **thickness**, **roundness** (round ↔ crushed oval ↔ boxy) and **flatten** (a segmental arch), or stretch its length. |
| **Roof shape** | Select a vault to see the **roof's own size in blocks** (span × rise × length, not counting the pillars) and where the arch starts. **Span**, **Rise** and **Length** sliders work in blocks; the base stays on the pillars and the length grows from the start of the roof. Presets for rise/span (½ semicircle, ⅓, ¼) and *keep ratio*. |
| **2 · Blocks** | **Color by Shape** gives full blocks, bottom slabs, top slabs, stairs and upside-down stairs each their own color. Hover any block to see exactly what it is and where. |
| **Roof connections** | **✚ Crossing 90°** adds a vault crossing through the center (groin vault); **⊢ Branch 90°** adds one leaving from the center. Roofs with *Join with other roofs* on are merged as (all outer shells) − (all hollow insides), so changing either roof's rise, span, roundness or angle updates the intersection automatically. Works at any angle. |
| **Stamps** | Exact block details (logs, trapdoors, lanterns, chains, any block state). Start from the **pillar template** (1-wide log column, stair ring at the base, trapdoor bands, upside-down stair capital), a blank grid, or **import** a `.schem` / structure `.nbt`. Paint layer by layer with a live 3D preview. Place stamps like shapes: move, turn in 90° steps (stair/log/trapdoor orientations turn with them) and Repeat. In the **Hall builder**, pick a stamp as the *Pillar style*. Stamps are pasted block-for-block after conversion, so they appear in every view, the material list and the exports. |
| **Show blocks** | Toolbar toggle in Design view: draws the converted blocks over the (faded) shapes while you edit. |
| **Sections** | In **3 · Layers**, switch between **Top** (the layer plan), **Front section** (a vertical cut across the hall: x · y) and **Side section** (along the hall: z · y). Use the slice slider or ←/→ to move the cut. Slabs and stairs are drawn with their real profile, everything behind the cut is shown faded, and the header shows the width and the clear height at the center. |
| **Repeat** | Any shape can be copied N times along x, y or z at a fixed spacing, which is handy for rows of pillars, ribs or windows. |
| **Size** | **Blocks / unit** sets the scale; the default is 1 (one design unit = one block). Keep it a whole number so 1-wide pillars stay exact. Bigger numbers are useful for scale models: design a 40-unit cathedral once, then build it at 2× or 3×; fractional values (e.g. 0.5) give a quick low-detail preview of a huge build. Typing a width, height or depth rescales everything **once**; after that, editing a shape only changes that shape. *Keep proportions* rescales all axes together. The ½× / 2× / 3× buttons scale the whole build. Stretching a shape's height with the gizmo keeps its bottom in place, so roofs stay on their pillars. |
| **2 · Blocks** | A 3D preview made of real blocks and slabs. Move the layer slider to cut the model at a layer. Layers below it are dimmed. |
| **3 · Layers** | The plan to build from. Use ↑/↓ or PageUp/PageDown to change layers. Tick **Mark this layer as built** to track your progress. |

Shortcuts: `1/2/3` switch views · `W/E/R` gizmo · `F` frame · `Del` delete · `Ctrl+D` duplicate · `Ctrl+Z / Ctrl+Y` undo/redo · `Esc` deselect.

Your project autosaves in the browser. **Save** / **Open** use a `.json` file.

## How it works

1. **Every shape is a "unit primitive"** that fits inside the cube `[-0.5, 0.5]³` in its own local space. Each one has a cheap *inside test*, e.g. for a sphere `x²+y²+z² ≤ 0.25` (see `src/voxelizer.js`).
2. Moving, stretching and rotating a shape only changes its **transform matrix**. To ask whether a world point is inside a shape, multiply the point by the inverse matrix and run the unit test. This is why any shape can be squashed into an ellipsoid or a leaning cone without extra code.
3. **Voxelizing:** the bounding box of all solid shapes is split into W×H×D cells. Each cell is divided into a **lower half and an upper half**, and a few points are sampled in each half (2×2×1 up to 4×4×3, depending on *Quality*):
   - both halves at least *threshold* full → **full block**
   - only the lower half → **bottom slab**
   Each cell is sampled as **8 octants** (2×2×2). The pattern of solid octants picks the block:
   - all 8 → **full block**
   - bottom 4 → **bottom slab**; top 4 → **top slab**
   - bottom 4 + one side of the top → **stairs** facing that side; one or three top quarters → **outer / inner corner stairs**
   - the same, flipped → **upside-down stairs**
   - anything else falls back to comparing the lower and upper halves

   Slabs and stairs double the resolution, which is what makes domes, vaults and slopes look smooth. Blocks that have no stairs (e.g. smooth stone) fall back to slabs.
4. **Carve** shapes switch the samples they cover back to air. **Hollow** removes full blocks that are completely enclosed, which can save a lot of material.
5. The heavy work runs in a **Web Worker** (`src/voxel-worker.js`), so the page stays responsive on large builds.

```
index.html        page layout
styles.css
src/main.js       app state, UI, Three.js design scene, undo/redo, exports menu
src/shapes.js     shape list + display geometry (must match the inside tests)
src/voxelizer.js  pure voxelizer (no Three.js), also used by the tests
src/voxel-worker.js
src/blockView.js  instanced 3D block preview
src/layerView.js  2D layer plan renderer
src/blocks.js     block palette (full block + matching slab)
src/exporters.js  .schem (Sponge v2 NBT, gzipped), .mcfunction, CSV
tests/            node --test
```

## Ideas for later

- **Walls/fences** for thin parts
- Auto-connect fences/walls/panes inside stamps (the game also fixes them on the next block update)
- Stamp mirroring and a stamp library shared between projects
- **Smooth blend** between shapes (signed distance fields with a smooth-min), so shapes melt into each other
- **Lathe / spline tool**: draw a profile and spin it into a vase, a tower or a bell
- **Paths**: sweep a circle along a curve for arches, bridges, tentacles
- **Symmetry modes** (mirror X/Z, radial ×N) that update live
- **Shell thickness** setting (2–3 blocks) instead of just "hollow"
- **Gradient / noise materials** (e.g. cobble → stone → stone bricks by height, or random weathering)
- **Litematica `.litematic`** and vanilla structure block `.nbt` export
- **Import** `.schem` or a 3D model (`.obj` / `.glb`) as a reference shape
- **Share links** that store the project in the URL hash
- Per-layer **build order hints**, such as which slabs need a support block first

## Notes

- In `.schem` / `.mcfunction` output, stairs carry `facing`, `half` and `shape`. Corner shapes (inner/outer) are also recalculated by the game whenever a neighbouring block updates.
- `.schem` uses DataVersion 3953 (Minecraft 1.21) because of the tuff blocks. WorldEdit converts it for other versions.

## License

MIT
