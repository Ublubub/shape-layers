import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { SHAPE_TYPES, typeDef, defaultParams, voxelParams, buildGeometry, geometryKey, isSharedGeometry } from './shapes.js';
import { BLOCKS, blockIndex } from './blocks.js';
import { StampEditor, stampGeometry } from './stampEditor.js';
import { pillarTemplate, stampCells, stampFromFile, newStamp, blockCount, isDense, cropStamp, paletteFromStamp, stampToVoxels, SMALL_LIMIT } from './stampData.js';
import { idbGet, idbSet } from './store.js';
import { forEachBlock as cropForEach } from './stampData.js';
import { Preview3D } from './stampEditor.js';
import { stateColor } from './blockstates.js';
import { WallEditor } from './wallEditor.js';
import { PillarBuilder } from './pillarBuilder.js';
import { newWall, wallToStamp, PRESET_PROFILES } from './wallData.js';
import { clonePresets } from './palettes.js';
import { summarize } from './voxelizer.js';
import { LayerView, drawLayer, drawSection, viewDims, LIGHT_THEME } from './layerView.js';
import { BlockView, buildBlockGroup, disposeBlockGroup } from './blockView.js';
import { download, toMcfunction, toSchem, materialList, stacks } from './exporters.js';

const $ = (id) => document.getElementById(id);
const STORAGE_KEY = 'shape-layers:v1';
const MAX_CELLS = 16_000_000;
const DEG = Math.PI / 180;

// ---------------------------------------------------------------- state
const defaultSettings = () => ({
  bpu: 1, stretch: [1, 1, 1], keepProp: true,
  slabs: true, topSlabs: true, stairs: true, stairCorners: true, hollow: false, threshold: 0.5, quality: 'normal', auto: true,
});
const defaultRepeat = () => ({ count: 1, axis: 'z', spacing: 6 });
const AXES = { x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] };

let shapes = [];
let settings = defaultSettings();
let built = new Set();
let selectedId = null;
let nextId = 1;
let view = 'design';
let voxels = null, summary = null;
let layer = 0;
let stamps = [];          // stamp library (part of the project)
let overlayOn = false;    // show converted blocks over the shapes in Design view
let overlayGroup = null;
let palettes = clonePresets(); // block palettes with gradients (part of the project)
let profiles = [];             // saved wall styles (part of the project)
let soloGroup = null;          // show/convert only this part (not saved)
let selectedGroup = null;      // part selected for moving as a whole
const collapsed = new Set();   // collapsed parts in the list (UI only)
let palRev = 0;                // bumps when palettes change so walls regenerate

// Stamps and walls are block-exact: they are pasted block-for-block instead of converted.
const isExact = (s) => s.type === 'stamp' || s.type === 'wall';
// shape is shown and converted (visible, and in the solo part if one is soloed)
const active = (s) => s.visible && (!soloGroup || (s.group || '') === soloGroup);
const wallCache = new Map();
function exactStamp(s) {
  if (s.type === 'stamp') return stampById(s.stampId);
  const k = JSON.stringify(s.wall) + '|' + palRev;
  const c = wallCache.get(s.id);
  if (c && c.k === k) return c.st;
  const st = wallToStamp(s.wall, palettes);
  st.rev = k;
  wallCache.set(s.id, { k, st });
  return st;
}
const exactKey = (s) => (s.type === 'stamp' ? `${s.stampId}|${(stampById(s.stampId) || {}).rev}` : `wall|${s.id}|${JSON.stringify(s.wall)}|${palRev}`);

const stampById = (id) => stamps.find((t) => t.id === id) || null;
// design units per block (stamps are block-exact, so they need this to size their mesh)
const stampUnit = () => 1 / settings.bpu;

function makeShape(type, over = {}) {
  const def = typeDef(type);
  const n = shapes.filter((s) => s.type === type).length + 1;
  return {
    id: nextId++, type, name: `${def.label} ${n}`, mode: 'add', material: 'stone', visible: true,
    position: [0, def.scale[1] / 2, 0], rotation: [0, 0, 0], scale: [...def.scale],
    params: defaultParams(type), repeat: defaultRepeat(), ...over,
  };
}

function defaultProject() {
  nextId = 1; shapes = [];
  shapes.push(makeShape('cylinder', { name: 'Tower', material: 'stone_bricks', position: [0, 10, 0], scale: [12, 20, 12] }));
  shapes.push(makeShape('dome', { name: 'Roof', material: 'spruce', position: [0, 25, 0], scale: [16, 10, 16] }));
  shapes.push(makeShape('torus', { name: 'Ring', material: 'smooth_stone', position: [0, 19.2, 0], scale: [15.2, 15.2, 15.2] }));
  shapes.push(makeShape('cylinder', { name: 'Hollow inside', mode: 'sub', position: [0, 11, 0], scale: [8.8, 18, 8.8] }));
  shapes.push(makeShape('box', { name: 'Door', mode: 'sub', position: [0, 3, 6], scale: [4, 6, 5] }));
  settings = defaultSettings();
  built = new Set();
}

// ---------------------------------------------------------------- three.js setup
const canvas = $('three-canvas');
const viewport = $('viewport');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 4000);
camera.position.set(20, 18, 26);
const orbit = new OrbitControls(camera, canvas);
orbit.target.set(0, 6, 0);
orbit.enableDamping = true;

scene.add(new THREE.HemisphereLight(0xffffff, 0x444455, 1.3));
const sun = new THREE.DirectionalLight(0xffffff, 1.8);
sun.position.set(12, 25, 9);
scene.add(sun);

let grid = null;
function makeGrid() {
  if (grid) { scene.remove(grid); grid.geometry.dispose(); }
  const light = document.documentElement.dataset.resolvedTheme === 'light';
  grid = new THREE.GridHelper(80, 80, light ? 0x9aa0aa : 0x3d4350, light ? 0xd0d4da : 0x262a32);
  scene.add(grid);
}

const shapeGroup = new THREE.Group();
scene.add(shapeGroup);
const boundsHelper = new THREE.Box3Helper(new THREE.Box3(), 0x5cc96b);
boundsHelper.visible = false;
scene.add(boundsHelper);

const tc = new TransformControls(camera, canvas);
tc.setTranslationSnap(0.5); tc.setRotationSnap(15 * DEG); tc.setScaleSnap(0.25);
scene.add(tc);
tc.addEventListener('dragging-changed', (e) => { orbit.enabled = !e.value; });
tc.addEventListener('objectChange', () => {
  if (selectedGroup) { moveGroupFromPivot(); return; }
  const s = selected();
  if (!s) return;
  readMesh(s);
  if (tc.mode === 'scale' && dragStart && s.rotation[0] === 0 && s.rotation[2] === 0 && !isExact(s)) {
    s.position[1] = Math.round((dragStart.base + Math.abs(s.scale[1]) / 2) * 1000) / 1000;
    meshes.get(s.id).position.y = s.position[1];
    syncMesh(s);
  }
  fillProps();
  updateDims();
});
tc.addEventListener('mouseUp', () => commit());
// Stretching keeps the bottom of an upright shape where it is, so a roof stays on its pillars.
let dragStart = null;
tc.addEventListener('mouseDown', () => {
  const s = selected();
  dragStart = s ? { base: s.position[1] - Math.abs(s.scale[1]) / 2 } : null;
});

const blockView = new BlockView(canvas);
const layerView = new LayerView($('layer-canvas'), $('tooltip'));

const meshes = new Map();

function buildMesh(s) {
  const mesh = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshStandardMaterial({ roughness: 0.85 }));
  mesh.userData.id = s.id;
  const edges = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ transparent: true, opacity: 0.5 }));
  edges.raycast = () => {};
  mesh.add(edges);
  mesh.userData.edges = edges;
  mesh.userData.copies = [];
  shapeGroup.add(mesh);
  meshes.set(s.id, mesh);
  syncMesh(s);
  return mesh;
}

function disposeMesh(mesh) {
  shapeGroup.remove(mesh);
  for (const c of mesh.userData.copies) shapeGroup.remove(c);
  if (!isSharedGeometry(mesh.geometry)) mesh.geometry.dispose();
  mesh.userData.edges.geometry.dispose();
  mesh.material.dispose();
  mesh.userData.edges.material.dispose();
}

// Offsets (world space) of each repeated copy, including the original at index 0.
function repeatOffsets(s) {
  const r = s.repeat || defaultRepeat();
  const n = Math.max(1, Math.min(200, Math.round(r.count || 1)));
  const ax = AXES[r.axis] || AXES.z;
  return Array.from({ length: n }, (_, i) => ax.map((v) => v * i * (r.spacing || 0)));
}

function syncMesh(s) {
  const mesh = meshes.get(s.id);
  if (!mesh) return;
  const stamp = isExact(s) ? exactStamp(s) : null;
  const key = isExact(s) ? `exact|${exactKey(s)}|${stampUnit()}` : geometryKey(s);
  if (mesh.userData.geoKey !== key) {
    if (mesh.userData.geoKey && !isSharedGeometry(mesh.geometry)) mesh.geometry.dispose();
    mesh.geometry = isExact(s)
      ? stampGeometry(stamp || { size: [1, 1, 1], blocks: {} }, stampUnit())
      : buildGeometry(s);
    mesh.userData.edges.geometry.dispose();
    mesh.userData.edges.geometry = new THREE.EdgesGeometry(mesh.geometry, 25);
    mesh.userData.geoKey = key;
    for (const c of mesh.userData.copies) c.geometry = mesh.geometry;
  }
  mesh.position.fromArray(s.position);
  mesh.rotation.set(s.rotation[0] * DEG, s.rotation[1] * DEG, s.rotation[2] * DEG);
  mesh.scale.fromArray(s.scale);
  mesh.visible = active(s);
  const m = mesh.material, e = mesh.userData.edges.material;
  const sel = s.id === selectedId || (!!selectedGroup && (s.group || '') === selectedGroup);
  if (s.mode === 'sub') {
    m.color.set(0xff5a5a); m.transparent = true; m.opacity = 0.28; m.depthWrite = false;
    mesh.renderOrder = 2;
    e.color.set(sel ? 0xffc94a : 0xff5a5a); e.opacity = 0.9;
  } else {
    const isStamp = isExact(s);
    if (m.vertexColors !== isStamp) { m.vertexColors = isStamp; }
    m.color.set(isStamp ? 0xffffff : BLOCKS[blockIndex(s.material)].color);
    // with the block overlay on, shapes become faint ghosts
    m.transparent = overlayOn; m.opacity = overlayOn ? 0.12 : 1; m.depthWrite = !overlayOn;
    mesh.renderOrder = 0;
    e.color.set(sel ? 0xffc94a : 0x000000); e.opacity = sel ? 1 : overlayOn ? 0.15 : isStamp ? 0.1 : 0.25;
  }
  m.emissive.set(sel ? 0x2a2000 : 0x000000);
  m.needsUpdate = true;
  syncCopies(s, mesh);
}

function syncCopies(s, mesh) {
  const offs = repeatOffsets(s).slice(1);
  const copies = mesh.userData.copies;
  while (copies.length > offs.length) shapeGroup.remove(copies.pop());
  while (copies.length < offs.length) {
    const c = new THREE.Mesh(mesh.geometry, mesh.material);
    c.userData.id = s.id;
    c.renderOrder = mesh.renderOrder;
    shapeGroup.add(c);
    copies.push(c);
  }
  offs.forEach((o, i) => {
    const c = copies[i];
    c.position.set(s.position[0] + o[0], s.position[1] + o[1], s.position[2] + o[2]);
    c.rotation.copy(mesh.rotation);
    c.scale.copy(mesh.scale);
    c.visible = active(s);
    c.renderOrder = mesh.renderOrder;
  });
}

