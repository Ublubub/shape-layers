import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { BLOCKS } from './blocks.js';
import { parseState, formatState, shapeFamily, stateColor, stateLabel } from './blockstates.js';
import { stateGeometry } from './blockShapes.js';
import { drawLayer, DARK_THEME, LIGHT_THEME } from './layerView.js';
import { buildBlockGroup, disposeBlockGroup } from './blockView.js';
import { key, stampToVoxels, rotateStamp, newStamp } from './stampData.js';

// Blocks offered in the picker (any other block can be typed in the state box).
const EXTRA = [
  'stripped_spruce_log', 'spruce_log', 'stripped_oak_log', 'oak_log', 'stripped_dark_oak_log', 'dark_oak_log',
  'stripped_birch_log', 'birch_log', 'stripped_cherry_log', 'spruce_wood', 'stripped_spruce_wood',
  'spruce_trapdoor', 'oak_trapdoor', 'dark_oak_trapdoor', 'birch_trapdoor', 'cherry_trapdoor', 'iron_trapdoor', 'copper_trapdoor',
  'spruce_fence', 'oak_fence', 'dark_oak_fence', 'spruce_fence_gate', 'cobblestone_wall', 'stone_brick_wall',
  'mossy_stone_brick_wall', 'tuff_brick_wall', 'deepslate_brick_wall', 'lantern', 'soul_lantern', 'chain', 'torch',
  'wall_torch', 'iron_bars', 'glass', 'glass_pane', 'tinted_glass', 'barrel', 'bookshelf', 'chiseled_stone_bricks',
  'cracked_stone_bricks', 'chiseled_tuff_bricks', 'chiseled_tuff', 'chiseled_deepslate', 'polished_andesite',
  'calcite', 'dripstone_block', 'hay_block', 'moss_block', 'moss_carpet', 'oak_leaves', 'spruce_leaves',
  'azalea_leaves', 'flowering_azalea_leaves', 'ladder', 'copper_grate', 'waxed_copper_bulb', 'candle', 'lightning_rod',
  'end_rod', 'quartz_pillar', 'purpur_pillar', 'basalt', 'polished_basalt', 'smooth_basalt', 'packed_mud', 'gravel',
  'coarse_dirt', 'redstone_lamp', 'sea_lantern', 'shroomlight', 'glowstone', 'ochre_froglight',
];
export const PICKER = [...new Set([
  ...BLOCKS.flatMap((b) => [b.full, b.slab, b.stairs].filter(Boolean)),
  ...EXTRA.map((n) => 'minecraft:' + n),
])];

// Properties offered per block family: [name, values]
export function propSchema(name) {
  const fam = shapeFamily(name);
  const FACING = ['north', 'east', 'south', 'west'];
  if (fam === 'stairs') return [['facing', FACING], ['half', ['bottom', 'top']], ['shape', ['straight', 'inner_left', 'inner_right', 'outer_left', 'outer_right']]];
  if (fam === 'slab') return [['type', ['bottom', 'top', 'double']]];
  if (fam === 'trapdoor') return [['facing', FACING], ['half', ['bottom', 'top']], ['open', ['false', 'true']]];
  if (/(_log|_wood|_stem|_hyphae|basalt|pillar|hay_block|bone_block|froglight)$/.test(name) || name === 'chain') return [['axis', ['y', 'x', 'z']]];
  if (/lantern$/.test(name)) return [['hanging', ['false', 'true']]];
  if (/(wall_torch|ladder|fence_gate|_button|chest|furnace|observer)$/.test(name)) return [['facing', FACING]];
  if (name === 'barrel') return [['facing', ['up', 'down', ...FACING]]];
  return [];
}

