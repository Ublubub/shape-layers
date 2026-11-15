import * as THREE from 'three';

// Display geometry for each unit primitive. Must match the inside tests in voxelizer.js:
// every shape fits the cube [-0.5, 0.5]^3 in its local space.
export const SHAPE_TYPES = [
  { type: 'box',      label: 'Box',      icon: '■', scale: [4, 4, 4] },
  { type: 'sphere',   label: 'Sphere',   icon: '●', scale: [6, 6, 6] },
  { type: 'cylinder', label: 'Cylinder', icon: '▮', scale: [4, 6, 4] },
  { type: 'tube',     label: 'Tube',     icon: '◎', scale: [6, 6, 6] },
  { type: 'cone',     label: 'Cone',     icon: '▲', scale: [5, 6, 5] },
  { type: 'pyramid',  label: 'Pyramid',  icon: '△', scale: [6, 5, 6] },
  { type: 'dome',     label: 'Dome',     icon: '◠', scale: [8, 4, 8] },
  { type: 'torus',    label: 'Torus',    icon: '◯', scale: [8, 8, 8] },
  { type: 'wedge',    label: 'Ramp',     icon: '◣', scale: [4, 4, 4] },
];

const cache = new Map();

export function getGeometry(type) {
  if (cache.has(type)) return cache.get(type);
  let g;
  switch (type) {
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
      const s = new THREE.Shape();
      s.moveTo(-0.5, -0.5); s.lineTo(0.5, -0.5); s.lineTo(-0.5, 0.5); s.closePath();
      g = new THREE.ExtrudeGeometry(s, { depth: 1, bevelEnabled: false });
      g.translate(0, 0, -0.5);
      break;
    }
    case 'tube': {
      const pts = [new THREE.Vector2(0.3, -0.5), new THREE.Vector2(0.5, -0.5), new THREE.Vector2(0.5, 0.5), new THREE.Vector2(0.3, 0.5), new THREE.Vector2(0.3, -0.5)];
      g = new THREE.LatheGeometry(pts, 48);
      break;
    }
    default: g = new THREE.BoxGeometry(1, 1, 1);
  }
  g.computeVertexNormals();
  cache.set(type, g);
  return g;
}