// World matrices for the shape and all its repeated copies.
function shapeMatrices(s) {
  const mesh = meshes.get(s.id);
  mesh.updateMatrixWorld(true);
  return repeatOffsets(s).map((o) => new THREE.Matrix4().makeTranslation(o[0], o[1], o[2]).multiply(mesh.matrixWorld));
}

function shapeBoxes(s) {
  const mesh = meshes.get(s.id);
  if (isExact(s)) {
    // full stamp footprint, even where the outer blocks are thin (trapdoors, lanterns...)
    const st = exactStamp(s), u = stampUnit();
    const [W, H, D] = st ? st.size : [1, 1, 1];
    const local = new THREE.Box3(new THREE.Vector3(-W / 2 * u, 0, -D / 2 * u), new THREE.Vector3(W / 2 * u, H * u, D / 2 * u));
    return shapeMatrices(s).map((m) => local.clone().applyMatrix4(m));
  }
  if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
  return shapeMatrices(s).map((m) => {
    // precise box: transform the vertices
    const box = new THREE.Box3();
    const pos = mesh.geometry.attributes.position, v = new THREE.Vector3();
    for (let i = 0; i < pos.count; i++) box.expandByPoint(v.fromBufferAttribute(pos, i).applyMatrix4(m));
    return box;
  });
}

function readMesh(s) {
  const mesh = meshes.get(s.id);
  const r3 = (v) => Math.round(v * 1000) / 1000;
  s.position = mesh.position.toArray().map(r3);
  s.rotation = [mesh.rotation.x, mesh.rotation.y, mesh.rotation.z].map((v) => r3(v / DEG));
  s.scale = mesh.scale.toArray().map(r3);
  if (isExact(s)) normalizeStamp(s);
}

// stamps only turn in 90° steps around y and never stretch
function normalizeStamp(s) {
  s.rotation = [0, ((Math.round(s.rotation[1] / 90) * 90) % 360 + 360) % 360, 0];
  s.scale = [1, 1, 1];
}

function rebuildMeshes() {
  tc.detach();
  for (const m of meshes.values()) disposeMesh(m);
  meshes.clear();
  shapes.forEach(buildMesh);
  if (selected()) tc.attach(meshes.get(selectedId)); else selectedId = null;
}

const selected = () => shapes.find((s) => s.id === selectedId) || null;

// ---------------------------------------------------------------- bounds & size
function computeBounds() {
  const box = new THREE.Box3();
  for (const s of shapes) {
    if (!active(s) || s.mode !== 'add') continue;
    for (const b of shapeBoxes(s)) box.union(b);
  }
  return box;
}

// Convert the legacy continuous "fit" setting into the equivalent fixed scale.
function migrateFit() {
  if (!settings.sizeMode && settings.stretch) return;
  if (settings.sizeMode === 'fit' && settings.fitDims) {
    const box = computeBounds();
    if (!box.isEmpty()) {
      const sz = box.getSize(new THREE.Vector3()).toArray().map((v) => Math.max(v, 1e-6));
      if (settings.keepProp !== false) {
        const ax = settings.fitAxis ?? 1;
        settings.bpu = Math.round((settings.fitDims[ax] / sz[ax]) * 1000) / 1000;
        settings.stretch = [1, 1, 1];
      } else {
        const sc = settings.fitDims.map((d, i) => d / sz[i]);
        settings.bpu = Math.round(sc[1] * 1000) / 1000;
        settings.stretch = sc.map((v) => Math.round((v / settings.bpu) * 1000) / 1000);
      }
    }
  }
  settings.stretch = settings.stretch || [1, 1, 1];
  delete settings.sizeMode; delete settings.fitDims; delete settings.fitAxis;
}

function scaleFor(size) {
  const sz = size.toArray().map((v) => Math.max(v, 1e-6));
  // Old projects used a "fit" mode that re-fitted the whole build on every edit
  // (so a taller roof made the pillars thinner). The scale is now fixed: typing a
  // size rescales once, then edits only change the shapes you touch.
  const st = settings.stretch || [1, 1, 1];
  return st.map((k) => settings.bpu * k);
}

function dimsFor(box) {
  if (box.isEmpty()) return null;
  const size = box.getSize(new THREE.Vector3());
  const sc = scaleFor(size);
  return size.toArray().map((v, i) => Math.max(1, Math.round(v * sc[i])));
}

function updateDims() {
  const box = computeBounds();
  const dims = dimsFor(box);
  boundsHelper.box.copy(box);
  boundsHelper.visible = !!dims && $('show-bounds').checked && view === 'design';
  ['dim-w', 'dim-h', 'dim-d'].forEach((id, i) => {
    if (document.activeElement !== $(id)) $(id).value = dims ? dims[i] : '';
  });
  // fractional scales turn 1-unit pillars into a mix of 1- and 2-block columns
  const uneven = scaleFor(new THREE.Vector3(1, 1, 1)).some((v) => Math.abs(v * 2 - Math.round(v * 2)) > 1e-6);
  $('scale-warn').hidden = !uneven;
  const help = $('help');
  if (!dims) help.textContent = 'Add a solid shape to get started';
  else {
    const cells = dims[0] * dims[1] * dims[2];
    help.textContent = `Build volume ${dims[0]} × ${dims[1]} × ${dims[2]} blocks` + (cells > MAX_CELLS ? ' — too large, reduce the size' : '') +
      (view === 'design' ? '  ·  drag to orbit · right-drag pan · click to select' : view === 'blocks' ? '  ·  drag to orbit' : '  ·  drag to pan · wheel to zoom');
  }
  return dims;
}

// ---------------------------------------------------------------- conversion (Web Worker)
let worker = null, jobId = 0, busy = false, convertTimer = 0, lastDims = null;

function scheduleConvert() {
  if (!settings.auto && view === 'design') return;
  clearTimeout(convertTimer);
  convertTimer = setTimeout(convert, 200);
}

function convert() {
  clearTimeout(convertTimer);
  const box = computeBounds();
  const dims = dimsFor(box);
  if (!dims) { setVoxels(null); return; }
  if (dims[0] * dims[1] * dims[2] > MAX_CELLS) { $('help').textContent = 'Build volume too large to convert — lower the size.'; return; }
  const size = box.getSize(new THREE.Vector3()).toArray();
  const job = {
    dims,
    origin: box.min.toArray(),
    cell: size.map((v, i) => v / dims[i]),
    shapes: shapes.filter((s) => active(s) && !isExact(s)).flatMap((s) => {
      const boxes = shapeBoxes(s);
      const params = voxelParams(s);
      return shapeMatrices(s).map((m, i) => {
        const bb = boxes[i].expandByScalar(1e-4);
        return {
          type: s.type, add: s.mode === 'add', mat: blockIndex(s.material), params, join: !!params.join,
          inv: Array.from(m.clone().invert().elements),
          aabb: [...bb.min.toArray(), ...bb.max.toArray()],
        };
      });
    }),
    options: {
      slabs: settings.slabs, topSlabs: settings.topSlabs, hollow: settings.hollow,
      stairs: settings.stairs, stairCorners: settings.stairCorners, stairMats: BLOCKS.map((b) => !!b.stairs),
      threshold: settings.threshold, quality: settings.quality, materialCount: BLOCKS.length,
    },
  };
  addStampCells(job);
  if (busy && worker) { worker.terminate(); worker = null; }
  if (!worker) {
    worker = new Worker(new URL('./voxel-worker.js', import.meta.url), { type: 'module' });
    worker.onmessage = onWorkerMessage;
    worker.onerror = (e) => { busy = false; $('progress').hidden = true; console.error(e); $('help').textContent = 'Conversion failed: ' + (e.message || 'worker error'); };
  }
  busy = true;
  const id = ++jobId;
  jobGeom = { id, origin: job.origin, cell: job.cell };
  $('progress').hidden = false; $('progress').firstElementChild.style.width = '0%';
  worker.postMessage({ id, job });
}

let jobGeom = null;

// Stamps are pasted block-for-block into the grid after conversion.
function addStampCells(job) {
  const custom = [], index = new Map();
  const palette = (st) => {
    let i = index.get(st);
    if (i === undefined) { i = Math.min(65535, custom.length); if (custom.length < 65536) custom.push(st); index.set(st, i); }
    return i;
  };
  const grid = { origin: job.origin, cell: job.cell, dims: job.dims };
  const cells = [];
  const v = new THREE.Vector3();
  for (const s of shapes) {
    if (!isExact(s) || !active(s)) continue;
    const st = exactStamp(s);
    if (!st) continue;
    const u = stampUnit();
    // three.js +90° about y turns east toward north (counter-clockwise from above)
    const turns = ((4 - Math.round(s.rotation[1] / 90)) % 4 + 4) % 4;
    for (const M of shapeMatrices(s)) {
      const placement = {
        turns,
        toWorld: (lx, ly, lz) => { v.set((lx - st.size[0] / 2) * u, ly * u, (lz - st.size[2] / 2) * u).applyMatrix4(M); return [v.x, v.y, v.z]; },
      };
      const out = stampCells(st, placement, grid, palette);
      for (let i = 0; i < out.length; i++) cells.push(out[i]);
    }
  }
  job.custom = custom;
  job.stampCells = cells;
}

function onWorkerMessage(e) {
  const d = e.data;
  if (d.id !== jobId) return;
  if (d.progress !== undefined) { $('progress').firstElementChild.style.width = (d.progress * 100).toFixed(0) + '%'; return; }
  busy = false;
  $('progress').hidden = true;
  if (d.error) { $('help').textContent = 'Conversion failed: ' + d.error; return; }
  if (jobGeom && jobGeom.id === d.id) { d.result.origin = jobGeom.origin; d.result.cell = jobGeom.cell; }
  setVoxels(d.result);
}

function setVoxels(v) {
  voxels = v;
  if (!v) {
    summary = null;
    renderMaterials(); updateLayerUI(); updateOverlay();
    return;
  }
  summary = summarize(v, BLOCKS.length);
  const refit = !lastDims || lastDims.join() !== [v.W, v.H, v.D].join();
  lastDims = [v.W, v.H, v.D];
  layer = Math.min(layer, v.H - 1);
  $('layer-slider').max = v.H - 1;
  blockView.setVoxels(v, refit);
  blockView.setLayer($('layer-all').checked ? v.H - 1 : layer);
  layerView.setVoxels(v);
  layerView.setLayer(layer);
  updateSliceUI();
  updateOverlay();
  updateLayerUI();
  renderMaterials();
}

function updateOverlay() {
  disposeBlockGroup(overlayGroup);
  overlayGroup = null;
  if (!overlayOn || !voxels || !voxels.origin) return;
  overlayGroup = buildBlockGroup(voxels, { colorMode: blockView.colorMode });
  overlayGroup.position.fromArray(voxels.origin);
  overlayGroup.scale.fromArray(voxels.cell);
  scene.add(overlayGroup);
}

function setOverlay(on) {
  overlayOn = on;
  $('show-blocks').checked = on;
  shapes.forEach(syncMesh);
  if (on && !voxels) convert();
  updateOverlay();
}

// ---------------------------------------------------------------- UI: shapes
function renderShapeButtons() {
  const wrap = $('shape-buttons');
  wrap.innerHTML = '';
  for (const t of SHAPE_TYPES) {
    const b = document.createElement('button');
    b.innerHTML = `<b>${t.icon}</b>${t.label}`;
    b.title = `Add ${t.label.toLowerCase()}`;
    b.onclick = () => addShape(t.type);
    wrap.appendChild(b);
  }
}

function addShape(type) {
  const s = makeShape(type);
  // drop it near what the camera is looking at
  s.position[0] = Math.round(orbit.target.x * 2) / 2;
  s.position[2] = Math.round(orbit.target.z * 2) / 2;
  if (selected() && selected().mode === 'add') s.material = selected().material;
  shapes.push(s);
  buildMesh(s);
  select(s.id);
  commit();
}