export class StampEditor {
  constructor(onSave) {
    this.onSave = onSave;
    this.dlg = document.getElementById('stamp-dialog');
    this.canvas = document.getElementById('se-canvas');
    this.ctx = this.canvas.getContext('2d');
    this.stamp = null;
    this.layer = 0;
    this.base = 'minecraft:spruce_planks';
    this.props = {};
    this.history = [];
    this.initPicker();
    this.initGrid();
    this.init3D();
    const $ = (id) => document.getElementById(id);
    $('se-layer').addEventListener('input', (e) => this.setLayer(+e.target.value));
    $('se-ldown').onclick = () => this.setLayer(this.layer - 1);
    $('se-lup').onclick = () => this.setLayer(this.layer + 1);
    $('se-resize').onclick = () => this.resize();
    $('se-fill').onclick = () => this.edit(() => { const [W, , D] = this.stamp.size; for (let z = 0; z < D; z++) for (let x = 0; x < W; x++) this.stamp.blocks[key(x, this.layer, z)] = this.state; });
    $('se-clear').onclick = () => this.edit(() => { for (const k of Object.keys(this.stamp.blocks)) if (+k.split(',')[1] === this.layer) delete this.stamp.blocks[k]; });
    $('se-copy').onclick = () => this.edit(() => {
      if (this.layer === 0) return;
      for (const [k, st] of Object.entries(this.stamp.blocks)) {
        const [x, y, z] = k.split(',').map(Number);
        if (y === this.layer - 1) this.stamp.blocks[key(x, this.layer, z)] = st;
      }
    });
    $('se-rotate').onclick = () => this.edit(() => { const r = rotateStamp(this.stamp, 1); this.stamp.size = r.size; this.stamp.blocks = r.blocks; });
    $('se-undo').onclick = () => this.undo();
    $('se-cancel').onclick = () => this.dlg.close();
    $('se-save').onclick = () => {
      this.stamp.name = $('se-name').value.trim() || 'Stamp';
      this.stamp.rev = (this.stamp.rev || 0) + 1;
      this.onSave(this.stamp);
      this.dlg.close();
    };
    $('se-state').addEventListener('change', (e) => { this.setState(e.target.value); });
    this.dlg.addEventListener('close', () => { this.running = false; });
    this.dlg.addEventListener('keydown', (e) => {
      if (e.target.tagName === 'INPUT' && e.target.type !== 'range') return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); this.undo(); }
      if (e.key === 'PageUp' || e.key === 'ArrowUp') { e.preventDefault(); this.setLayer(this.layer + 1); }
      if (e.key === 'PageDown' || e.key === 'ArrowDown') { e.preventDefault(); this.setLayer(this.layer - 1); }
    });
  }

  get state() { return document.getElementById('se-state').value.trim() || this.base; }

  open(stamp) {
    this.stamp = JSON.parse(JSON.stringify(stamp || newStamp('New stamp', [3, 6, 3])));
    this.history = [];
    this.layer = 0;
    const $ = (id) => document.getElementById(id);
    $('se-name').value = this.stamp.name;
    [$('se-w').value, $('se-h').value, $('se-d').value] = this.stamp.size;
    this.dlg.showModal();
    this.selectBase(this.base);
    this.setLayer(0);
    this.refresh(true);
    this.running = true;
    const loop = () => { if (!this.running) return; requestAnimationFrame(loop); this.controls.update(); this.renderer.render(this.scene, this.camera); };
    loop();
  }

  // ---- picker
  initPicker() {
    const list = document.getElementById('se-blocks');
    const search = document.getElementById('se-search');
    const render = () => {
      const q = search.value.trim().toLowerCase().replace(/\s+/g, '_');
      list.innerHTML = '';
      for (const id of PICKER) {
        if (q && !id.includes(q)) continue;
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'se-block' + (id === this.base ? ' sel' : '');
        b.innerHTML = `<i style="background:${stateColor(id)}"></i><span></span>`;
        b.querySelector('span').textContent = id.slice(10).replace(/_/g, ' ');
        b.title = id;
        b.onclick = () => { this.selectBase(id); render(); };
        list.appendChild(b);
      }
      // allow any block id typed in search
      if (q && !PICKER.includes('minecraft:' + q)) {
        const b = document.createElement('button');
        b.type = 'button'; b.className = 'se-block';
        b.innerHTML = `<i style="background:${stateColor('minecraft:' + q)}"></i><span>use “${q}”</span>`;
        b.onclick = () => { this.selectBase('minecraft:' + q); render(); };
        list.appendChild(b);
      }
    };
    search.addEventListener('input', render);
    this.renderPicker = render;
    render();
  }

  selectBase(id) {
    this.base = parseState(id).id;
    const name = parseState(id).name;
    const schema = propSchema(name);
    const wrap = document.getElementById('se-props');
    wrap.innerHTML = '';
    this.props = {};
    for (const [p, values] of schema) {
      this.props[p] = values[0];
      const lab = document.createElement('label');
      lab.innerHTML = `<span>${p}</span>`;
      const sel = document.createElement('select');
      for (const v of values) { const o = document.createElement('option'); o.value = o.textContent = v; sel.appendChild(o); }
      sel.onchange = () => { this.props[p] = sel.value; this.updateState(); };
      lab.appendChild(sel);
      wrap.appendChild(lab);
    }
    this.updateState();
  }

  updateState() {
    document.getElementById('se-state').value = formatState({ id: this.base, props: this.props });
    document.getElementById('se-swatch').style.background = stateColor(this.base);
  }

  // set from a full state string (typed or picked from the grid)
  setState(st) {
    const p = parseState(st);
    this.selectBase(p.id);
    for (const [k, v] of Object.entries(p.props)) {
      this.props[k] = v;
      const sel = [...document.querySelectorAll('#se-props label')].find((l) => l.firstChild.textContent === k);
      if (sel) sel.querySelector('select').value = v;
    }
    document.getElementById('se-state').value = formatState({ id: p.id, props: { ...this.props, ...p.props } });
    this.renderPicker();
  }

  // ---- grid
  initGrid() {
    let painting = null;
    const cellAt = (e) => {
      const r = this.canvas.getBoundingClientRect();
      const x = Math.floor((e.clientX - r.left - this.ox) / this.cs);
      const z = Math.floor((e.clientY - r.top - this.oy) / this.cs);
      const [W, , D] = this.stamp.size;
      return x >= 0 && z >= 0 && x < W && z < D ? [x, z] : null;
    };
    const apply = (c, erase) => {
      const k = key(c[0], this.layer, c[1]);
      if (erase) delete this.stamp.blocks[k]; else this.stamp.blocks[k] = this.state;
      this.refresh();
    };
    this.canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    this.canvas.addEventListener('pointerdown', (e) => {
      const c = cellAt(e);
      if (!c) return;
      if (e.altKey) { const st = this.stamp.blocks[key(c[0], this.layer, c[1])]; if (st) this.setState(st); return; }
      this.pushHistory();
      painting = { erase: e.button === 2 || e.shiftKey };
      this.canvas.setPointerCapture(e.pointerId);
      apply(c, painting.erase);
    });
    this.canvas.addEventListener('pointermove', (e) => {
      const c = cellAt(e);
      const info = document.getElementById('se-hover');
      if (c) {
        const st = this.stamp.blocks[key(c[0], this.layer, c[1])];
        info.textContent = `x ${c[0]}, y ${this.layer}, z ${c[1]} — ${st ? stateLabel(st) : 'air'}`;
      }
      if (painting && c) apply(c, painting.erase);
    });
    this.canvas.addEventListener('pointerup', () => { painting = null; });
  }

  pushHistory() {
    this.history.push(JSON.stringify({ size: this.stamp.size, blocks: this.stamp.blocks }));
    if (this.history.length > 100) this.history.shift();
  }
  undo() {
    const h = this.history.pop();
    if (!h) return;
    const d = JSON.parse(h);
    this.stamp.size = d.size; this.stamp.blocks = d.blocks;
    this.syncSizeInputs();
    this.setLayer(this.layer);
    this.refresh(true);
  }
  edit(fn) { this.pushHistory(); fn(); this.syncSizeInputs(); this.setLayer(this.layer); this.refresh(true); }

  syncSizeInputs() {
    const $ = (id) => document.getElementById(id);
    [$('se-w').value, $('se-h').value, $('se-d').value] = this.stamp.size;
  }

  resize() {
    const $ = (id) => document.getElementById(id);
    const clamp = (v) => Math.max(1, Math.min(64, Math.round(+v || 1)));
    this.edit(() => {
      this.stamp.size = [clamp($('se-w').value), clamp($('se-h').value), clamp($('se-d').value)];
      const [W, H, D] = this.stamp.size;
      for (const k of Object.keys(this.stamp.blocks)) {
        const [x, y, z] = k.split(',').map(Number);
        if (x >= W || y >= H || z >= D) delete this.stamp.blocks[k];
      }
    });
  }

  setLayer(y) {
    const H = this.stamp.size[1];
    this.layer = Math.max(0, Math.min(H - 1, y));
    const s = document.getElementById('se-layer');
    s.max = H - 1; s.value = this.layer;
    document.getElementById('se-lout').textContent = `layer ${this.layer} / ${H - 1}`;
    this.drawGrid();
    this.updateLayerMarker();
  }

  drawGrid() {
    const c = this.canvas, ctx = this.ctx;
    const dpr = window.devicePixelRatio || 1;
    const w = c.clientWidth || 360, h = c.clientHeight || 360;
    c.width = w * dpr; c.height = h * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const [W, , D] = this.stamp.size;
    this.cs = Math.max(6, Math.floor(Math.min((w - 24) / W, (h - 24) / D, 56)));
    this.ox = Math.floor((w - W * this.cs) / 2);
    this.oy = Math.floor((h - D * this.cs) / 2);
    ctx.clearRect(0, 0, w, h);
    const theme = document.documentElement.dataset.resolvedTheme === 'light' ? LIGHT_THEME : DARK_THEME;
    drawLayer(ctx, stampToVoxels(this.stamp), this.layer, { cs: this.cs, ox: this.ox, oy: this.oy, ghost: true, theme });
  }

  // ---- 3D preview
  init3D() {
    const canvas = document.getElementById('se-3d');
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(45, 1, 0.1, 500);
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x445566, 1.6));
    const sun = new THREE.DirectionalLight(0xffffff, 1.6);
    sun.position.set(0.6, 1, 0.35);
    this.scene.add(sun);
    this.group = null;
    this.marker = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1)), new THREE.LineBasicMaterial({ color: 0xff6b9a }));
    this.scene.add(this.marker);
  }

  updateLayerMarker() {
    const [W, , D] = this.stamp.size;
    this.marker.scale.set(W + 0.02, 1.02, D + 0.02);
    this.marker.position.set(0, this.layer + 0.5, 0);
  }

  refresh(refit = false) {
    this.drawGrid();
    disposeBlockGroup(this.group);
    const v = stampToVoxels(this.stamp);
    this.group = buildBlockGroup(v);
    this.group.position.set(-v.W / 2, 0, -v.D / 2);
    this.scene.add(this.group);
    const bg = document.documentElement.dataset.resolvedTheme === 'light' ? 0xdfe8ef : 0x15181d;
    this.scene.background = new THREE.Color(bg);
    const canvas = this.renderer.domElement;
    const w = canvas.clientWidth || 300, h = canvas.clientHeight || 300;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
    if (refit) {
      const r = Math.max(v.W, v.H, v.D);
      this.controls.target.set(0, v.H / 2, 0);
      this.camera.position.set(r * 1.4, v.H / 2 + r * 0.9, r * 1.7);
    }
    this.updateLayerMarker();
    document.getElementById('se-count').textContent = `${Object.keys(this.stamp.blocks).length} blocks`;
  }
}

