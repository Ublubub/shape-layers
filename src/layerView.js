import { BLOCKS, FULL, BOTTOM, TOP, STAIR, stairInfo, blockLabel } from './blocks.js';

const DIRS = { north: [0, -1], south: [0, 1], east: [1, 0], west: [-1, 0] };
function drawArrow(ctx, x, y, r, facing, color) {
  const [dx, dy] = DIRS[facing];
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(x + dx * r, y + dy * r);
  ctx.lineTo(x - dx * r * 0.6 - dy * r * 0.7, y - dy * r * 0.6 + dx * r * 0.7);
  ctx.lineTo(x - dx * r * 0.6 + dy * r * 0.7, y - dy * r * 0.6 - dx * r * 0.7);
  ctx.closePath();
  ctx.fill();
}

// Draw one layer (top-down, north = up, x to the right, z downward) into a 2D context.
export function drawLayer(ctx, v, y, opts) {
  const { cs, ox = 0, oy = 0, ghost = true, grid = true, theme } = opts;
  const { W, D, kind, mat } = v;
  const WD = W * D;
  const base = y * WD;

  ctx.fillStyle = theme.bg;
  ctx.fillRect(ox, oy, W * cs, D * cs);

  // ghost of the layer below
  if (ghost && y > 0) {
    ctx.fillStyle = theme.ghost;
    const b = base - WD;
    for (let z = 0; z < D; z++)
      for (let x = 0; x < W; x++)
        if (kind[b + x + z * W]) ctx.fillRect(ox + x * cs, oy + z * cs, cs, cs);
  }

  for (let z = 0; z < D; z++) {
    for (let x = 0; x < W; x++) {
      const i = base + x + z * W;
      const k = kind[i];
      if (!k) continue;
      const px = ox + x * cs, py = oy + z * cs;
      const col = BLOCKS[mat[i]].color;
      ctx.fillStyle = col;
      if (k === FULL) {
        ctx.fillRect(px, py, cs, cs);
      } else if (k === STAIR) {
        // stair: tinted cell, the full-height quarters solid, arrow toward facing
        const m = v.meta[i];
        ctx.globalAlpha = 0.4;
        ctx.fillRect(px, py, cs, cs);
        ctx.globalAlpha = 1;
        const h = cs / 2;
        for (let qi = 0; qi < 4; qi++) {
          if ((m >> qi) & 1 && (m >> (qi + 4)) & 1) ctx.fillRect(px + (qi & 1) * h, py + (qi >> 1) * h, h, h);
        }
        const s = stairInfo(m);
        if (s.half === 'top' && cs >= 6) {
          ctx.strokeStyle = theme.center; ctx.lineWidth = Math.max(1, cs / 12);
          ctx.strokeRect(px + ctx.lineWidth / 2, py + ctx.lineWidth / 2, cs - ctx.lineWidth, cs - ctx.lineWidth);
        }
        if (cs >= 12) drawArrow(ctx, px + h, py + h, cs * 0.3, s.facing, theme.slabMark);
      } else {
        // slab: tinted cell with a "b" (bottom) or "t" (top)
        ctx.globalAlpha = k === BOTTOM ? 0.45 : 0.7;
        ctx.fillRect(px, py, cs, cs);
        ctx.globalAlpha = 1;
        if (cs >= 10) {
          ctx.fillStyle = theme.slabText;
          ctx.font = `bold ${Math.floor(cs * 0.5)}px system-ui, sans-serif`;
          ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
          ctx.fillText(k === BOTTOM ? 'b' : 't', px + cs / 2, py + cs / 2 + 1);
        } else {
          ctx.fillStyle = theme.slabText;
          ctx.fillRect(px + cs * 0.3, py + (k === BOTTOM ? cs * 0.6 : cs * 0.2), cs * 0.4, cs * 0.2);
        }
      }
    }
  }

  if (grid && cs >= 5) {
    ctx.lineWidth = 1;
    for (let x = 0; x <= W; x++) {
      ctx.strokeStyle = x % 10 === 0 ? theme.grid10 : x % 5 === 0 ? theme.grid5 : theme.grid;
      ctx.beginPath(); ctx.moveTo(Math.round(ox + x * cs) + 0.5, oy); ctx.lineTo(Math.round(ox + x * cs) + 0.5, oy + D * cs); ctx.stroke();
    }
    for (let z = 0; z <= D; z++) {
      ctx.strokeStyle = z % 10 === 0 ? theme.grid10 : z % 5 === 0 ? theme.grid5 : theme.grid;
      ctx.beginPath(); ctx.moveTo(ox, Math.round(oy + z * cs) + 0.5); ctx.lineTo(ox + W * cs, Math.round(oy + z * cs) + 0.5); ctx.stroke();
    }
  }
  // center marks
  ctx.strokeStyle = theme.center;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(ox + (W / 2) * cs, oy - 6); ctx.lineTo(ox + (W / 2) * cs, oy);
  ctx.moveTo(ox + (W / 2) * cs, oy + D * cs); ctx.lineTo(ox + (W / 2) * cs, oy + D * cs + 6);
  ctx.moveTo(ox - 6, oy + (D / 2) * cs); ctx.lineTo(ox, oy + (D / 2) * cs);
  ctx.moveTo(ox + W * cs, oy + (D / 2) * cs); ctx.lineTo(ox + W * cs + 6, oy + (D / 2) * cs);
  ctx.stroke();
}