function shapeRow(s, idx) {
  const li = document.createElement('li');
  li.className = (s.id === selectedId ? 'sel ' : '') + (s.visible ? '' : 'hidden-shape ') + (s.group ? 'in-group' : '');
  const color = s.mode === 'sub' ? 'transparent' : s.type === 'stamp' ? 'linear-gradient(135deg,#7048e8,#b197fc)'
    : s.type === 'wall' ? 'repeating-linear-gradient(0deg,#8a8a8a 0 3px,#6b6b6b 3px 6px)' : BLOCKS[blockIndex(s.material)].color;
  const border = s.mode === 'sub' ? 'border:1px dashed var(--sub)' : '';
  li.innerHTML = `
    <span class="sw" style="background:${color};${border}"></span>
    <span class="nm"></span>
    ${s.mode === 'sub' ? '<span class="badge">carve</span>' : ''}
    <button class="icon-btn" data-act="up" title="Move up">↑</button>
    <button class="icon-btn" data-act="down" title="Move down">↓</button>
    <button class="icon-btn" data-act="vis" title="${s.visible ? 'Hide (excluded from build)' : 'Show'}">${s.visible ? '👁' : '◌'}</button>`;
  li.querySelector('.nm').textContent = s.name;
  li.onclick = (e) => {
    const act = e.target.dataset && e.target.dataset.act;
    if (act === 'vis') { s.visible = !s.visible; syncMesh(s); renderShapeList(); updateDims(); commit(); return; }
    if (act === 'up' && idx > 0) { [shapes[idx - 1], shapes[idx]] = [shapes[idx], shapes[idx - 1]]; renderShapeList(); commit(); return; }
    if (act === 'down' && idx < shapes.length - 1) { [shapes[idx + 1], shapes[idx]] = [shapes[idx], shapes[idx + 1]]; renderShapeList(); commit(); return; }
    if (!act) select(s.id);
  };
  return li;
}

// The list is grouped into parts (Pillars, Walls, Roof...). Each part can be moved,
// turned, hidden, duplicated or soloed as a whole — build pieces separately, then combine.
function renderShapeList() {
  updateGuidance();
  const ul = $('shape-list');
  ul.innerHTML = '';
  if (soloGroup) {
    const li = document.createElement('li');
    li.className = 'solo-banner';
    li.innerHTML = `◎ Showing only <b></b> <button class="icon-btn" title="Show everything">show all</button>`;
    li.querySelector('b').textContent = soloGroup || 'ungrouped';
    li.querySelector('button').onclick = () => setSolo(null);
    ul.appendChild(li);
  }
  if (!shapes.length) { ul.insertAdjacentHTML('beforeend', '<li class="empty">No shapes yet. Add one above.</li>'); return; }
  const order = [], byGroup = new Map();
  shapes.forEach((s, idx) => {
    const g = s.group || '';
    if (!byGroup.has(g)) { byGroup.set(g, []); order.push(g); }
    byGroup.get(g).push([s, idx]);
  });
  for (const g of order) {
    const members = byGroup.get(g);
    if (g) {
      const head = document.createElement('li');
      const anyVisible = members.some(([m]) => m.visible);
      head.className = 'group-head' + (selectedGroup === g ? ' sel' : '') + (soloGroup === g ? ' solo' : '');
      head.innerHTML = `<span class="caret">${collapsed.has(g) ? '▸' : '▾'}</span><span class="nm"></span><small>${members.length}</small>
        <button class="icon-btn" data-gact="move" title="Select the whole part (move it with the gizmo)">✥</button>
        <button class="icon-btn" data-gact="rot" title="Turn the part 90°">⟳</button>
        <button class="icon-btn" data-gact="dup" title="Duplicate the part">⧉</button>
        <button class="icon-btn" data-gact="solo" title="${soloGroup === g ? 'Show everything' : 'Show only this part'}">◎</button>
        <button class="icon-btn" data-gact="vis" title="${anyVisible ? 'Hide part' : 'Show part'}">${anyVisible ? '👁' : '◌'}</button>`;
      head.querySelector('.nm').textContent = g;
      head.onclick = (e) => {
        const act = e.target.dataset && e.target.dataset.gact;
        if (act === 'move') selectGroup(g);
        else if (act === 'rot') rotateGroup(g);
        else if (act === 'dup') duplicateGroup(g);
        else if (act === 'solo') setSolo(soloGroup === g ? null : g);
        else if (act === 'vis') { members.forEach(([m]) => { m.visible = !anyVisible; syncMesh(m); }); renderShapeList(); commit(); }
        else { if (collapsed.has(g)) collapsed.delete(g); else collapsed.add(g); renderShapeList(); }
      };
      ul.appendChild(head);
      if (collapsed.has(g)) continue;
    }
    for (const [m, idx] of members) ul.appendChild(shapeRow(m, idx));
  }
  const dl = $('group-list');
  if (dl) dl.innerHTML = order.filter(Boolean).map((g) => `<option value="${g.replace(/"/g, '&quot;')}"></option>`).join('');
}

// ---- parts (groups)
const groupPivot = new THREE.Object3D();
scene.add(groupPivot);
let pivotLast = new THREE.Vector3();
const groupMembers = (g) => shapes.filter((s) => (s.group || '') === g);
function groupBox(g) {
  const box = new THREE.Box3();
  for (const s of groupMembers(g)) for (const b of shapeBoxes(s)) box.union(b);
  return box;
}
function selectGroup(g) {
  selectedId = null;
  selectedGroup = g;
  shapes.forEach(syncMesh);
  const box = groupBox(g);
  if (!box.isEmpty()) box.getCenter(groupPivot.position);
  pivotLast.copy(groupPivot.position);
  setGizmo('translate');
  if (view === 'design') tc.attach(groupPivot);
  renderShapeList(); fillProps();
}
function moveGroupFromPivot() {
  const d = groupPivot.position.clone().sub(pivotLast);
  if (!d.lengthSq()) return;
  for (const s of groupMembers(selectedGroup)) {
    s.position = s.position.map((v, i) => Math.round((v + d.getComponent(i)) * 1000) / 1000);
    syncMesh(s);
  }
  pivotLast.copy(groupPivot.position);
  updateDims();
}
// Turn a part 90° clockwise (seen from above) around its center, snapped to whole blocks.
function rotateGroup(g) {
  const box = groupBox(g);
  if (box.isEmpty()) return;
  const u = 1 / settings.bpu;
  const c = box.getCenter(new THREE.Vector3());
  c.x = Math.round(c.x / u) * u; c.z = Math.round(c.z / u) * u;
  for (const s of groupMembers(g)) {
    const dx = s.position[0] - c.x, dz = s.position[2] - c.z;
    // clockwise from above: +x (east) -> +z (south)
    s.position[0] = c.x - dz; s.position[2] = c.z + dx;
    s.rotation[1] = ((s.rotation[1] - 90) % 360 + 360) % 360;
    if (s.repeat && s.repeat.axis !== 'y') {
      // keep repeat rows following the turn
      if (s.repeat.axis === 'x') s.repeat = { ...s.repeat, axis: 'z' };
      else s.repeat = { ...s.repeat, axis: 'x', spacing: -s.repeat.spacing };
    }
    syncMesh(s);
  }
  if (selectedGroup === g) selectGroup(g);
  renderShapeList(); commit();
}
function duplicateGroup(g) {
  const box = groupBox(g);
  const shift = box.isEmpty() ? 4 : Math.ceil(box.max.x - box.min.x) + 2;
  let name = g + ' copy', n = 2;
  while (shapes.some((s) => s.group === name)) name = `${g} copy ${n++}`;
  for (const s of groupMembers(g)) {
    const c = JSON.parse(JSON.stringify(s));
    c.id = nextId++; c.group = name; c.position[0] += shift;
    shapes.push(c);
    buildMesh(c);
  }
  renderShapeList(); commit();
}
function setSolo(g) {
  soloGroup = g;
  shapes.forEach(syncMesh);
  renderShapeList(); updateDims(); scheduleConvert();
}

function select(id) {
  const prev = selectedId;
  selectedId = id;
  if (selectedGroup) { selectedGroup = null; shapes.forEach(syncMesh); }
  for (const s of shapes) if (s.id === prev || s.id === id) syncMesh(s);
  const s = selected();
  if (s && view === 'design') tc.attach(meshes.get(s.id)); else tc.detach();
  const snapOn = $('snap').checked;
  tc.setRotationSnap(s && isExact(s) ? 90 * DEG : snapOn ? 15 * DEG : null);
  if (s && isExact(s)) { tc.showX = tc.mode !== 'rotate'; tc.showZ = tc.mode !== 'rotate'; if (tc.mode === 'scale') setGizmo('translate'); }
  else { tc.showX = true; tc.showZ = true; }
  renderShapeList();
  renderParams();
  fillProps();
  // bring the settings of what was just selected into view
  if (s) requestAnimationFrame(() => $('props').scrollIntoView({ block: 'nearest', behavior: 'smooth' }));
}

// Per-shape parameter controls (thickness, roundness, ...)
function renderParams() {
  const wrap = $('p-params');
  const s = selected();
  wrap.innerHTML = '';
  wrap.dataset.for = s ? s.id + s.type : '';
  if (!s || isExact(s)) return;
  if (s.type === 'vault') wrap.appendChild(vaultControls(s));
  for (const d of typeDef(s.type).params || []) {
    const row = document.createElement('div');
    row.className = 'param';
    if (d.type === 'bool') {
      row.innerHTML = `<label class="chk"><input type="checkbox" data-param="${d.key}" /> ${d.label}</label>` + (d.hint ? `<small>${d.hint}</small>` : '');
      const el = row.querySelector('input');
      el.addEventListener('change', () => {
        s.params = { ...defaultParams(s.type), ...(s.params || {}), [d.key]: el.checked };
        commit();
      });
      wrap.appendChild(row);
      continue;
    }
    const isRange = d.max - d.min <= 10;
    row.innerHTML = `<div class="top"><span>${d.label}</span><input type="number" min="${d.min}" max="${d.max}" step="${d.step}" data-param="${d.key}" /></div>` +
      (isRange ? `<input type="range" min="${d.min}" max="${d.max}" step="${d.step}" data-param="${d.key}" />` : '') +
      (d.hint ? `<small>${d.hint}</small>` : '');
    row.querySelectorAll('[data-param]').forEach((el) => {
      el.addEventListener('input', () => {
        const v = parseFloat(el.value);
        if (!Number.isFinite(v)) return;
        s.params = { ...defaultParams(s.type), ...(s.params || {}), [d.key]: Math.min(d.max, Math.max(d.min, v)) };
        row.querySelectorAll('[data-param]').forEach((o) => { if (o !== el) o.value = v; });
        syncMesh(s); updateDims();
      });
      el.addEventListener('change', () => commit());
    });
    wrap.appendChild(row);
  }
}

// Roof controls for a vault, all in BLOCKS (the arch alone, pillars not included).
// Rise keeps the base where it is (so the roof stays on its pillars); length grows from
// the start of the roof; "keep ratio" makes the rise follow the span.
const blockScale = () => scaleFor(new THREE.Vector3(1, 1, 1)); // blocks per design unit, per axis
const roundHalf = (v) => Math.round(v * 2) / 2;

