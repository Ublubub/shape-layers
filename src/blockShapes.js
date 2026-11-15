import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { parseState, shapeFamily, stairMaskFromProps } from './blockstates.js';

// All geometries live in a unit cell centered on the origin: [-0.5, 0.5]^3.

const maskCache = new Map();
// Geometry from an octant mask (bit = x + 2*z + 4*y). Full halves are merged into one box.
export function maskGeometry(mask) {
  if (maskCache.has(mask)) return maskCache.get(mask);
  const parts = [];
  const low = mask & 0xf, high = (mask >> 4) & 0xf;
  if (mask === 0xff) parts.push(new THREE.BoxGeometry(1, 1, 1));
  else {
    for (const [bits, y] of [[low, -0.25], [high, 0.25]]) {
      if (bits === 0xf) { parts.push(new THREE.BoxGeometry(1, 0.5, 1).translate(0, y, 0)); continue; }
      for (let q = 0; q < 4; q++) {
        if ((bits >> q) & 1) parts.push(new THREE.BoxGeometry(0.5, 0.5, 0.5).translate((q & 1) ? 0.25 : -0.25, y, (q >> 1) ? 0.25 : -0.25));
      }
    }
  }
  const g = parts.length ? mergeGeometries(parts) : new THREE.BufferGeometry();
  parts.forEach((p) => p.dispose());
  maskCache.set(mask, g);
  return g;
}

const stateCache = new Map();
// Approximate geometry for any block state (shape only, no textures).
export function stateGeometry(state) {
  if (stateCache.has(state)) return stateCache.get(state);
  const st = parseState(state);
  const p = st.props;
  const T = 3 / 16;
  let g;
  switch (shapeFamily(st.name)) {
    case 'stairs': g = maskGeometry(stairMaskFromProps(p)); break;
    case 'slab': g = maskGeometry(p.type === 'top' ? 0xf0 : p.type === 'double' ? 0xff : 0x0f); break;
    case 'trapdoor':
      if (p.open === 'true') {
        // an open trapdoor stands against the side opposite its facing
        const off = 0.5 - T / 2;
        const pos = { north: [0, 0, off], south: [0, 0, -off], east: [-off, 0, 0], west: [off, 0, 0] }[p.facing || 'north'];
        const ns = p.facing === 'north' || p.facing === 'south' || !p.facing;
        g = new THREE.BoxGeometry(ns ? 1 : T, 1, ns ? T : 1).translate(...pos);
      } else {
        g = new THREE.BoxGeometry(1, T, 1).translate(0, p.half === 'top' ? 0.5 - T / 2 : -0.5 + T / 2, 0);
      }
      break;
    case 'carpet': g = new THREE.BoxGeometry(1, 1 / 16, 1).translate(0, -0.5 + 1 / 32, 0); break;
    case 'post': {
      const parts = [new THREE.BoxGeometry(0.25, 1, 0.25)];
      // fences / walls / panes / bars: arms toward connected sides
      const arms = { north: [0, 0, -0.3125], south: [0, 0, 0.3125], east: [0.3125, 0, 0], west: [-0.3125, 0, 0] };
      for (const [side, pos] of Object.entries(arms)) {
        if (p[side] === 'true' || p[side] === 'low' || p[side] === 'tall') {
          const ns = side === 'north' || side === 'south';
          parts.push(new THREE.BoxGeometry(ns ? 0.15 : 0.375, 0.6, ns ? 0.375 : 0.15).translate(pos[0], 0.1, pos[2]));
        }
      }
      if (p.axis === 'x') parts[0].rotateZ(Math.PI / 2);
      if (p.axis === 'z') parts[0].rotateX(Math.PI / 2);
      g = mergeGeometries(parts);
      break;
    }
    case 'small': {
      const hanging = p.hanging === 'true';
      g = new THREE.BoxGeometry(0.375, 0.5, 0.375).translate(0, hanging ? 0.15 : -0.25, 0);
      break;
    }
    case 'air': g = new THREE.BufferGeometry(); break;
    default: g = new THREE.BoxGeometry(1, 1, 1);
  }
  stateCache.set(state, g);
  return g;
}