// Mesh geometry of a stamp for the design view: blocks with vertex colors, `unit` design
// units per block, x/z centered on the origin, base at y = 0.
export function stampGeometry(stamp, unit) {
  const [W, , D] = stamp.size;
  const parts = [];
  const col = new THREE.Color();
  for (const [k, st] of Object.entries(stamp.blocks)) {
    const src = stateGeometry(st);
    if (!src.attributes.position) continue;
    const [x, y, z] = k.split(',').map(Number);
    const g = src.index ? src.toNonIndexed() : src.clone();
    for (const name of Object.keys(g.attributes)) if (!['position', 'normal'].includes(name)) g.deleteAttribute(name);
    g.translate(x + 0.5 - W / 2, y + 0.5, z + 0.5 - D / 2);
    g.scale(unit, unit, unit);
    col.set(stateColor(st));
    const n = g.attributes.position.count;
    const c = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { c[i * 3] = col.r; c[i * 3 + 1] = col.g; c[i * 3 + 2] = col.b; }
    g.setAttribute('color', new THREE.BufferAttribute(c, 3));
    parts.push(g);
  }
  if (!parts.length) {
    const g = new THREE.BoxGeometry(unit * W, unit * 0.1, unit * D).translate(0, unit * 0.05, 0).toNonIndexed();
    g.deleteAttribute('uv');
    g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 3).fill(0.6), 3));
    return g;
  }
  const merged = mergeGeometries(parts);
  parts.forEach((p) => p.dispose());
  return merged;
}