function vaultControls(s) {
  const box = document.createElement('div');
  box.className = 'vault-box';
  box.innerHTML = `
    <div class="roof-size" data-vault="summary"></div>
    <div class="param"><div class="top"><span>Span <small>(width, blocks)</small></span><input type="number" min="1" max="400" step="1" data-vault="span" /></div>
      <input type="range" min="3" max="120" step="1" data-vault="span" /></div>
    <div class="param"><div class="top"><span>Rise <small>(arch height only, blocks)</small></span><input type="number" min="0.5" max="200" step="0.5" data-vault="rise" /></div>
      <input type="range" min="1" max="60" step="0.5" data-vault="rise" /></div>
    <div class="param"><div class="top"><span>Length <small>(blocks)</small></span><input type="number" min="1" max="1000" step="1" data-vault="length" /></div>
      <input type="range" min="3" max="200" step="1" data-vault="length" /></div>
    <div class="ratio-row"><span>rise / span <b data-vault="ratio"></b></span>
      <button type="button" data-ratio="0.5" title="Semicircle">½</button><button type="button" data-ratio="0.3333" title="Squashed">⅓</button><button type="button" data-ratio="0.25" title="Flat">¼</button>
      <label class="chk" title="Changing the span also scales the rise"><input type="checkbox" data-vault="lock" /> keep ratio</label></div>
    <div class="sub-h">Connect another roof</div>
    <div class="btn-row">
      <button type="button" data-connect="cross" title="A second vault crossing this one at 90° (groin vault)">✚ Crossing 90°</button>
      <button type="button" data-connect="branch" title="A vault leaving this one at 90° from its center (T-junction)">⊢ Branch 90°</button>
    </div>
    <small>Roofs with "Join with other roofs" on merge automatically: change either roof's rise, span or shape and the intersection follows.</small>`;
  const base = () => s.position[1] - Math.abs(s.scale[1]) / 2;
  const setRise = (blocks) => {
    const b = base();
    s.scale[1] = Math.max(0.5, blocks) / blockScale()[1];
    s.position[1] = b + s.scale[1] / 2;
  };
  const setSpan = (blocks) => {
    const sc = blockScale();
    const ratio = (Math.abs(s.scale[1]) * sc[1]) / (Math.abs(s.scale[0]) * sc[0]);
    s.scale[0] = (Math.max(1, blocks) / sc[0]) * Math.sign(s.scale[0] || 1);
    if (s.params && s.params.lockRatio) setRise(roundHalf(blocks * ratio));
  };
  const setLength = (blocks) => {
    // keep the start of the roof fixed and grow along its own length axis
    const old = Math.abs(s.scale[2]);
    const len = Math.max(1, blocks) / blockScale()[2];
    const a = s.rotation[1] * DEG, d = (len - old) / 2;
    s.scale[2] = len * Math.sign(s.scale[2] || 1);
    s.position[0] += Math.sin(a) * d;
    s.position[2] += Math.cos(a) * d;
  };
  const wire = (name, fn) => box.querySelectorAll(`[data-vault="${name}"]`).forEach((el) => {
    el.addEventListener('input', () => { const v = parseFloat(el.value); if (Number.isFinite(v)) { fn(v); syncMesh(s); fillProps(); updateDims(); } });
    el.addEventListener('change', () => commit());
  });
  wire('span', setSpan);
  wire('rise', setRise);
  wire('length', setLength);
  box.querySelectorAll('[data-ratio]').forEach((b) => b.onclick = () => {
    const spanBlocks = Math.abs(s.scale[0]) * blockScale()[0];
    setRise(roundHalf(spanBlocks * parseFloat(b.dataset.ratio)));
    syncMesh(s); fillProps(); commit();
  });
  box.querySelector('[data-vault="lock"]').onchange = (e) => { s.params = { ...(s.params || {}), lockRatio: e.target.checked }; commit(); };
  box.querySelectorAll('[data-connect]').forEach((b) => b.onclick = () => connectVault(s, b.dataset.connect));
  return box;
}

// Fill the vault controls with the selected roof's size in blocks.
function fillVaultControls(s) {
  const sc = blockScale();
  const span = roundHalf(Math.abs(s.scale[0]) * sc[0]);
  const rise = roundHalf(Math.abs(s.scale[1]) * sc[1]);
  const length = roundHalf(Math.abs(s.scale[2]) * sc[2]);
  const set = (el, v) => { if (document.activeElement !== el) el.value = v; };
  document.querySelectorAll('[data-vault="span"]').forEach((el) => set(el, span));
  document.querySelectorAll('[data-vault="rise"]').forEach((el) => set(el, rise));
  document.querySelectorAll('[data-vault="length"]').forEach((el) => set(el, length));
  const r = document.querySelector('[data-vault="ratio"]');
  if (r) r.textContent = (rise / span).toFixed(2);
  const lock = document.querySelector('[data-vault="lock"]');
  if (lock) lock.checked = !!(s.params && s.params.lockRatio);
  const sum = document.querySelector('[data-vault="summary"]');
  if (sum) {
    const box = computeBounds();
    const baseY = box.isEmpty() ? 0 : roundHalf((s.position[1] - Math.abs(s.scale[1]) / 2 - box.min.y) * sc[1]);
    const thick = (s.params && s.params.thickness) || 0;
    sum.innerHTML = `<b>Roof only:</b> ${span} wide × ${rise} high × ${length} long<br>` +
      `<small>arch starts at y = ${baseY}, crown at y = ${baseY + rise}${thick ? ` · shell ${thick} thick` : ''}</small>`;
  }
}

// Add a second vault at 90°: a full crossing through the center, or a branch from the center outward.
function connectVault(s, kind) {
  const span = Math.abs(s.scale[0]), rise = Math.abs(s.scale[1]);
  const base = s.position[1] - rise / 2;
  const rotY = s.rotation[1] * DEG;
  // this vault's local x axis (across its span) in world space
  const ax = [Math.cos(rotY), 0, -Math.sin(rotY)];
  const length = kind === 'cross' ? span * 3 : span * 1.5;
  const off = kind === 'cross' ? 0 : length / 2;
  s.params = { ...defaultParams('vault'), ...(s.params || {}), join: true };
  const c = makeShape('vault', {
    name: kind === 'cross' ? `${s.name} crossing` : `${s.name} branch`,
    material: s.material,
    position: [s.position[0] + ax[0] * off, base + rise / 2, s.position[2] + ax[2] * off],
    rotation: [0, ((s.rotation[1] + 90) % 360), 0],
    scale: [span, rise, length],
    params: { ...defaultParams('vault'), ...s.params, join: true, lockRatio: false },
  });
  shapes.splice(shapes.indexOf(s) + 1, 0, c);
  buildMesh(c);
  select(c.id);
  commit();
}

function fillProps() {
  const s = selected();
  $('props').hidden = !s;
  if (!s) return;
  if ($('p-params').dataset.for !== s.id + s.type) renderParams();
  const set = (el, v) => { if (document.activeElement !== el) el.value = v; };
  set($('p-name'), s.name);
  $('props').classList.toggle('is-stamp', isExact(s));
  if (isExact(s)) {
    const st = exactStamp(s);
    $('p-stamp-label').textContent = s.type === 'wall' ? 'Wall' : 'Stamp';
    $('p-stamp-name').textContent = s.type === 'wall'
      ? `${s.wall.length} long × ${s.wall.height} high × ${s.wall.profile.depth} deep`
      : st ? `${st.name} (${st.size.join(' × ')})` : 'missing stamp';
  }
  set($('p-group'), s.group || '');
  $('p-mode').value = s.mode;
  $('p-mat').value = s.material;
  $('p-mat').disabled = s.mode === 'sub';
  document.querySelectorAll('[data-vec]').forEach((el) => set(el, s[el.dataset.vec][+el.dataset.i]));
  const p = { ...defaultParams(s.type), ...(s.params || {}) };
  document.querySelectorAll('#p-params [data-param]').forEach((el) => { if (el.type === 'checkbox') el.checked = !!p[el.dataset.param]; else set(el, p[el.dataset.param]); });
  if (s.type === 'vault') fillVaultControls(s);
  const r = s.repeat || defaultRepeat();
  set($('r-count'), r.count); $('r-axis').value = r.axis; set($('r-spacing'), r.spacing);
}

function initProps() {
  const sel = $('p-mat');
  for (const b of BLOCKS) {
    const o = document.createElement('option');
    o.value = b.id; o.textContent = b.name;
    sel.appendChild(o);
  }
  $('p-name').addEventListener('input', (e) => { const s = selected(); if (s) { s.name = e.target.value; renderShapeList(); } });
  $('p-name').addEventListener('change', () => commit());
  $('p-mode').addEventListener('change', (e) => { const s = selected(); if (!s) return; s.mode = e.target.value; syncMesh(s); renderShapeList(); fillProps(); updateDims(); commit(); });
  $('p-mat').addEventListener('change', (e) => { const s = selected(); if (!s) return; s.material = e.target.value; syncMesh(s); renderShapeList(); commit(); });
  document.querySelectorAll('[data-vec]').forEach((el) => {
    el.addEventListener('input', () => {
      const s = selected(); if (!s) return;
      const v = parseFloat(el.value);
      if (!Number.isFinite(v)) return;
      if (el.dataset.vec === 'scale' && Math.abs(v) < 0.05) return;
      s[el.dataset.vec][+el.dataset.i] = v;
      if (isExact(s)) normalizeStamp(s);
      syncMesh(s); updateDims();
    });
    el.addEventListener('change', () => commit());
  });
  const repeatInput = () => {
    const s = selected(); if (!s) return;
    const count = Math.max(1, Math.min(200, Math.round(parseFloat($('r-count').value) || 1)));
    const spacing = parseFloat($('r-spacing').value);
    s.repeat = { count, axis: $('r-axis').value, spacing: Number.isFinite(spacing) ? spacing : 0 };
    syncMesh(s); updateDims();
  };
  ['r-count', 'r-axis', 'r-spacing'].forEach((id) => {
    $(id).addEventListener('input', repeatInput);
    $(id).addEventListener('change', () => { repeatInput(); commit(); });
  });
  $('p-edit-stamp').onclick = () => {
    const s = selected(); if (!s) return;
    if (s.type === 'stamp') editStamp(s.stampId);
    if (s.type === 'wall') { wallTarget = s.id; wallEditor.open(s.wall); }
  };
  $('p-group').addEventListener('change', (e) => {
    const s = selected(); if (!s) return;
    s.group = e.target.value.trim();
    renderShapeList(); commit();
  });
  $('p-dup').onclick = () => duplicate(false);
  $('p-mirror').onclick = () => duplicate(true);
  $('p-del').onclick = deleteSelected;
}

function duplicate(mirror) {
  const s = selected(); if (!s) return;
  const c = JSON.parse(JSON.stringify(s));
  c.id = nextId++;
  if (mirror) {
    // reflect across the x = 0 plane: flip x position, x scale, and y/z rotation
    c.name = s.name + ' (mirror)';
    c.position[0] = -c.position[0];
    c.scale[0] = -c.scale[0];
    c.rotation[1] = -c.rotation[1];
    c.rotation[2] = -c.rotation[2];
    if (c.repeat && c.repeat.axis === 'x') c.repeat.spacing = -c.repeat.spacing;
  } else {
    c.name = s.name + ' copy';
    c.position[0] += 1; c.position[2] += 1;
  }
  shapes.splice(shapes.indexOf(s) + 1, 0, c);
  buildMesh(c);
  select(c.id);
  commit();
}

function deleteSelected() {
  const s = selected(); if (!s) return;
  tc.detach();
  disposeMesh(meshes.get(s.id));
  meshes.delete(s.id);
  shapes = shapes.filter((x) => x !== s);
  selectedId = null;
  renderShapeList(); fillProps(); updateDims();
  commit();
}