export const LIGHT_THEME = {
  bg: '#ffffff', ghost: 'rgba(0,0,0,0.10)', grid: 'rgba(0,0,0,0.12)', grid5: 'rgba(0,0,0,0.3)',
  grid10: 'rgba(0,0,0,0.6)', center: '#e0457b', slabMark: 'rgba(255,255,255,0.95)', slabText: 'rgba(0,0,0,0.7)',
};
export const DARK_THEME = {
  bg: '#1b1d22', ghost: 'rgba(255,255,255,0.10)', grid: 'rgba(255,255,255,0.08)', grid5: 'rgba(255,255,255,0.22)',
  grid10: 'rgba(255,255,255,0.45)', center: '#ff6b9a', slabMark: 'rgba(255,255,255,0.95)', slabText: 'rgba(255,255,255,0.85)',
};

// Octant mask (bit = x + 2*z + 4*y) for any voxel kind.
export function octMask(kind, meta) {
  if (kind === FULL) return 0xff;
  if (kind === BOTTOM) return 0x0f;
  if (kind === TOP) return 0xf0;
  if (kind === STAIR) return meta;
  return 0;
}

// Sizes of a view: horizontal cells (U), vertical cells (V), number of slices (N).
export function viewDims(v, mode) {
  if (mode === 'front') return { U: v.W, V: v.H, N: v.D }; // looking along z: x right, y up
  if (mode === 'side') return { U: v.D, V: v.H, N: v.W };  // looking along x: z right, y up
  return { U: v.W, V: v.D, N: v.H };                         // top: x right, z down
}

// Grid index of the cell at (u, row) in a section view. Row 0 is the TOP row on screen.
export function sectionIndex(v, mode, u, row, k) {
  const y = v.H - 1 - row;
  return mode === 'front' ? u + k * v.W + y * v.W * v.D : k + u * v.W + y * v.W * v.D;
}

const projCache = new WeakMap();
function projection(v, mode) {
  let c = projCache.get(v);
  if (!c) { c = {}; projCache.set(v, c); }
  if (c[mode]) return c[mode];
  const { U, V, N } = viewDims(v, mode);
  const p = new Uint8Array(U * V);
  for (let row = 0; row < V; row++)
    for (let u = 0; u < U; u++)
      for (let k = 0; k < N; k++) if (v.kind[sectionIndex(v, mode, u, row, k)]) { p[u + row * U] = 1; break; }
  return (c[mode] = p);
}

