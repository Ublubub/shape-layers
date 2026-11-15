import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { BLOCKS, FULL, BOTTOM, STAIR } from './blocks.js';

// Geometry for a stair from its octant mask (bit = x + 2*z + 4*y). Bottom/top half is one slab box.
const stairCache = new Map();
function stairGeometry(mask) {
  if (stairCache.has(mask)) return stairCache.get(mask);
  const parts = [];
  const low = mask & 0xf, high = (mask >> 4) & 0xf;
  const slabY = low === 0xf ? -0.25 : 0.25;
  const partBits = low === 0xf ? high : low;
  const partY = low === 0xf ? 0.25 : -0.25;
  parts.push(new THREE.BoxGeometry(1, 0.5, 1).translate(0, slabY, 0));
  for (let q = 0; q < 4; q++) {
    if ((partBits >> q) & 1) parts.push(new THREE.BoxGeometry(0.5, 0.5, 0.5).translate((q & 1) ? 0.25 : -0.25, partY, (q >> 1) ? 0.25 : -0.25));
  }
  const g = mergeGeometries(parts);
  parts.forEach((p) => p.dispose());
  stairCache.set(mask, g);
  return g;
}

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

    this.material = new THREE.MeshLambertMaterial({ map: blockTexture() });
    this.fullGeo = new THREE.BoxGeometry(1, 1, 1);
    this.slabGeo = new THREE.BoxGeometry(1, 0.5, 1);
    this.meshes = [];
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
    for (const m of this.meshes) { this.scene.remove(m); m.dispose(); }
    this.meshes = [];
    if (this.layerFrame) { this.scene.remove(this.layerFrame); this.layerFrame.geometry.dispose(); this.layerFrame = null; }
    const v = this.v;
    if (!v) return;
    const { W, H, D, kind, mat } = v;
    const WD = W * D, top = this.maxLayer;
    const clipped = top < H - 1;
    const isFull = (i) => kind[i] === FULL;

    const fulls = [], slabs = [], stairs = new Map();
    for (let y = 0; y <= top; y++) {
      for (let z = 0; z < D; z++) {
        for (let x = 0; x < W; x++) {
          const i = x + z * W + y * WD;
          const k = kind[i];
          if (!k) continue;
          // skip fully hidden blocks
          if (k === FULL && x > 0 && x < W - 1 && z > 0 && z < D - 1 && y > 0 && y < top &&
              isFull(i - 1) && isFull(i + 1) && isFull(i - W) && isFull(i + W) && isFull(i - WD) && isFull(i + WD)) continue;
          if (k === STAIR) {
            const m = v.meta[i];
            if (!stairs.has(m)) stairs.set(m, []);
            stairs.get(m).push(i);
          } else (k === FULL ? fulls : slabs).push(i);
        }
      }
    }

    const m4 = new THREE.Matrix4();
    const col = new THREE.Color();
    const colors = BLOCKS.map((b) => new THREE.Color(b.color));
    const make = (list, geo, kindOf) => {
      if (!list.length) return;
      const mesh = new THREE.InstancedMesh(geo, this.material, list.length);
      list.forEach((i, n) => {
        const y = Math.floor(i / WD), r = i - y * WD, z = Math.floor(r / W), x = r - z * W;
        let yy = y + 0.5;
        if (kindOf === 'slab') yy = kind[i] === BOTTOM ? y + 0.25 : y + 0.75;
        m4.makeTranslation(x - W / 2 + 0.5, yy, z - D / 2 + 0.5);
        mesh.setMatrixAt(n, m4);
        col.copy(colors[mat[i]]);
        if (clipped && y < top) col.multiplyScalar(0.45);
        mesh.setColorAt(n, col);
      });
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      this.scene.add(mesh);
      this.meshes.push(mesh);
    };
    make(fulls, this.fullGeo, 'full');
    make(slabs, this.slabGeo, 'slab');
    for (const [m, list] of stairs) make(list, stairGeometry(m), 'stair');

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