// ---------------------------------------------------------------- UI: settings
function initSettings() {
  $('bpu').addEventListener('change', (e) => {
    const v = parseFloat(e.target.value);
    if (v > 0) { settings.bpu = v; updateDims(); commit(); }
  });
  $('scale-fix').onclick = () => {
    settings.bpu = Math.max(1, Math.round(settings.bpu));
    settings.stretch = [1, 1, 1];
    applySettingsUI(); updateDims(); commit();
  };
  // typing a size rescales ONCE (sets blocks-per-unit); later edits don't re-fit
  ['dim-w', 'dim-h', 'dim-d'].forEach((id, axis) => $(id).addEventListener('change', (e) => {
    const v = Math.max(1, Math.round(parseFloat(e.target.value) || 1));
    const box = computeBounds();
    if (box.isEmpty()) return;
    const size = Math.max(1e-6, box.getSize(new THREE.Vector3()).getComponent(axis));
    if (settings.keepProp) {
      settings.bpu = Math.round((v / size) * 1000) / 1000;
      settings.stretch = [1, 1, 1];
    } else {
      settings.stretch = [...(settings.stretch || [1, 1, 1])];
      settings.stretch[axis] = Math.round((v / size / settings.bpu) * 1000) / 1000;
    }
    applySettingsUI(); updateDims(); commit();
  }));
  $('keep-prop').onchange = (e) => {
    settings.keepProp = e.target.checked;
    if (settings.keepProp) settings.stretch = [1, 1, 1];
    updateDims(); commit();
  };
  document.querySelectorAll('.presets [data-mult]').forEach((b) => b.onclick = () => {
    const k = parseFloat(b.dataset.mult);
    settings.bpu = Math.round(settings.bpu * k * 1000) / 1000;
    applySettingsUI(); updateDims(); commit();
  });
  const bind = (id, key, conv = (el) => el.checked) => $(id).addEventListener('change', (e) => { settings[key] = conv(e.target); applySettingsUI(); commit(); });
  bind('opt-slabs', 'slabs');
  bind('opt-topslabs', 'topSlabs');
  bind('opt-stairs', 'stairs');
  bind('opt-corners', 'stairCorners');
  bind('opt-hollow', 'hollow');
  bind('opt-quality', 'quality', (el) => el.value);
  bind('opt-auto', 'auto');
  $('opt-threshold').addEventListener('input', (e) => { $('out-threshold').textContent = Math.round(e.target.value * 100) + '%'; });
  bind('opt-threshold', 'threshold', (el) => parseFloat(el.value));
  $('btn-convert').onclick = convert;
}

function applySettingsUI() {
  $('bpu').value = settings.bpu;
  if ($('snap').checked) tc.setTranslationSnap(1 / settings.bpu);
  $('keep-prop').checked = settings.keepProp;
  $('opt-slabs').checked = settings.slabs;
  $('opt-topslabs').checked = settings.topSlabs;
  $('opt-topslabs').disabled = !settings.slabs && !settings.stairs;
  $('opt-stairs').checked = settings.stairs;
  $('opt-corners').checked = settings.stairCorners;
  $('opt-corners').disabled = !settings.stairs;
  $('opt-hollow').checked = settings.hollow;
  $('opt-quality').value = settings.quality;
  $('opt-auto').checked = settings.auto;
  $('opt-threshold').value = settings.threshold;
  $('out-threshold').textContent = Math.round(settings.threshold * 100) + '%';
}

// ---------------------------------------------------------------- UI: layers & materials
function setLayer(y, fromSlider = false) {
  if (!voxels) return;
  layer = Math.max(0, Math.min(voxels.H - 1, y));
  if (fromSlider && view === 'blocks') $('layer-all').checked = false;
  blockView.setLayer($('layer-all').checked ? voxels.H - 1 : layer);
  layerView.setLayer(layer);
  updateLayerUI();
}

function updateLayerUI() {
  const v = voxels;
  $('layer-slider').disabled = !v;
  if (!v) { $('layer-info').textContent = 'Convert to see layers.'; $('layer-y').textContent = ''; return; }
  $('layer-slider').value = layer;
  const pl = summary.perLayer[layer];
  $('layer-y').textContent = `${layer + 1} / ${v.H}`;
  const doneCount = [...built].filter((y) => y < v.H).length;
  $('layer-info').innerHTML = `Layer <b>${layer + 1}</b> (y +${layer}) · <b>${pl.full}</b> blocks · <b>${pl.slab}</b> slabs · <b>${pl.stair}</b> stairs` + (pl.custom ? ` · <b>${pl.custom}</b> stamp blocks` : '') +
    (built.has(layer) ? ' · ✅ built' : '') + `<br><small>${doneCount} of ${v.H} layers marked built</small>`;
  $('layer-built').checked = built.has(layer);
}

function renderMaterials() {
  const ul = $('materials');
  ul.innerHTML = '';
  if (!summary) { $('stats').textContent = ''; return; }
  const { full, slab, stair, perMat, custom = 0 } = summary;
  const raw = full + Math.ceil(slab / 2) + Math.ceil(stair / 4) * 6 + custom;
  $('stats').innerHTML = `<b>${(full + slab + stair + custom).toLocaleString()}</b> pieces · ${full.toLocaleString()} blocks + ${slab.toLocaleString()} slabs + ${stair.toLocaleString()} stairs` + (custom ? ` + ${custom.toLocaleString()} stamp blocks` : '') + '<br>' +
    `≈ ${(raw / 1728).toFixed(2)} shulker boxes of raw blocks`;
  perMat.forEach((m, i) => {
    if (!m.full && !m.slab && !m.stair) return;
    const b = BLOCKS[i];
    const li = document.createElement('li');
    const parts = [];
    if (m.full) parts.push(`${m.full} blocks <small>${stacks(m.full)}</small>`);
    if (m.slab) parts.push(`${m.slab} slabs <small>${stacks(m.slab)} · craft from ${Math.ceil(m.slab / 2)} blocks</small>`);
    if (m.stair) parts.push(`${m.stair} stairs <small>${stacks(m.stair)} · craft from ${Math.ceil(m.stair / 4) * 6} blocks</small>`);
    li.innerHTML = `<span class="sw" style="background:${b.color}"></span><div><b>${b.name}</b><br>${parts.join('<br>')}</div>`;
    ul.appendChild(li);
  });
  for (const [id, n] of [...(summary.perCustom || new Map())].sort((a, b) => b[1] - a[1])) {
    const li = document.createElement('li');
    li.innerHTML = `<span class="sw" style="background:${stateColor(id)}"></span><div><b></b><br>${n} <small>${stacks(n)} · from stamps</small></div>`;
    li.querySelector('b').textContent = id.replace('minecraft:', '').replace(/_/g, ' ');
    ul.appendChild(li);
  }
}

function setSectionMode(mode) {
  layerView.setMode(mode);
  document.querySelectorAll('#section-mode button').forEach((b) => b.classList.toggle('active', b.dataset.mode === mode));
  updateSliceUI();
}

function updateSliceUI() {
  const mode = layerView.mode;
  $('slice-wrap').hidden = mode === 'top';
  if (mode === 'top' || !voxels) return;
  const { N } = viewDims(voxels, mode);
  const k = layerView.slice[mode];
  $('slice-slider').max = N - 1;
  $('slice-slider').value = k;
  $('slice-label').textContent = mode === 'front' ? 'Slice z' : 'Slice x';
  $('slice-out').textContent = `${k} / ${N - 1}`;
}

function setSlice(k) {
  layerView.setSlice(k);
  updateSliceUI();
}

function initLayers() {
  document.querySelectorAll('#section-mode button').forEach((b) => b.onclick = () => setSectionMode(b.dataset.mode));
  $('slice-slider').addEventListener('input', (e) => setSlice(+e.target.value));
  $('slice-down').onclick = () => setSlice(layerView.slice[layerView.mode] - 1);
  $('slice-up').onclick = () => setSlice(layerView.slice[layerView.mode] + 1);
  $('layer-slider').addEventListener('input', (e) => setLayer(+e.target.value, true));
  $('layer-up').onclick = () => setLayer(layer + 1, true);
  $('layer-down').onclick = () => setLayer(layer - 1, true);
  $('layer-built').onchange = (e) => { if (e.target.checked) built.add(layer); else built.delete(layer); updateLayerUI(); save(); };
  $('layer-ghost').onchange = (e) => { layerView.ghost = e.target.checked; layerView.draw(); };
  $('layer-all').onchange = () => { if (voxels) blockView.setLayer($('layer-all').checked ? voxels.H - 1 : layer); };
  $('layer-all').checked = true;
}

// ---------------------------------------------------------------- views
function setView(v) {
  view = v;
  document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.dataset.view === v));
  $('layer-wrap').hidden = v !== 'layers';
  $('gizmo-bar').hidden = v !== 'design';
  $('blocks-bar').hidden = v !== 'blocks';
  $('block-tip').hidden = true;
  blockView.clearPick();
  if (overlayGroup) overlayGroup.visible = v === 'design';
  orbit.enabled = v === 'design';
  blockView.controls.enabled = v === 'blocks';
  tc.enabled = v === 'design';
  if (v === 'design' && selected()) tc.attach(meshes.get(selectedId)); else tc.detach();
  if (v !== 'design' && (!voxels || !settings.auto)) convert();
  if (v === 'layers') { layerView.resize(); }
  updateGuidance();
  updateDims();
}

function initViews() {
  document.querySelectorAll('.tab').forEach((t) => t.onclick = () => setView(t.dataset.view));
  document.querySelectorAll('[data-gizmo]').forEach((b) => b.onclick = () => setGizmo(b.dataset.gizmo));
  $('snap').onchange = (e) => {
    const on = e.target.checked;
    tc.setTranslationSnap(on ? 1 / settings.bpu : null); tc.setRotationSnap(on ? 15 * DEG : null); tc.setScaleSnap(on ? 0.25 : null);
  };
  $('show-bounds').onchange = updateDims;
  $('show-blocks').onchange = (e) => setOverlay(e.target.checked);
  const setColorMode = (m) => {
    blockView.setColorMode(m);
    document.querySelectorAll('#color-mode button').forEach((b) => b.classList.toggle('active', b.dataset.color === m));
    $('shape-legend').hidden = m !== 'shape';
    try { localStorage.setItem('shape-layers:colorMode', m); } catch { /* ignore */ }
    updateOverlay();
  };
  document.querySelectorAll('#color-mode button').forEach((b) => b.onclick = () => setColorMode(b.dataset.color));
  let savedMode = 'material';
  try { savedMode = localStorage.getItem('shape-layers:colorMode') || 'material'; } catch { /* ignore */ }
  setColorMode(savedMode);
  // hover a block in the Blocks view to see exactly what it is
  canvas.addEventListener('pointermove', (e) => {
    if (view !== 'blocks' || e.buttons) { $('block-tip').hidden = true; return; }
    const r = canvas.getBoundingClientRect();
    const hit = blockView.pick(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1));
    const tip = $('block-tip');
    if (!hit) { tip.hidden = true; return; }
    tip.textContent = `${hit.label}  ·  x ${hit.x}, y ${hit.y}, z ${hit.z}`;
    tip.hidden = false;
    tip.style.left = (e.clientX - r.left + 14) + 'px';
    tip.style.top = (e.clientY - r.top + 14) + 'px';
  });
  canvas.addEventListener('pointerleave', () => { $('block-tip').hidden = true; blockView.clearPick(); });
  $('btn-undo').onclick = undo;
  $('btn-redo').onclick = redo;
  $('btn-frame').onclick = frameDesign;

  // click-to-select
  const ray = new THREE.Raycaster();
  let down = null;
  canvas.addEventListener('pointerdown', (e) => { down = { x: e.clientX, y: e.clientY }; });
  canvas.addEventListener('pointerup', (e) => {
    if (view !== 'design' || !down || e.button !== 0) return;
    if (Math.hypot(e.clientX - down.x, e.clientY - down.y) > 4 || tc.dragging || tc.axis) return;
    const r = canvas.getBoundingClientRect();
    ray.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), camera);
    const hits = ray.intersectObjects([...meshes.values()].filter((m) => m.visible), false);
    select(hits.length ? hits[0].object.userData.id : null);
  });

  new ResizeObserver(resize).observe(viewport);
}

function setGizmo(mode) {
  const s = selected();
  if (s && isExact(s) && mode === 'scale') mode = 'translate';
  tc.setMode(mode);
  tc.showX = tc.showZ = !(s && isExact(s) && mode === 'rotate');
  tc.setSpace(mode === 'translate' ? 'world' : 'local');
  document.querySelectorAll('[data-gizmo]').forEach((b) => b.classList.toggle('active', b.dataset.gizmo === mode));
}