function drawGrid(ctx, U, V, cs, ox, oy, theme, fromBottom) {
  ctx.lineWidth = 1;
  for (let x = 0; x <= U; x++) {
    ctx.strokeStyle = x % 10 === 0 ? theme.grid10 : x % 5 === 0 ? theme.grid5 : theme.grid;
    ctx.beginPath(); ctx.moveTo(Math.round(ox + x * cs) + 0.5, oy); ctx.lineTo(Math.round(ox + x * cs) + 0.5, oy + V * cs); ctx.stroke();
  }
  for (let r = 0; r <= V; r++) {
    const n = fromBottom ? V - r : r;
    ctx.strokeStyle = n % 10 === 0 ? theme.grid10 : n % 5 === 0 ? theme.grid5 : theme.grid;
    ctx.beginPath(); ctx.moveTo(ox, Math.round(oy + r * cs) + 0.5); ctx.lineTo(ox + U * cs, Math.round(oy + r * cs) + 0.5); ctx.stroke();
  }
}

/**
 * Vertical cross-section. mode 'front' = slice at z = k (x right, y up);
 * 'side' = slice at x = k (z right, y up). Each block is drawn as 2 x 2 quarters
 * from its octants, so slabs and stairs show their real profile. A quarter that is
 * only half-filled along the viewing direction (e.g. a corner stair) is drawn faded.
 */
export function drawSection(ctx, v, mode, k, opts) {
  const { cs, ox = 0, oy = 0, ghost = true, grid = true, theme, highlightY = -1 } = opts;
  const { U, V } = viewDims(v, mode);
  const { kind, mat, meta } = v;
  ctx.fillStyle = theme.bg;
  ctx.fillRect(ox, oy, U * cs, V * cs);

  // ghost: everything in other slices, flattened (shows pillars behind the cut)
  if (ghost) {
    const p = projection(v, mode);
    ctx.fillStyle = theme.ghost;
    for (let row = 0; row < V; row++)
      for (let u = 0; u < U; u++) if (p[u + row * U]) ctx.fillRect(ox + u * cs, oy + row * cs, cs, cs);
  }

  const h = cs / 2;
  for (let row = 0; row < V; row++) {
    for (let u = 0; u < U; u++) {
      const i = sectionIndex(v, mode, u, row, k);
      const kd = kind[i];
      if (!kd) continue;
      const m = octMask(kd, meta[i]);
      const px = ox + u * cs, py = oy + row * cs;
      ctx.fillStyle = BLOCKS[mat[i]].color;
      for (let hv = 0; hv < 2; hv++) {
        for (let hu = 0; hu < 2; hu++) {
          // the two octants along the viewing direction
          const a = mode === 'front' ? hu + 4 * hv : 2 * hu + 4 * hv;
          const b = mode === 'front' ? a + 2 : a + 1;
          const n = ((m >> a) & 1) + ((m >> b) & 1);
          if (!n) continue;
          ctx.globalAlpha = n === 2 ? 1 : 0.45;
          ctx.fillRect(px + hu * h, py + (1 - hv) * h, h, h);
        }
      }
      ctx.globalAlpha = 1;
    }
  }

  if (grid && cs >= 5) drawGrid(ctx, U, V, cs, ox, oy, theme, true);
  if (highlightY >= 0 && highlightY < V) {
    ctx.strokeStyle = theme.center; ctx.lineWidth = 1.5;
    ctx.strokeRect(ox - 4, oy + (V - 1 - highlightY) * cs, U * cs + 8, cs);
  }
  ctx.strokeStyle = theme.center; ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(ox + (U / 2) * cs, oy + V * cs); ctx.lineTo(ox + (U / 2) * cs, oy + V * cs + 6);
  ctx.moveTo(ox + (U / 2) * cs, oy - 6); ctx.lineTo(ox + (U / 2) * cs, oy);
  ctx.stroke();
}