// Small orbitable 3D preview of a voxel grid (used by the wall and pillar builders).
export class Preview3D {
  constructor(canvas) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(45, 1, 0.1, 1000);
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x445566, 1.6));
    const sun = new THREE.DirectionalLight(0xffffff, 1.6);
    sun.position.set(0.6, 1, 0.35);
    this.scene.add(sun);
    this.group = null;
    this.running = false;
  }
  show(v, refit = false) {
    disposeBlockGroup(this.group);
    this.group = buildBlockGroup(v);
    this.group.position.set(-v.W / 2, 0, -v.D / 2);
    this.scene.add(this.group);
    const light = document.documentElement.dataset.resolvedTheme === 'light';
    this.scene.background = new THREE.Color(light ? 0xdfe8ef : 0x15181d);
    const w = this.canvas.clientWidth || 300, h = this.canvas.clientHeight || 300;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
    if (refit) {
      const r = Math.max(v.W, v.H, v.D);
      this.controls.target.set(0, v.H / 2, 0);
      this.camera.position.set(r * 0.9, v.H / 2 + r * 0.6, r * 1.5);
    }
  }
  start() {
    if (this.running) return;
    this.running = true;
    const loop = () => { if (!this.running) return; requestAnimationFrame(loop); this.controls.update(); this.renderer.render(this.scene, this.camera); };
    loop();
  }
  stop() { this.running = false; }
}