function frameDesign() {
  const s = selected();
  const box = s ? new THREE.Box3().setFromObject(meshes.get(s.id), true) : computeBounds();
  if (box.isEmpty()) return;
  const c = box.getCenter(new THREE.Vector3()), r = box.getSize(new THREE.Vector3()).length();
  const dir = camera.position.clone().sub(orbit.target).normalize();
  orbit.target.copy(c);
  camera.position.copy(c).addScaledVector(dir, Math.max(4, r * 1.4));
}

function resize() {
  const w = viewport.clientWidth, h = viewport.clientHeight;
  if (!w || !h) return;
  renderer.setSize(w, h, false);
  camera.aspect = w / h; camera.updateProjectionMatrix();
  blockView.resize(w, h);
}

function loop() {
  requestAnimationFrame(loop);
  if (view === 'design') { orbit.update(); renderer.render(scene, camera); }
  else if (view === 'blocks') { blockView.update(); renderer.render(blockView.scene, blockView.camera); }
}

// ---------------------------------------------------------------- history & storage
let history = [], hIndex = -1;
const snapshot = () => JSON.stringify({ shapes, settings, palettes, profiles, stampRevs: stamps.map((t) => t.id + ':' + (t.rev || 0)) });

function commit() {
  const s = snapshot();
  if (history[hIndex] !== s) {
    history = history.slice(0, hIndex + 1);
    history.push(s);
    if (history.length > 150) history.shift();
    hIndex = history.length - 1;
  }
  save();
  updateDims();
  scheduleConvert();
}

function restore(json) {
  const d = JSON.parse(json);
  shapes = d.shapes; settings = { ...defaultSettings(), ...d.settings };
  if (d.stamps) stamps = d.stamps;
  palettes = d.palettes || clonePresets(); profiles = d.profiles || []; palRev++;
  renderStampList();
  nextId = shapes.reduce((m, s) => Math.max(m, s.id), 0) + 1;
  rebuildMeshes(); migrateFit(); applySettingsUI(); renderShapeList(); fillProps(); updateDims();
  save(); scheduleConvert();
}
function undo() { if (hIndex > 0) { hIndex--; restore(history[hIndex]); } }
function redo() { if (hIndex < history.length - 1) { hIndex++; restore(history[hIndex]); } }

let saveTimer = 0;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    const json = JSON.stringify({ version: 3, shapes, settings, stamps, palettes, profiles, built: [...built] });
    idbSet('project', json);
    try { if (json.length < 2_000_000) localStorage.setItem(STORAGE_KEY, json); else localStorage.removeItem(STORAGE_KEY); } catch { /* storage full or unavailable */ }
  }, 300);
}

function loadProject(d) {
  if (!d || !Array.isArray(d.shapes)) throw new Error('Not a Shape Layers project');
  shapes = d.shapes.map((s) => ({ visible: true, mode: 'add', material: 'stone', rotation: [0, 0, 0], repeat: defaultRepeat(), ...s, params: { ...defaultParams(s.type), ...(s.params || {}) } }));
  settings = { ...defaultSettings(), ...(d.settings || {}) };
  built = new Set(d.built || []);
  stamps = Array.isArray(d.stamps) ? d.stamps : [];
  palettes = Array.isArray(d.palettes) ? d.palettes : clonePresets();
  profiles = Array.isArray(d.profiles) ? d.profiles : [];
  palRev++;
  nextId = shapes.reduce((m, s) => Math.max(m, s.id || 0), 0) + 1;
  shapes.forEach((s) => { if (!s.id) s.id = nextId++; });
  selectedId = null;
  lastDims = null;
}

function initFile() {
  $('btn-new').onclick = () => {
    if (!confirm('Start a new project? Unsaved changes in this one will be replaced.')) return;
    shapes = []; settings = defaultSettings(); built = new Set(); selectedId = null; nextId = 1; lastDims = null;
    rebuildMeshes(); applySettingsUI(); renderShapeList(); fillProps(); setVoxels(null); commit();
  };
  $('btn-save').onclick = () => download('shape-layers-project.json', JSON.stringify({ version: 3, shapes, settings, stamps, palettes, profiles, built: [...built] }, null, 2), 'application/json');
  $('btn-open').onclick = () => $('file-input').click();
  $('file-input').onchange = async (e) => {
    const f = e.target.files[0]; if (!f) return;
    try {
      loadProject(JSON.parse(await f.text()));
      rebuildMeshes(); migrateFit(); applySettingsUI(); renderShapeList(); renderStampList(); fillProps(); commit(); frameDesign();
    } catch (err) { alert('Could not open file: ' + err.message); }
    e.target.value = '';
  };

  const menu = $('export-menu');
  $('btn-export').onclick = (e) => { e.stopPropagation(); menu.hidden = !menu.hidden; $('file-menu').hidden = true; };
  document.addEventListener('click', () => { menu.hidden = true; });
  menu.querySelectorAll('[data-export]').forEach((b) => b.onclick = () => doExport(b.dataset.export));

  $('btn-theme').onclick = () => {
    const next = document.documentElement.dataset.resolvedTheme === 'light' ? 'dark' : 'light';
    try { localStorage.setItem('shape-layers:theme', next); } catch { /* ignore */ }
    applyTheme(next);
  };
}

async function doExport(kind) {
  $('export-menu').hidden = true;
  if (!voxels) { convert(); alert('Converting first — try the export again in a moment.'); return; }
  const v = voxels, base = `shape-layers-${v.W}x${v.H}x${v.D}`;
  if (kind === 'mcfunction') download(base + '.mcfunction', toMcfunction(v), 'text/plain');
  if (kind === 'schem') download(base + '.schem', await toSchem(v));
  if (kind === 'materials') download(base + '-materials.csv', materialList(summary), 'text/csv');
  if (kind === 'layer-png') {
    const m = layerView.mode;
    if (m === 'top') renderLayerImage(layer).toBlob((b) => download(`${base}-layer-${layer + 1}.png`, b));
    else renderSectionImage(m, layerView.slice[m]).toBlob((b) => download(`${base}-${m}-${m === 'front' ? 'z' : 'x'}${layerView.slice[m]}.png`, b));
  }
  if (kind === 'sheet') openLayerSheet();
}

function renderLayerImage(y, maxPx = 1600) {
  const v = voxels;
  const cs = Math.max(6, Math.min(28, Math.floor(maxPx / Math.max(v.W, v.D))));
  const pad = 30;
  const c = document.createElement('canvas');
  c.width = v.W * cs + pad * 2; c.height = v.D * cs + pad * 2 + 18;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
  drawLayer(ctx, v, y, { cs, ox: pad, oy: pad + 18, ghost: true, theme: LIGHT_THEME });
  ctx.fillStyle = '#222'; ctx.font = 'bold 14px system-ui, sans-serif'; ctx.textBaseline = 'top';
  const pl = summary.perLayer[y];
  ctx.fillText(`Layer ${y + 1} / ${v.H}  (y +${y})   ${pl.full} blocks, ${pl.slab} slabs   N ↑`, pad, 8);
  return c;
}

function renderSectionImage(mode, k, maxPx = 1600) {
  const v = voxels;
  const { U, V } = viewDims(v, mode);
  const cs = Math.max(6, Math.min(28, Math.floor(maxPx / Math.max(U, V))));
  const pad = 30;
  const c = document.createElement('canvas');
  c.width = U * cs + pad * 2; c.height = V * cs + pad * 2 + 18;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
  drawSection(ctx, v, mode, k, { cs, ox: pad, oy: pad + 18, ghost: true, theme: LIGHT_THEME });
  ctx.fillStyle = '#222'; ctx.font = 'bold 14px system-ui, sans-serif'; ctx.textBaseline = 'top';
  ctx.fillText(mode === 'front' ? `Front section at z = ${k}  (x →, y ↑)` : `Side section at x = ${k}  (z →, y ↑)`, pad, 8);
  return c;
}

