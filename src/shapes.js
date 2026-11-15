import * as THREE from 'three';
import { vaultProfile } from './voxelizer.js';

// Shape-specific parameters shown in the properties panel.
const THICKNESS = (def, hint) => ({ key: 'thickness', label: 'Shell thickness', min: 0, max: 50, step: 0.5, def, hint });
const ROUNDNESS = { key: 'roundness', label: 'Roundness', min: 1, max: 6, step: 0.1, def: 2, hint: '2 = oval/circle · higher = boxier · lower = pointier' };
const JOIN = (def) => ({ key: 'join', type: 'bool', label: 'Join with other roofs', def, hint: 'hollow insides merge with other joined shapes (crossings, branches)' });
const FLATTEN = { key: 'flatten', label: 'Flatten', min: 0, max: 0.9, step: 0.05, def: 0, hint: '0 = springs vertically · higher = flatter segment of the curve' };

// Display geometry for each unit primitive. Must match the inside tests in voxelizer.js:
// every shape fits the cube [-0.5, 0.5]^3 in its own local space.
export const SHAPE_TYPES = [
  { type: 'box',      label: 'Box',      icon: '■', scale: [4, 4, 4] },
  { type: 'sphere',   label: 'Sphere',   icon: '●', scale: [6, 6, 6], params: [THICKNESS(0, 'in blocks · 0 = solid'), JOIN(false)] },
  { type: 'cylinder', label: 'Cylinder', icon: '▮', scale: [4, 6, 4] },
  { type: 'tube',     label: 'Tube',     icon: '◎', scale: [6, 6, 6], params: [THICKNESS(1, 'wall thickness in blocks'), JOIN(false)] },
  { type: 'cone',     label: 'Cone',     icon: '▲', scale: [5, 6, 5] },
  { type: 'pyramid',  label: 'Pyramid',  icon: '△', scale: [6, 5, 6] },
  { type: 'dome',     label: 'Dome',     icon: '◠', scale: [8, 4, 8], params: [THICKNESS(0, 'in blocks · 0 = solid'), JOIN(true)] },
  { type: 'vault',    label: 'Vault',    icon: '⌒', scale: [19, 6, 24], params: [THICKNESS(1, 'roof thickness in blocks · 0 = solid'), ROUNDNESS, FLATTEN, JOIN(true)] },
  { type: 'torus',    label: 'Torus',    icon: '◯', scale: [8, 8, 8] },
  { type: 'wedge',    label: 'Ramp',     icon: '◣', scale: [4, 4, 4] },
];

export const typeDef = (type) => SHAPE_TYPES.find((t) => t.type === type) || SHAPE_TYPES[0];

export function defaultParams(type) {
  const p = {};
  for (const d of typeDef(type).params || []) p[d.key] = d.def;
  return p;
}

// Parameters handed to the voxelizer (includes absolute scale so thickness is in blocks/units).
export function voxelParams(s) {
  return { ...defaultParams(s.type), ...(s.params || {}), sx: Math.abs(s.scale[0]), sy: Math.abs(s.scale[1]), sz: Math.abs(s.scale[2]) };
}

const shared = new Map();

// Returns a key that changes whenever the display geometry must be rebuilt.
export function geometryKey(s) {
  if (s.type === 'vault' || s.type === 'tube') {
    const p = voxelParams(s);
    return `${s.type}|${p.thickness}|${p.roundness}|${p.flatten}|${p.thickness ? p.sx.toFixed(2) + ',' + p.sy.toFixed(2) + ',' + p.sz.toFixed(2) : ''}`;
  }
  return s.type;
}

export function isSharedGeometry(g) { return [...shared.values()].includes(g); }

export function buildGeometry(s) {
  if (s.type === 'vault') return vaultGeometry(voxelParams(s));
  if (s.type === 'tube') return tubeGeometry(voxelParams(s));
  if (shared.has(s.type)) return shared.get(s.type);
  let g;
  switch (s.type) {
    case 'box': g = new THREE.BoxGeometry(1, 1, 1); break;
    case 'sphere': g = new THREE.SphereGeometry(0.5, 40, 24); break;
    case 'cylinder': g = new THREE.CylinderGeometry(0.5, 0.5, 1, 40); break;
    case 'cone': g = new THREE.ConeGeometry(0.5, 1, 40); break;
    case 'pyramid':
      g = new THREE.ConeGeometry(Math.SQRT1_2, 1, 4, 1);
      g.rotateY(Math.PI / 4);
      break;
    case 'dome':
      g = new THREE.SphereGeometry(0.5, 40, 16, 0, Math.PI * 2, 0, Math.PI / 2);
      g.scale(1, 2, 1);
      g.translate(0, -0.5, 0);
      break;
    case 'torus':
      g = new THREE.TorusGeometry(0.35, 0.15, 20, 48);
      g.rotateX(Math.PI / 2);
      break;
    case 'wedge': {
      const sh = new THREE.Shape();
      sh.moveTo(-0.5, -0.5); sh.lineTo(0.5, -0.5); sh.lineTo(-0.5, 0.5); sh.closePath();
      g = new THREE.ExtrudeGeometry(sh, { depth: 1, bevelEnabled: false });
      g.translate(0, 0, -0.5);
      break;
    }
    default: g = new THREE.BoxGeometry(1, 1, 1);
  }
  g.computeVertexNormals();
  shared.set(s.type, g);
  return g;
}

function tubeGeometry(p) {
  const inner = Math.max(0.01, 0.5 - (p.thickness || 0.2 * p.sx) / p.sx);
  const pts = [new THREE.Vector2(inner, -0.5), new THREE.Vector2(0.5, -0.5), new THREE.Vector2(0.5, 0.5), new THREE.Vector2(inner, 0.5), new THREE.Vector2(inner, -0.5)];
  return new THREE.LatheGeometry(pts, 48);
}

// Points on the super-ellipse |x/a|^n + |(y-yc)/b|^n = 1 at angle th
function sePoint(a, b, yc, n, th) {
  const c = Math.cos(th), s = Math.sin(th), e = 2 / n;
  return new THREE.Vector2(a * Math.sign(c) * Math.abs(c) ** e, yc + b * Math.sign(s) * Math.abs(s) ** e);
}

function vaultGeometry(p) {
  const v = vaultProfile(p);
  const N = 64;
  const th0 = Math.asin(Math.min(1, v.d ** (v.n / 2)));
  const sh = new THREE.Shape();
  for (let i = 0; i <= N; i++) {
    const pt = sePoint(v.a, v.b, v.yc, v.n, th0 + (Math.PI - 2 * th0) * (i / N));
    if (i === 0) sh.moveTo(pt.x, -0.5); else sh.lineTo(pt.x, i === N ? -0.5 : pt.y);
  }
  const reach = v.hollow ? (v.d * v.b) / v.bi : 2; // inner curve reaches the base only if < 1
  if (v.hollow && reach < 1) {
    const thi = Math.asin(Math.min(1, reach ** (v.n / 2)));
    for (let i = 0; i <= N; i++) {
      const pt = sePoint(v.ai, v.bi, v.yc, v.n, Math.PI - thi - (Math.PI - 2 * thi) * (i / N));
      sh.lineTo(pt.x, i === 0 || i === N ? -0.5 : pt.y);
    }
  }
  sh.closePath();
  const g = new THREE.ExtrudeGeometry(sh, { depth: 1, bevelEnabled: false, curveSegments: 1 });
  g.translate(0, 0, -0.5);
  g.computeVertexNormals();
  return g;
}
