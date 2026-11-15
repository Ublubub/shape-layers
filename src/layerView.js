import { BLOCKS, FULL, BOTTOM, TOP } from './blocks.js';

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
      if (k === FULL) {
        ctx.fillStyle = col;
        ctx.fillRect(px, py, cs, cs);
      } else {
        // slab: tinted cell + a half bar marking bottom (lower half) or top (upper half)
        ctx.fillStyle = col;
        ctx.globalAlpha = 0.35;
        ctx.fillRect(px, py, cs, cs);
        ctx.globalAlpha = 1;
        const h = cs / 2;
        ctx.fillRect(px, k === BOTTOM ? py + h : py, cs, h);
        if (cs >= 10) {
          ctx.fillStyle = theme.slabMark;
          ctx.font = `bold ${Math.floor(cs * 0.45)}px system-ui, sans-serif`;
          ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
          ctx.fillText(k === BOTTOM ? 'b' : 't', px + cs / 2, py + (k === BOTTOM ? h * 1.5 : h * 0.5));
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
  grid10: 'rgba(0,0,0,0.6)', center: '#e0457b', slabMark: 'rgba(255,255,255,0.9)',
};
export const DARK_THEME = {
  bg: '#1b1d22', ghost: 'rgba(255,255,255,0.10)', grid: 'rgba(255,255,255,0.08)', grid5: 'rgba(255,255,255,0.22)',
  grid10: 'rgba(255,255,255,0.45)', center: '#ff6b9a', slabMark: 'rgba(255,255,255,0.9)',
};

export class LayerView {
  constructor(canvas, tooltip) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.tooltip = tooltip;
    this.v = null; this.layer = 0;
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
    const changed = !this.v || this.v.W !== v.W || this.v.D !== v.D;
    this.v = v;
    if (changed) this.needsFit = true;
    if (this.needsFit && this.w) this.fit(); else this.draw();
  }
  setLayer(y) { this.layer = y; this.draw(); }

  fit() {
    if (!this.v || !this.w) return;
    this.needsFit = false;
    const pad = 48;
    this.zoom = Math.max(1, Math.min((this.w - pad * 2) / this.v.W, (this.h - pad * 2) / this.v.D, 60));
    this.pan.x = (this.w - this.v.W * this.zoom) / 2;
    this.pan.y = (this.h - this.v.D * this.zoom) / 2;
    this.draw();
  }

  draw() {
    const ctx = this.ctx, t = this.theme;
    if (!this.w) return;
    ctx.clearRect(0, 0, this.w, this.h);
    if (!this.v) return;
    drawLayer(ctx, this.v, this.layer, { cs: this.zoom, ox: this.pan.x, oy: this.pan.y, ghost: this.ghost, theme: t });
    // rulers
    ctx.fillStyle = t.grid10;
    ctx.font = '11px system-ui, sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
    const step = this.zoom >= 14 ? 5 : this.zoom >= 5 ? 10 : 50;
    for (let x = 0; x <= this.v.W; x += step) ctx.fillText(String(x), this.pan.x + x * this.zoom, this.pan.y - 4);
    ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
    for (let z = 0; z <= this.v.D; z += step) ctx.fillText(String(z), this.pan.x - 6, this.pan.y + z * this.zoom);
    ctx.textAlign = 'left'; ctx.textBaseline = 'top';
    ctx.fillText('N ↑   x →   z ↓', 10, 10);
  }

  hover(e) {
    if (!this.v) return;
    const r = this.canvas.getBoundingClientRect();
    const x = Math.floor((e.clientX - r.left - this.pan.x) / this.zoom);
    const z = Math.floor((e.clientY - r.top - this.pan.y) / this.zoom);
    if (x < 0 || z < 0 || x >= this.v.W || z >= this.v.D) { this.tooltip.hidden = true; return; }
    const i = x + z * this.v.W + this.layer * this.v.W * this.v.D;
    const k = this.v.kind[i];
    const name = k ? BLOCKS[this.v.mat[i]].name + (k === FULL ? '' : k === BOTTOM ? ' slab (bottom)' : ' slab (top)') : 'air';
    this.tooltip.textContent = `x ${x}, z ${z} — ${name}`;
    this.tooltip.hidden = false;
    this.tooltip.style.left = (e.clientX - r.left + 14) + 'px';
    this.tooltip.style.top = (e.clientY - r.top + 14) + 'px';
  }
}

export { TOP };