function openLayerSheet() {
  const w = window.open('', '_blank');
  if (!w) { alert('Allow pop-ups to open the layer sheet.'); return; }
  const v = voxels;
  const imgs = [];
  for (let y = 0; y < v.H; y++) {
    const pl = summary.perLayer[y];
    if (!pl.full && !pl.slab) continue;
    imgs.push(`<figure><img src="${renderLayerImage(y, 700).toDataURL()}" alt="Layer ${y + 1}"></figure>`);
  }
  const mats = summary.perMat.map((m, i) => (m.full || m.slab) ? `<li>${BLOCKS[i].name}: ${m.full} blocks, ${m.slab} slabs</li>` : '').join('');
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Layer sheet ${v.W}x${v.H}x${v.D}</title>
<style>body{font:14px system-ui,sans-serif;margin:24px;color:#222;background:#fff}figure{display:inline-block;margin:0 12px 16px 0;break-inside:avoid;vertical-align:top}img{max-width:100%;border:1px solid #ddd}
@media print{button{display:none}}</style></head><body>
<h1>Layer sheet — ${v.W} × ${v.H} × ${v.D}</h1><p>Full blocks are solid. Slabs: half bar at the bottom of a cell = bottom slab (b), at the top = top slab (t). Grey = layer below. North is up.</p>
<ul>${mats}</ul><button onclick="print()">Print</button><div>${imgs.join('')}</div></body></html>`);
  w.document.close();
}

// ---------------------------------------------------------------- stamps
let stampEditor = null;

function renderStampList() {
  const ul = $('stamp-list');
  if (!ul) return;
  ul.innerHTML = '';
  if (!stamps.length) { ul.innerHTML = '<li class="empty">No stamps yet. Start from the pillar template or a blank grid.</li>'; }
  for (const st of stamps) {
    const li = document.createElement('li');
    li.innerHTML = `<span class="nm"></span><small>${st.size.join('×')}</small>
      <button class="icon-btn" data-act="place" title="Place in the scene">＋</button>
      ${st.gen ? '<button class="icon-btn" data-act="gen" title="Change settings in the pillar builder (replaces hand edits)">⚙</button>' : ''}
      <button class="icon-btn" data-act="edit" title="Edit blocks">✎</button>
      <button class="icon-btn" data-act="crop" title="Cut out a piece / learn a palette from it">✂</button>
      <button class="icon-btn" data-act="star" title="Keep in your library (available in every project)">★</button>
      <button class="icon-btn" data-act="del" title="Delete stamp">✕</button>`;
    li.querySelector('.nm').textContent = st.name;
    li.onclick = (e) => {
      const act = e.target.dataset && e.target.dataset.act;
      if (act === 'place') placeStamp(st.id);
      else if (act === 'edit') editStamp(st.id);
      else if (act === 'gen') pillarBuilder.open(st);
      else if (act === 'del') deleteStamp(st.id);
      else if (act === 'crop') openCrop(st);
      else if (act === 'star') addToLibrary(st);
    };
    if (blockCount(st) > SMALL_LIMIT) li.querySelector('small').textContent = `${st.size.join('×')} · ${Math.round(blockCount(st) / 1000)}k`;
    ul.appendChild(li);
  }
  renderLibrary();
  // keep the hall builder's pillar choice in sync
  const sel = $('hall-form') && $('hall-form').elements.pillarStyle;
  if (sel) {
    const cur = sel.value;
    sel.innerHTML = '<option value="box">Simple box</option>' + stamps.map((t) => `<option value="${t.id}"></option>`).join('');
    stamps.forEach((t, i) => { sel.options[i + 1].textContent = `Stamp: ${t.name}`; });
    sel.value = [...sel.options].some((o) => o.value === cur) ? cur : 'box';
  }
}

function placeStamp(stampId, over = {}) {
  const st = stampById(stampId);
  if (!st) return null;
  const s = {
    id: nextId++, type: 'stamp', stampId, name: st.name, mode: 'add', material: 'stone', visible: true,
    position: [Math.round(orbit.target.x), 0, Math.round(orbit.target.z)], rotation: [0, 0, 0], scale: [1, 1, 1],
    params: {}, repeat: defaultRepeat(), ...over,
  };
  shapes.push(s);
  buildMesh(s);
  if (!over.silent) { select(s.id); commit(); }
  return s;
}

function editStamp(stampId) {
  stampEditor.open(stampById(stampId) || newStamp());
}

function deleteStamp(stampId) {
  const used = shapes.filter((s) => s.stampId === stampId).length;
  if (!confirm(used ? `Delete this stamp and its ${used} placement(s)?` : 'Delete this stamp?')) return;
  stamps = stamps.filter((t) => t.id !== stampId);
  shapes = shapes.filter((s) => s.stampId !== stampId);
  rebuildMeshes(); renderShapeList(); renderStampList(); fillProps(); commit();
}

function onStampSaved(st) {
  const i = stamps.findIndex((t) => t.id === st.id);
  if (i >= 0) stamps[i] = st; else stamps.push(st);
  for (const s of shapes) if (s.stampId === st.id) { s.name = st.name; syncMesh(s); }
  renderStampList(); renderShapeList(); fillProps(); commit();
}

let wallEditor = null, pillarBuilder = null, wallTarget = null;

function wallStyles() { return [...PRESET_PROFILES, ...profiles]; }

function onWallSaved(w) {
  const existing = shapes.find((s) => s.id === wallTarget && s.type === 'wall');
  if (existing) {
    existing.wall = w; existing.name = w.name || existing.name;
    syncMesh(existing); select(existing.id);
  } else {
    const s = {
      id: nextId++, type: 'wall', name: w.name || 'Wall', wall: w, mode: 'add', material: 'stone', visible: true,
      position: [Math.round(orbit.target.x), 0, Math.round(orbit.target.z)], rotation: [0, 0, 0], scale: [1, 1, 1],
      params: {}, repeat: defaultRepeat(), group: 'Walls',
    };
    shapes.push(s); buildMesh(s); select(s.id);
  }
  wallTarget = null;
  commit();
}

function initStamps() {
  stampEditor = new StampEditor(onStampSaved);
  wallEditor = new WallEditor({
    onSave: onWallSaved,
    onSaveStyle: (p) => { profiles.push(p); renderStampList(); commit(); },
    onPalettes: () => { palRev++; shapes.forEach((s) => { if (s.type === 'wall') syncMesh(s); }); save(); scheduleConvert(); },
    getPalettes: () => palettes,
    getProfiles: wallStyles,
  });
  pillarBuilder = new PillarBuilder((st, openEditor) => {
    onStampSaved(st);
    if (openEditor) stampEditor.open(st);
  });
  $('btn-wall').onclick = () => { wallTarget = null; wallEditor.open({ ...newWall(PRESET_PROFILES[0], 12, 9), name: 'Wall' }); };
  $('btn-pillar').onclick = () => pillarBuilder.open(null);
  $('btn-stamp-new').onclick = () => stampEditor.open(newStamp('New stamp', [3, 6, 3]));
  $('btn-stamp-pillar').onclick = () => stampEditor.open(pillarTemplate(9, 'spruce'));
  $('btn-stamp-import').onclick = () => $('stamp-file').click();
  $('stamp-file').onchange = async (e) => {
    const f = e.target.files[0]; if (!f) return;
    e.target.value = '';
    $('help').textContent = `Reading ${f.name}…`;
    try {
      const st = await stampFromFile(f);
      importBuild(st);
    } catch (err) { alert('Could not import: ' + err.message); }
  };
  $('btn-import-build').onclick = () => $('stamp-file').click();
  initCrop();
  renderStampList();
}

// ---------------------------------------------------------------- imports, cut-outs, library
// Small pieces open in the stamp editor; whole builds are placed in the scene as an
// "Imported" part, so new parts (roofs, wings...) can be designed to fit them exactly.
function importBuild(st) {
  const n = blockCount(st);
  if (n <= 400 && !isDense(st)) { stampEditor.open(st); return; }
  stamps.push(st);
  const s = placeStamp(st.id, { silent: true, group: 'Imported', name: st.name, position: [Math.round(orbit.target.x), 0, Math.round(orbit.target.z)] });
  renderStampList();
  if (n > SMALL_LIMIT) setOverlay(true); // big imports show as a box until blocks are shown
  setView('design');
  select(s.id);
  commit();
  frameDesign();
  $('help').textContent = `Imported "${st.name}": ${n.toLocaleString()} blocks, ${st.size.join(' × ')}. Use ✂ in Stamps to cut pieces out of it.`;
}

let library = { stamps: [], palettes: [] };
async function loadLibrary() {
  const lib = await idbGet('library');
  if (lib) library = { stamps: lib.stamps || [], palettes: lib.palettes || [] };
  // library palettes are available in every project
  for (const p of library.palettes) if (!palettes.some((q) => q.id === p.id)) palettes.push(JSON.parse(JSON.stringify(p)));
}
function saveLibrary() { idbSet('library', JSON.parse(JSON.stringify(library))); }
function addToLibrary(st) {
  const copy = JSON.parse(JSON.stringify(st));
  copy.libId = 'lib' + Date.now().toString(36);
  library.stamps = library.stamps.filter((t) => !(t.name === st.name && t.rev === st.rev));
  library.stamps.push(copy);
  saveLibrary(); renderLibrary();
  $('help').textContent = `"${st.name}" is now in your library, available in every project.`;
}
function addPaletteToLibrary(p) {
  library.palettes = library.palettes.filter((q) => q.id !== p.id);
  library.palettes.push(JSON.parse(JSON.stringify(p)));
  saveLibrary();
}
function renderLibrary() {
  const ul = $('library-list');
  if (!ul) return;
  ul.innerHTML = '';
  if (!library.stamps.length) { ul.innerHTML = '<li class="empty">Press ★ on a stamp to keep it here for every project.</li>'; return; }
  library.stamps.forEach((t, i) => {
    const li = document.createElement('li');
    li.innerHTML = `<span class="nm"></span><small>${t.size.join('×')}</small>
      <button class="icon-btn" data-act="use" title="Add to this project and place it">＋</button>
      <button class="icon-btn" data-act="del" title="Remove from library">✕</button>`;
    li.querySelector('.nm').textContent = t.name;
    li.onclick = (e) => {
      const act = e.target.dataset && e.target.dataset.act;
      if (act === 'use') {
        const st = JSON.parse(JSON.stringify(t));
        st.id = 'st' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
        delete st.libId;
        stamps.push(st);
        renderStampList();
        placeStamp(st.id);
      } else if (act === 'del') {
        library.stamps.splice(i, 1); saveLibrary(); renderLibrary();
      }
    };
    ul.appendChild(li);
  });
}

// ---- cut out a piece of a stamp / import, or learn a palette from it
let crop = null;
function initCrop() {
  crop = { dlg: $('crop-dialog'), preview: new Preview3D($('crop-3d')), stamp: null, box: null };
  const ids = ['x0', 'x1', 'y0', 'y1', 'z0', 'z1'];
  for (const id of ids) $('crop-' + id).addEventListener('input', () => updateCrop());
  crop.dlg.addEventListener('close', () => crop.preview.stop());
  $('crop-cancel').onclick = () => crop.dlg.close();
  $('crop-save').onclick = () => {
    const b = cropBox();
    const piece = cropStamp(crop.stamp, b, $('crop-name').value.trim() || crop.stamp.name + ' piece');
    if (!blockCount(piece)) { alert('The selected box is empty.'); return; }
    stamps.push(piece);
    crop.dlg.close();
    renderStampList(); commit();
    if (!isDense(piece)) stampEditor.open(piece);
    $('help').textContent = `Saved "${piece.name}" (${blockCount(piece)} blocks) as a stamp.`;
  };
  $('crop-palette').onclick = () => {
    const p = paletteFromStamp(crop.stamp, cropBox(), { name: $('crop-name').value.trim() || crop.stamp.name + ' palette', fullOnly: $('crop-full').checked });
    if (!p.entries.length) { alert('No full blocks in the selected box.'); return; }
    palettes.push(p);
    addPaletteToLibrary(p);
    palRev++;
    commit();
    $('crop-msg').textContent = `Palette "${p.name}" created from ${p.entries.length} block types. Use it in the 🧱 Wall builder (it's in your library too).`;
  };
}
function cropBox() {
  const v = (id) => Math.round(+$('crop-' + id).value || 0);
  const [W, H, D] = crop.stamp.size;
  const c = (a, max) => Math.max(0, Math.min(max - 1, a));
  const x0 = c(Math.min(v('x0'), v('x1')), W), x1 = c(Math.max(v('x0'), v('x1')), W);
  const y0 = c(Math.min(v('y0'), v('y1')), H), y1 = c(Math.max(v('y0'), v('y1')), H);
  const z0 = c(Math.min(v('z0'), v('z1')), D), z1 = c(Math.max(v('z0'), v('z1')), D);
  return [x0, y0, z0, x1, y1, z1];
}
function openCrop(st) {
  crop.stamp = st;
  const [W, H, D] = st.size;
  const set = (id, max, val) => { const el = $('crop-' + id); el.max = max - 1; el.value = val; };
  set('x0', W, 0); set('x1', W, W - 1); set('y0', H, 0); set('y1', H, H - 1); set('z0', D, 0); set('z1', D, D - 1);
  $('crop-name').value = st.name + ' piece';
  $('crop-msg').textContent = '';
  $('crop-title').textContent = `✂ Cut out of "${st.name}" (${W} × ${H} × ${D})`;
  crop.dlg.showModal();
  crop.preview.show(stampToVoxels(st), true);
  if (!crop.box) {
    crop.box = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1)), new THREE.LineBasicMaterial({ color: 0xffd43b }));
    crop.preview.scene.add(crop.box);
  }
  crop.preview.start();
  updateCrop();
}
function updateCrop() {
  const [x0, y0, z0, x1, y1, z1] = cropBox();
  const [W, , D] = crop.stamp.size;
  crop.box.scale.set(x1 - x0 + 1.04, y1 - y0 + 1.04, z1 - z0 + 1.04);
  crop.box.position.set((x0 + x1 + 1) / 2 - W / 2, (y0 + y1 + 1) / 2, (z0 + z1 + 1) / 2 - D / 2);
  ['x0', 'x1', 'y0', 'y1', 'z0', 'z1'].forEach((id) => { $('crop-' + id + '-out').textContent = $('crop-' + id).value; });
  let n = 0;
  forEachInBox(crop.stamp, [x0, y0, z0, x1, y1, z1], () => n++);
  $('crop-count').textContent = `Selection: ${x1 - x0 + 1} × ${y1 - y0 + 1} × ${z1 - z0 + 1} · ${n.toLocaleString()} blocks`;
}
function forEachInBox(st, [x0, y0, z0, x1, y1, z1], fn) {
  // count with the stamp's own iterator (fast enough even for big imports)
  const voxBox = (x, y, z) => x >= x0 && x <= x1 && y >= y0 && y <= y1 && z >= z0 && z <= z1;
  cropForEach(st, (x, y, z, s) => { if (voxBox(x, y, z)) fn(x, y, z, s); });
}