// Inner clear height and span measured on a section slice (for the info line).
export function sectionStats(v, mode, k) {
  const { U, V } = viewDims(v, mode);
  const mid = Math.floor(U / 2);
  let clear = 0;
  for (let row = V - 1; row >= 0; row--) {
    if (v.kind[sectionIndex(v, mode, mid, row, k)]) break;
    clear++;
  }
  let lo = -1, hi = -1;
  for (let u = 0; u < U; u++) {
    for (let row = 0; row < V; row++) if (v.kind[sectionIndex(v, mode, u, row, k)]) { if (lo < 0) lo = u; hi = u; break; }
  }
  return { clear: clear === V ? null : clear, width: lo < 0 ? 0 : hi - lo + 1, mid };
}

export class LayerView {
  constructor(canvas, tooltip) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.tooltip = tooltip;
    this.v = null; this.layer = 0;
    this.mode = 'top';                  // 'top' | 'front' | 'side'
    this.slice = { front: 0, side: 0 }; // z index for front, x index for side
    this.zoom = 0; this.pan = { x: 0, y: 0 };
    this.ghost = true;
    this.needsFit = true;
    new ResizeObserver(() => this.resize()).observe(canvas.parentElement);

    let drag = null;
    canvas.addEventListener('pointerdown', (e) => { drag = { x: e.clientX, y: e.clientY, px: this.pan.x, py: this.pan.y }; canvas.setPointerCapture(e.pointerId); });
    canvas.addEventListener('pointermove', (e) => {
      if (drag) { this.pan.x = drag.px + e.clientX - drag.x; this.pan.y = drag.py + e.clientY - drag.y; this.draw(); }
      this.hover(e);
    });
    canvas.addEventListener('pointerup', () => { drag = null; });
    canvas.addEventListener('pointerleave', () => { this.tooltip.hidden = true; });
    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      const r = canvas.getBoundingClientRect();
      const mx = e.clientX - r.left, my = e.clientY - r.top;
      const old = this.zoom;
      this.zoom = Math.min(80, Math.max(1, this.zoom * (e.deltaY < 0 ? 1.15 : 1 / 1.15)));
      const f = this.zoom / old;
      this.pan.x = mx - (mx - this.pan.x) * f;
      this.pan.y = my - (my - this.pan.y) * f;
      this.draw();
    }, { passive: false });
  }

  get theme() { return document.documentElement.dataset.resolvedTheme === 'light' ? LIGHT_THEME : DARK_THEME; }

  resize() {
    const p = this.canvas.parentElement;
    const dpr = window.devicePixelRatio || 1;
    this.w = p.clientWidth; this.h = p.clientHeight;
    if (!this.w || !this.h) return;
    this.canvas.width = this.w * dpr; this.canvas.height = this.h * dpr;
    this.canvas.style.width = this.w + 'px'; this.canvas.style.height = this.h + 'px';
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (this.needsFit) this.fit(); else this.draw();
  }

  setVoxels(v) {
    const changed = !this.v || this.v.W !== v.W || this.v.D !== v.D || this.v.H !== v.H;
    if (changed) {
      // keep slices inside the new bounds; start in the middle
      this.slice.front = this.v ? Math.min(this.slice.front, v.D - 1) : Math.floor(v.D / 2);
      this.slice.side = this.v ? Math.min(this.slice.side, v.W - 1) : Math.floor(v.W / 2);
      this.needsFit = true;
    }
    this.v = v;
    if (this.needsFit && this.w) this.fit(); else this.draw();
  }
  setLayer(y) { this.layer = y; this.draw(); }
  setMode(mode) { this.mode = mode; this.needsFit = true; this.fit(); }
  setSlice(k) {
    if (this.mode === 'top' || !this.v) return;
    const { N } = viewDims(this.v, this.mode);
    this.slice[this.mode] = Math.max(0, Math.min(N - 1, k));
    this.draw();
  }

  fit() {
    if (!this.v || !this.w) return;
    this.needsFit = false;
    const pad = 56;
    const { U, V } = viewDims(this.v, this.mode);
    this.zoom = Math.max(1, Math.min((this.w - pad * 2) / U, (this.h - pad * 2 - 70) / V, 60));
    this.pan.x = (this.w - U * this.zoom) / 2;
    this.pan.y = (this.h - V * this.zoom) / 2 + 30;
    this.draw();
  }

  draw() {
    const ctx = this.ctx, t = this.theme;
    if (!this.w) return;
    ctx.clearRect(0, 0, this.w, this.h);
    if (!this.v) return;
    const { U, V } = viewDims(this.v, this.mode);
    const cs = this.zoom, ox = this.pan.x, oy = this.pan.y;
    if (this.mode === 'top') {
      drawLayer(ctx, this.v, this.layer, { cs, ox, oy, ghost: this.ghost, theme: t });
      // dashed lines: where the front / side sections cut this layer
      ctx.save();
      ctx.setLineDash([6, 4]); ctx.strokeStyle = t.center; ctx.lineWidth = 1.5;
      ctx.beginPath();
      const zf = oy + (this.slice.front + 0.5) * cs, xs = ox + (this.slice.side + 0.5) * cs;
      ctx.moveTo(ox - 10, zf); ctx.lineTo(ox + U * cs + 10, zf);
      ctx.moveTo(xs, oy - 10); ctx.lineTo(xs, oy + V * cs + 10);
      ctx.stroke();
      ctx.restore();
    } else {
      drawSection(ctx, this.v, this.mode, this.slice[this.mode], { cs, ox, oy, ghost: this.ghost, theme: t, highlightY: this.layer });
    }
    // rulers
    ctx.fillStyle = t.grid10;
    ctx.font = '11px system-ui, sans-serif';
    const step = this.zoom >= 14 ? 5 : this.zoom >= 5 ? 10 : 50;
    ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
    for (let u = 0; u <= U; u += step) ctx.fillText(String(u), ox + u * cs, oy - 8);
    ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
    if (this.mode === 'top') for (let r = 0; r <= V; r += step) ctx.fillText(String(r), ox - 8, oy + r * cs);
    else for (let y = 0; y <= V; y += step) ctx.fillText(String(y), ox - 8, oy + (V - y) * cs);
    ctx.textAlign = 'left'; ctx.textBaseline = 'top';
    let label;
    if (this.mode === 'top') label = `Top view · layer y=${this.layer}   N ↑  x →  z ↓`;
    else {
      const st = sectionStats(this.v, this.mode, this.slice[this.mode]);
      const axis = this.mode === 'front' ? 'x' : 'z';
      label = (this.mode === 'front'
        ? `Front section at z = ${this.slice.front}  (x →  y ↑)`
        : `Side section at x = ${this.slice.side}  (z →  y ↑)`) +
        `   ·   width ${st.width}` + (st.clear !== null ? `   ·   clear height at ${axis}=${st.mid}: ${st.clear}` : '');
    }
    ctx.fillText(label, 10, 10);
  }

  hover(e) {
    if (!this.v) return;
    const r = this.canvas.getBoundingClientRect();
    const u = Math.floor((e.clientX - r.left - this.pan.x) / this.zoom);
    const row = Math.floor((e.clientY - r.top - this.pan.y) / this.zoom);
    const { U, V } = viewDims(this.v, this.mode);
    if (u < 0 || row < 0 || u >= U || row >= V) { this.tooltip.hidden = true; return; }
    let i, where;
    if (this.mode === 'top') {
      i = u + row * this.v.W + this.layer * this.v.W * this.v.D;
      where = `x ${u}, z ${row}`;
    } else {
      i = sectionIndex(this.v, this.mode, u, row, this.slice[this.mode]);
      const y = V - 1 - row;
      where = this.mode === 'front' ? `x ${u}, y ${y}` : `z ${u}, y ${y}`;
    }
    const k = this.v.kind[i];
    const name = k ? blockLabel(this.v.mat[i], k, this.v.meta[i]) : 'air';
    this.tooltip.textContent = `${where} — ${name}`;
    this.tooltip.hidden = false;
    this.tooltip.style.left = (e.clientX - r.left + 14) + 'px';
    this.tooltip.style.top = (e.clientY - r.top + 14) + 'px';
  }
}
