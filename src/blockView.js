import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { BLOCKS, FULL, BOTTOM, TOP, STAIR, CUSTOM } from './blocks.js';
import { maskGeometry, stateGeometry } from './blockShapes.js';
import { stateColor } from './blockstates.js';

function blockTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 16;
  const g = c.getContext('2d');
  g.fillStyle = '#ffffff'; g.fillRect(0, 0, 16, 16);
  // subtle noise so it reads as "blocky"
  for (let i = 0; i < 40; i++) {
    const v = 225 + Math.floor(Math.random() * 30);
    g.fillStyle = `rgb(${v},${v},${v})`;
    g.fillRect(Math.floor(Math.random() * 16), Math.floor(Math.random() * 16), 1, 1);
  }
  g.strokeStyle = 'rgba(0,0,0,0.35)'; g.lineWidth = 1;
  g.strokeRect(0.5, 0.5, 15, 15);
  const t = new THREE.CanvasTexture(c);
  t.magFilter = THREE.NearestFilter;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export const blockMaterial = new THREE.MeshLambertMaterial({ map: blockTexture() });

/**
 * Build instanced meshes for a voxel grid. Block (x, y, z) occupies [x, x+1] x [y, y+1] x [z, z+1]
 * in the returned group's space. Layers above `maxLayer` are skipped; layers below `dimBelow`
 * are darkened (for the layer cut view).
 */
export function buildBlockGroup(v, { maxLayer = v.H - 1, dimBelow = -1, material = blockMaterial } = {}) {
  const group = new THREE.Group();
  const { W, D, kind, mat, meta } = v;
  const WD = W * D, top = maxLayer;
  const isFull = (i) => kind[i] === FULL;
  const buckets = new Map(); // geometry key -> { geo, list }
  const add = (key, geoFn, i) => {
    let b = buckets.get(key);
    if (!b) { b = { geo: geoFn(), list: [] }; buckets.set(key, b); }
    b.list.push(i);
  };
  for (let y = 0; y <= top; y++) {
    for (let z = 0; z < D; z++) {
      for (let x = 0; x < W; x++) {
        const i = x + z * W + y * WD;
        const k = kind[i];
        if (!k) continue;
        if (k === FULL) {
          // skip fully hidden blocks
          if (x > 0 && x < W - 1 && z > 0 && z < D - 1 && y > 0 && y < top &&
              isFull(i - 1) && isFull(i + 1) && isFull(i - W) && isFull(i + W) && isFull(i - WD) && isFull(i + WD)) continue;
          add('full', () => maskGeometry(0xff), i);
        } else if (k === BOTTOM) add('bottom', () => maskGeometry(0x0f), i);
        else if (k === TOP) add('top', () => maskGeometry(0xf0), i);
        else if (k === STAIR) add('m' + meta[i], () => maskGeometry(meta[i]), i);
        else if (k === CUSTOM) { const st = v.custom[meta[i]]; add('s' + st, () => stateGeometry(st), i); }
      }
    }
  }
  const m4 = new THREE.Matrix4();
  const col = new THREE.Color();
  const colors = BLOCKS.map((b) => new THREE.Color(b.color));
  const customColors = (v.custom || []).map((st) => new THREE.Color(stateColor(st)));
  for (const { geo, list } of buckets.values()) {
    const mesh = new THREE.InstancedMesh(geo, material, list.length);
    list.forEach((i, n) => {
      const y = Math.floor(i / WD), r = i - y * WD, z = Math.floor(r / W), x = r - z * W;
      m4.makeTranslation(x + 0.5, y + 0.5, z + 0.5);
      mesh.setMatrixAt(n, m4);
      col.copy(kind[i] === CUSTOM ? customColors[meta[i]] : colors[mat[i]]);
      if (y < dimBelow) col.multiplyScalar(0.45);
      mesh.setColorAt(n, col);
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    group.add(mesh);
  }
  return group;
}

export function disposeBlockGroup(group) {
  if (!group) return;
  group.parent && group.parent.remove(group);
  for (const m of group.children) m.dispose();
}

// 3D preview of the voxelized result, in block units (1 unit = 1 block).
export class BlockView {
  constructor(domElement) {
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(50, 1, 0.1, 5000);
    this.camera.position.set(30, 30, 30);
    this.controls = new OrbitControls(this.camera, domElement);
    this.controls.enableDamping = true;
    this.controls.enabled = false;

    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x445566, 1.6));
    const sun = new THREE.DirectionalLight(0xffffff, 1.6);
    sun.position.set(0.6, 1, 0.35);
    this.scene.add(sun);

    this.group = null;
    this.grid = null;
    this.layerFrame = null;
    this.v = null;
    this.maxLayer = 0;
  }

  setVoxels(v, refit) {
    this.v = v;
    this.maxLayer = v.H - 1;
    if (this.grid) { this.scene.remove(this.grid); this.grid.geometry.dispose(); }
    const size = Math.max(v.W, v.D) + 8;
    this.grid = new THREE.GridHelper(size, size, 0x557755, 0x334433);
    // line up grid lines with block edges (block edges sit at x - W/2)
    this.grid.position.set(((v.W + size) % 2) * 0.5, -0.001, ((v.D + size) % 2) * 0.5);
    this.scene.add(this.grid);
    this.rebuild();
    if (refit) this.frame();
  }

  setLayer(y) { this.maxLayer = y; this.rebuild(); }

  frame() {
    if (!this.v) return;
    const { W, H, D } = this.v;
    const r = Math.max(W, H, D);
    this.controls.target.set(0, H / 2, 0);
    this.camera.position.set(r * 1.1, H / 2 + r * 0.8, r * 1.3);
    this.controls.update();
  }

  rebuild() {
    disposeBlockGroup(this.group);
    this.group = null;
    if (this.layerFrame) { this.scene.remove(this.layerFrame); this.layerFrame.geometry.dispose(); this.layerFrame = null; }
    const v = this.v;
    if (!v) return;
    const { W, H, D } = v;
    const top = this.maxLayer;
    const clipped = top < H - 1;
    this.group = buildBlockGroup(v, { maxLayer: top, dimBelow: clipped ? top : -1 });
    this.group.position.set(-W / 2, 0, -D / 2);
    this.scene.add(this.group);
    if (clipped) {
      const g = new THREE.EdgesGeometry(new THREE.BoxGeometry(W, 1, D));
      this.layerFrame = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0xff6b9a }));
      this.layerFrame.position.set(0, top + 0.5, 0);
      this.scene.add(this.layerFrame);
    }
  }

  resize(w, h) { this.camera.aspect = w / h; this.camera.updateProjectionMatrix(); }
  update() { this.controls.update(); }
}