// ---------------------------------------------------------------- hall builder
// Pillars across the hall (repeated along its length) + a vault resting on the outer pillars.
function initHall() {
  const dlg = $('hall-dialog'), form = $('hall-form');
  for (const name of ['pillarMat', 'roofMat']) {
    const sel = form.elements[name];
    for (const b of BLOCKS) { const o = document.createElement('option'); o.value = b.id; o.textContent = b.name; sel.appendChild(o); }
  }
  form.elements.pillarMat.value = 'spruce';
  form.elements.roofMat.value = 'stone_bricks';
  const num = (n) => parseFloat(form.elements[n].value) || 0;
  const summary = () => {
    form.elements.roundOut.value = form.elements.roundness.value;
    form.elements.flatOut.value = form.elements.flatten.value;
    const across = Math.max(2, Math.round(num('across'))), w = Math.max(1, num('width')), gap = num('gap');
    const span = (across - 1) * (w + gap) + w;
    const along = Math.max(1, Math.floor((num('hallLength') - w) / Math.max(1, num('every'))) + 1);
    $('hall-summary').textContent = `Outer face to outer face: ${span} blocks · pillar centers ${(across - 1) * (w + gap)} apart · ` +
      `${across} × ${along} pillars · roof ${span + 2 * num('overhang')} wide, peak at y ${num('height') + num('rise')}`;
  };
  form.addEventListener('input', summary);
  form.elements.pillarStyle.addEventListener('change', () => {
    const st = stampById(form.elements.pillarStyle.value);
    if (st) { form.elements.height.value = st.size[1]; form.elements.width.value = 1; summary(); }
  });
  $('btn-hall').onclick = () => {
    const ws = form.elements.wallStyle, cur = ws.value;
    ws.innerHTML = '<option value="">No walls</option>' + wallStyles().map((p) => `<option value="${p.id}"></option>`).join('');
    wallStyles().forEach((p, i) => { ws.options[i + 1].textContent = p.name; });
    // first time: default to the hall wall; afterwards keep the user's choice
    ws.value = ws.dataset.init && [...ws.options].some((o) => o.value === cur) ? cur : 'hall';
    ws.dataset.init = '1';
    summary(); dlg.showModal();
  };
  dlg.addEventListener('close', () => {
    if (dlg.returnValue !== 'ok') return;
    const across = Math.max(2, Math.round(num('across'))), w = Math.max(1, num('width')), gap = Math.max(0, num('gap'));
    const height = Math.max(1, num('height')), length = Math.max(1, num('hallLength')), every = Math.max(1, num('every'));
    const span = (across - 1) * (w + gap) + w;
    const along = Math.max(1, Math.floor((length - w) / every) + 1);
    const roofW = Math.max(1, span + 2 * num('overhang'));
    const rise = Math.max(0.5, num('rise'));
    if (form.elements.replace.checked) { shapes = []; nextId = 1; }
    const pillarIds = [];
    for (let i = 0; i < across; i++) {
      const x = -span / 2 + i * (w + gap) + w / 2;
      const stampId = form.elements.pillarStyle.value;
      if (stampById(stampId)) {
        // stamp centered on the pillar's column
        const p = placeStamp(stampId, { silent: true, group: 'Pillars', name: `Pillar row ${i + 1}`, position: [x, 0, w / 2], repeat: { count: along, axis: 'z', spacing: every } });
        pillarIds.push(p.id);
        continue;
      }
      const p = makeShape('box', {
        name: `Pillar row ${i + 1}`, material: form.elements.pillarMat.value,
        position: [x, height / 2, w / 2], scale: [w, height, w], group: 'Pillars',
        repeat: { count: along, axis: 'z', spacing: every },
      });
      shapes.push(p); pillarIds.push(p.id);
    }
    // side walls behind the outer pillars (front face flush with the outer column faces)
    const style = wallStyles().find((p) => p.id === form.elements.wallStyle.value);
    let wallDepth = 0;
    if (style) {
      wallDepth = style.depth;
      for (const side of [-1, 1]) {
        const w0 = newWall(style, Math.round(length), Math.round(height));
        w0.name = side < 0 ? 'Left wall' : 'Right wall';
        shapes.push({
          id: nextId++, type: 'wall', name: w0.name, wall: w0, mode: 'add', material: 'stone', visible: true,
          position: [side * (span / 2 + wallDepth / 2), 0, length / 2], rotation: [0, side < 0 ? 90 : 270, 0], scale: [1, 1, 1],
          params: {}, repeat: defaultRepeat(), group: 'Walls',
        });
      }
    }
    const roofSpan = form.elements.roofOn.value === 'walls' && wallDepth ? roofW + 2 * wallDepth : roofW;
    const roof = makeShape('vault', {
      name: 'Vault roof', material: form.elements.roofMat.value, group: 'Roof',
      position: [0, height + rise / 2, length / 2], scale: [roofSpan, rise, length],
      params: { ...defaultParams('vault'), thickness: num('thickness'), roundness: num('roundness'), flatten: num('flatten') },
    });
    shapes.push(roof);
    // 1 unit = 1 block so the pillar spacing is exact
    settings.bpu = 1; settings.stretch = [1, 1, 1]; settings.stairs = true;
    lastDims = null;
    rebuildMeshes(); applySettingsUI();
    select(roof.id);
    commit();
    frameDesign();
  });
}

// ---------------------------------------------------------------- newcomer guidance
// The right panel's "next step" card, the empty-build hint and which panels show per step.
function updateGuidance() {
  if (!$('next-step')) return;
  const empty = !shapes.length;
  $('empty-hint').hidden = !empty || view !== 'design';
  $('layer-section').hidden = view === 'design';
  const card = $('next-step'), btn = $('go-blocks'), p = card.querySelector('p');
  card.hidden = empty || view === 'layers';
  if (view === 'design') { p.textContent = 'When the shape looks right, check it as real Minecraft blocks.'; btn.textContent = 'See it as blocks ›'; btn.dataset.go = 'blocks'; }
  else if (view === 'blocks') { p.textContent = 'Happy with the blocks? Follow the plan one layer at a time.'; btn.textContent = 'Build it layer by layer ›'; btn.dataset.go = 'layers'; }
}

function loadFresh(withExample) {
  shapes = []; settings = defaultSettings(); built = new Set(); selectedId = null; selectedGroup = null; soloGroup = null; nextId = 1; lastDims = null;
  if (withExample) defaultProject();
  rebuildMeshes(); applySettingsUI(); renderShapeList(); fillProps();
  if (!withExample) setVoxels(null);
  setView('design');
  commit();
  if (withExample) frameDesign();
}

function openWelcome() {
  $('w-close').textContent = shapes.length ? 'Continue my build' : 'Close';
  $('welcome').showModal();
}

function initUX() {
  // File menu
  const fm = $('file-menu');
  $('btn-file').onclick = (e) => { e.stopPropagation(); fm.hidden = !fm.hidden; $('export-menu').hidden = true; };
  document.addEventListener('click', () => { fm.hidden = true; });
  fm.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => { fm.hidden = true; }));

  // Advanced switch: fine-tuning settings stay out of the way until asked for
  const setAdv = (on) => {
    document.body.classList.toggle('show-adv', on);
    $('adv-toggle').checked = on;
    try { localStorage.setItem('shape-layers:advanced', on ? '1' : '0'); } catch { /* ignore */ }
  };
  let adv = false;
  try { adv = localStorage.getItem('shape-layers:advanced') === '1'; } catch { /* ignore */ }
  setAdv(adv);
  $('adv-toggle').onchange = (e) => setAdv(e.target.checked);

  // Add tabs (Builders / Shapes / Stamps)
  const setAdd = (k) => {
    document.querySelectorAll('#add-tabs button').forEach((b) => b.classList.toggle('active', b.dataset.add === k));
    document.querySelectorAll('[data-addpane]').forEach((p) => { p.hidden = p.dataset.addpane !== k; });
    try { localStorage.setItem('shape-layers:addTab', k); } catch { /* ignore */ }
  };
  document.querySelectorAll('#add-tabs button').forEach((b) => b.onclick = () => setAdd(b.dataset.add));
  let tab = 'builders';
  try { tab = localStorage.getItem('shape-layers:addTab') || 'builders'; } catch { /* ignore */ }
  setAdd(tab);

  $('p-close').onclick = () => select(null);
  $('go-blocks').onclick = () => setView($('go-blocks').dataset.go || 'blocks');
  $('empty-hall').onclick = () => $('btn-hall').click();

  // Welcome / help
  const w = $('welcome');
  const done = () => { try { localStorage.setItem('shape-layers:welcomed', '1'); } catch { /* ignore */ } w.close(); };
  $('btn-help').onclick = openWelcome;
  $('w-close').onclick = done;
  $('w-hall').onclick = () => { done(); $('btn-hall').click(); };
  $('w-example').onclick = () => {
    if (shapes.length && !confirm('Replace your current build with the example tower?')) return;
    done(); loadFresh(true);
  };
  $('w-empty').onclick = () => {
    if (shapes.length && !confirm('Start empty? Your current build will be replaced (save it first from File if you want to keep it).')) return;
    done(); loadFresh(false);
  };
  window.addEventListener('keydown', (e) => {
    const typing = /INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName);
    if (e.key === '?' && !typing && !document.querySelector('dialog[open]')) openWelcome();
  });
  let seen = false;
  try { seen = localStorage.getItem('shape-layers:welcomed') === '1'; } catch { /* ignore */ }
  if (!seen) openWelcome();
  updateGuidance();
}

// ---------------------------------------------------------------- theme & keys
function applyTheme(t) {
  document.documentElement.dataset.resolvedTheme = t;
  const bg = t === 'light' ? 0xeef0f3 : 0x121418;
  scene.background = new THREE.Color(bg);
  blockView.scene.background = new THREE.Color(t === 'light' ? 0xdfe8ef : 0x15181d);
  makeGrid();
  layerView.draw();
}

function initKeys() {
  window.addEventListener('keydown', (e) => {
    const typing = /INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName) && document.activeElement.type !== 'range' && document.activeElement.type !== 'checkbox';
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key.toLowerCase() === 'z' && !typing) { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
    if (mod && e.key.toLowerCase() === 'y' && !typing) { e.preventDefault(); redo(); return; }
    if (mod && e.key.toLowerCase() === 'd' && !typing) { e.preventDefault(); duplicate(false); return; }
    if (typing || mod) return;
    const k = e.key.toLowerCase();
    if (k === '1') setView('design');
    else if (k === '2') setView('blocks');
    else if (k === '3') setView('layers');
    else if (view === 'design' && k === 'w') setGizmo('translate');
    else if (view === 'design' && k === 'e') setGizmo('rotate');
    else if (view === 'design' && k === 'r') setGizmo('scale');
    else if (view === 'design' && k === 'f') frameDesign();
    else if (view === 'design' && (k === 'delete' || k === 'backspace')) deleteSelected();
    else if (view === 'design' && k === 'escape') select(null);
    else if (view === 'layers' && layerView.mode !== 'top' && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) { e.preventDefault(); setSlice(layerView.slice[layerView.mode] + (e.key === 'ArrowRight' ? 1 : -1)); }
    else if (e.key === 'PageUp' || (view === 'layers' && e.key === 'ArrowUp')) { e.preventDefault(); setLayer(layer + 1, true); }
    else if (e.key === 'PageDown' || (view === 'layers' && e.key === 'ArrowDown')) { e.preventDefault(); setLayer(layer - 1, true); }
  });
}

// ---------------------------------------------------------------- boot
(async function boot() {
  let theme = null;
  try { theme = localStorage.getItem('shape-layers:theme'); } catch { /* ignore */ }
  applyTheme(theme || (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'));

  let loaded = false;
  try {
    const raw = (await idbGet('project')) || localStorage.getItem(STORAGE_KEY);
    if (raw) { loadProject(JSON.parse(raw)); loaded = true; }
  } catch { /* fall back to default */ }
  if (!loaded) defaultProject();
  await loadLibrary();

  renderShapeButtons();
  initProps(); initSettings(); initLayers(); initViews(); initFile(); initKeys(); initHall(); initStamps(); initUX();
  rebuildMeshes(); migrateFit(); applySettingsUI(); renderShapeList(); fillProps();
  resize();
  commit();
  convert();
  loop();
})();
