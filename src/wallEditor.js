import { parseState, formatState, stateColor, stateLabel } from './blockstates.js';
import { drawSection, DARK_THEME, LIGHT_THEME } from './layerView.js';
import { stampToVoxels } from './stampData.js';
import { wallToStamp, PRESET_PROFILES } from './wallData.js';
import { pickFromPalette, hash01 } from './palettes.js';
import { PICKER, propSchema, Preview3D } from './stampEditor.js';

const $ = (id) => document.getElementById(id);
const theme = () => (document.documentElement.dataset.resolvedTheme === 'light' ? LIGHT_THEME : DARK_THEME);

// Draw a palette's gradient: columns of random picks, bottom row = t 0, top row = t 1.
export function drawPaletteStrip(canvas, pal, cols = 24, rows = 6) {
  const ctx = canvas.getContext('2d');
  const w = canvas.width, h = canvas.height;
  const cw = w / cols, ch = h / rows;
  ctx.clearRect(0, 0, w, h);
  if (!pal || !pal.entries.length) return;
  for (let r = 0; r < rows; r++) {
    const t = rows > 1 ? 1 - r / (rows - 1) : 0.5;
    for (let c = 0; c < cols; c++) {
      ctx.fillStyle = stateColor(pickFromPalette(pal, t, hash01(c, r, 1, 77)));
      ctx.fillRect(Math.floor(c * cw), Math.floor(r * ch), Math.ceil(cw), Math.ceil(ch));
    }
  }
}

/**
 * Wall editor. Edits { name, length, height, seed, profile } and the shared palettes.
 * onSave(wall) is called with the edited wall; onPalettes() whenever a palette changes.
 */
export class WallEditor {
  constructor({ onSave, onSaveStyle, onPalettes, getPalettes, getProfiles }) {
    this.onSave = onSave; this.onSaveStyle = onSaveStyle; this.onPalettes = onPalettes; this.getPalettes = getPalettes;
    this.getProfiles = getProfiles || (() => PRESET_PROFILES);
    this.dlg = $('wall-dialog');
    this.canvas = $('we-canvas');
    this.preview = new Preview3D($('we-3d'));
    this.spec = 'pal:worn-stone';
    this.base = 'minecraft:stone_bricks';
    this.props = {};
    this.editPal = null;
    this.history = [];

    // header inputs
    $('we-apply').onclick = () => this.applySize();
    for (const id of ['we-length', 'we-height']) $(id).addEventListener('change', () => { this.readHeader(); this.refresh(); });
    $('we-stretch').onchange = () => { this.pushHistory(); this.wall.profile.stretchRow = +$('we-stretch').value; this.refresh(); };
    $('we-seed').onclick = () => { this.wall.seed = Math.floor(Math.random() * 1e6); this.refresh(); };
    $('we-preset').onchange = () => {
      const p = this.getProfiles().find((x) => x.id === $('we-preset').value);
      if (!p) return;
      this.pushHistory();
      this.wall.profile = JSON.parse(JSON.stringify(p));
      this.wall.height = Math.max(this.wall.height, 1);
      $('we-preset').value = '';
      this.syncHeader(); this.refresh();
    };
    $('we-undo').onclick = () => this.undo();
    $('we-cancel').onclick = () => this.close();
    $('we-save').onclick = () => { this.readHeader(); this.onSave(this.wall); this.close(); };
    $('we-style').onclick = () => {
      const name = prompt('Name for this wall style:', this.wall.profile.name || 'My wall');
      if (!name) return;
      this.onSaveStyle({ ...JSON.parse(JSON.stringify(this.wall.profile)), id: 'u' + Date.now().toString(36), name });
    };
    $('we-state').addEventListener('change', (e) => this.setSpec(e.target.value.trim()));
    $('we-search').addEventListener('input', () => this.renderPicker());
    this.dlg.addEventListener('close', () => this.preview.stop());
    this.initGrid();
    this.initPaletteEditor();
  }

  open(wall) {
    this.wall = JSON.parse(JSON.stringify(wall));
    this.history = [];
    const sel = $('we-preset');
    const styles = this.getProfiles();
    sel.innerHTML = '<option value="">Load a wall style…</option>' + styles.map((p) => `<option value="${p.id}"></option>`).join('');
    styles.forEach((p, i) => { sel.options[i + 1].textContent = p.name; });
    this.syncHeader();
    this.dlg.showModal();
    this.renderPicker();
    this.renderPaletteEditor();
    this.refresh(true);
    this.preview.start();
  }
  close() { this.dlg.close(); }

  // ---- header
  syncHeader() {
    const p = this.wall.profile;
    $('we-name').value = this.wall.name || p.name || 'Wall';
    $('we-length').value = this.wall.length;
    $('we-height').value = this.wall.height;
    $('we-depth').value = p.depth;
    $('we-rows').value = p.rows;
    const st = $('we-stretch');
    st.innerHTML = '<option value="-1">none</option>' + [...Array(p.rows)].map((_, r) => `<option value="${r}">row ${r}</option>`).join('');
    st.value = p.stretchRow ?? -1;
  }
  readHeader() {
    this.wall.name = $('we-name').value.trim() || 'Wall';
    this.wall.length = Math.max(1, Math.min(500, Math.round(+$('we-length').value || 1)));
    this.wall.height = Math.max(1, Math.min(200, Math.round(+$('we-height').value || 1)));
  }
  applySize() {
    this.pushHistory();
    const p = this.wall.profile;
    const depth = Math.max(1, Math.min(12, Math.round(+$('we-depth').value || 1)));
    const rows = Math.max(1, Math.min(40, Math.round(+$('we-rows').value || 1)));
    for (const k of Object.keys(p.cells)) { const [d, r] = k.split(',').map(Number); if (d >= depth || r >= rows) delete p.cells[k]; }
    p.depth = depth; p.rows = rows;
    if (p.stretchRow >= rows) p.stretchRow = rows - 1;
    this.syncHeader(); this.refresh(true);
  }
  pushHistory() { this.history.push(JSON.stringify(this.wall.profile)); if (this.history.length > 100) this.history.shift(); }
  undo() { const h = this.history.pop(); if (!h) return; this.wall.profile = JSON.parse(h); this.syncHeader(); this.refresh(); }

  // ---- picker: palettes first, then blocks
  renderPicker() {
    const list = $('we-blocks');
    const q = $('we-search').value.trim().toLowerCase().replace(/\s+/g, '_');
    list.innerHTML = '';
    for (const pal of this.getPalettes()) {
      if (q && !pal.name.toLowerCase().includes(q.replace(/_/g, ' ')) && !pal.id.includes(q)) continue;
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'se-block pal' + (this.spec === 'pal:' + pal.id ? ' sel' : '');
      b.innerHTML = '<canvas width="28" height="14"></canvas><span></span>';
      b.querySelector('span').textContent = pal.name;
      drawPaletteStrip(b.querySelector('canvas'), pal, 7, 3);
      b.onclick = () => { this.setSpec('pal:' + pal.id); };
      list.appendChild(b);
    }
    for (const id of PICKER) {
      if (q && !id.includes(q)) continue;
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'se-block' + (!this.spec.startsWith('pal:') && parseState(this.spec).id === id ? ' sel' : '');
      b.innerHTML = `<i style="background:${stateColor(id)}"></i><span></span>`;
      b.querySelector('span').textContent = id.slice(10).replace(/_/g, ' ');
      b.onclick = () => this.setSpec(id, true);
      list.appendChild(b);
    }
  }

  setSpec(spec, resetProps = false) {
    if (!spec) return;
    if (spec.startsWith('pal:')) {
      this.spec = spec;
      $('we-props').innerHTML = '';
      const pal = this.getPalettes().find((p) => 'pal:' + p.id === spec);
      $('we-state').value = spec;
      $('we-swatch').style.background = pal && pal.entries[0] ? stateColor(pal.entries[0].state) : '#888';
      this.editPal = pal || null;
      this.renderPaletteEditor();
    } else {
      const st = parseState(spec);
      this.base = st.id;
      this.props = {};
      const wrap = $('we-props');
      wrap.innerHTML = '';
      for (const [p, values] of propSchema(st.name)) {
        this.props[p] = resetProps ? values[0] : (st.props[p] ?? values[0]);
        const lab = document.createElement('label');
        lab.innerHTML = `<span>${p}${p === 'facing' ? ' <small>(north = back)</small>' : ''}</span>`;
        const sel = document.createElement('select');
        for (const v of values) { const o = document.createElement('option'); o.value = o.textContent = v; sel.appendChild(o); }
        sel.value = this.props[p];
        sel.onchange = () => { this.props[p] = sel.value; this.spec = formatState({ id: this.base, props: this.props }); $('we-state').value = this.spec; };
        lab.appendChild(sel);
        wrap.appendChild(lab);
      }
      this.spec = formatState({ id: st.id, props: this.props });
      $('we-state').value = this.spec;
      $('we-swatch').style.background = stateColor(st.id);
    }
    this.renderPicker();
  }

  // ---- profile grid (side view: back on the left, front on the right, bottom row at the bottom)
  initGrid() {
    let painting = null;
    const cellAt = (e) => {
      const r = this.canvas.getBoundingClientRect();
      const d = Math.floor((e.clientX - r.left - this.ox) / this.cs);
      const row = Math.floor((e.clientY - r.top - this.oy) / this.cs);
      const p = this.wall.profile;
      if (d < 0 || row < 0 || d >= p.depth || row >= p.rows) return null;
      return [d, p.rows - 1 - row];
    };
    const apply = ([d, r], erase) => {
      const k = `${d},${r}`;
      if (erase) delete this.wall.profile.cells[k]; else this.wall.profile.cells[k] = this.spec;
      this.refresh();
    };
    this.canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    this.canvas.addEventListener('pointerdown', (e) => {
      const c = cellAt(e); if (!c) return;
      if (e.altKey) { const sp = this.wall.profile.cells[`${c[0]},${c[1]}`]; if (sp) this.setSpec(sp); return; }
      this.pushHistory();
      painting = { erase: e.button === 2 || e.shiftKey };
      this.canvas.setPointerCapture(e.pointerId);
      apply(c, painting.erase);
    });
    this.canvas.addEventListener('pointermove', (e) => {
      const c = cellAt(e);
      if (c) {
        const sp = this.wall.profile.cells[`${c[0]},${c[1]}`];
        const pal = sp && sp.startsWith('pal:') ? this.getPalettes().find((p) => 'pal:' + p.id === sp) : null;
        $('we-hover').textContent = `depth ${c[0]} (${c[0] === 0 ? 'back' : c[0] === this.wall.profile.depth - 1 ? 'front' : 'middle'}), row ${c[1]} — ` +
          (!sp ? 'air' : pal ? `palette: ${pal.name}` : stateLabel(sp));
      }
      if (painting && c) apply(c, painting.erase);
    });
    this.canvas.addEventListener('pointerup', () => { painting = null; });
  }

  drawGrid() {
    const c = this.canvas, ctx = c.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    const w = c.clientWidth || 300, h = c.clientHeight || 400;
    c.width = w * dpr; c.height = h * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const p = this.wall.profile;
    this.cs = Math.max(8, Math.floor(Math.min((w - 60) / p.depth, (h - 40) / p.rows, 48)));
    this.ox = Math.floor((w - p.depth * this.cs) / 2) + 10;
    this.oy = Math.floor((h - p.rows * this.cs) / 2);
    // the profile itself (no stretching), as a 1-long wall seen from the side
    const v = stampToVoxels(wallToStamp({ ...this.wall, length: 1, height: p.rows, profile: { ...p, stretchRow: -1 } }, this.getPalettes()));
    const th = theme();
    drawSection(ctx, v, 'side', 0, { cs: this.cs, ox: this.ox, oy: this.oy, ghost: false, theme: th });
    // markers
    ctx.font = `bold ${Math.max(9, Math.floor(this.cs * 0.32))}px system-ui, sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (const [k, sp] of Object.entries(p.cells)) {
      const [d, r] = k.split(',').map(Number);
      if (!sp.startsWith('pal:') || this.cs < 14) continue;
      const x = this.ox + d * this.cs, y = this.oy + (p.rows - 1 - r) * this.cs;
      ctx.fillStyle = 'rgba(0,0,0,.45)'; ctx.fillRect(x + 2, y + 2, this.cs * 0.42, this.cs * 0.42);
      ctx.fillStyle = '#fff'; ctx.fillText('P', x + 2 + this.cs * 0.21, y + 2 + this.cs * 0.22);
    }
    if (p.stretchRow >= 0) {
      const y = this.oy + (p.rows - 1 - p.stretchRow) * this.cs;
      ctx.strokeStyle = th.center; ctx.lineWidth = 2; ctx.setLineDash([5, 3]);
      ctx.strokeRect(this.ox - 4, y, p.depth * this.cs + 8, this.cs);
      ctx.setLineDash([]);
      ctx.fillStyle = th.center; ctx.textAlign = 'left';
      ctx.fillText('↕ stretch', this.ox + p.depth * this.cs + 8, y + this.cs / 2);
    }
    ctx.fillStyle = th.grid10; ctx.textAlign = 'center'; ctx.font = '11px system-ui, sans-serif';
    ctx.fillText('back', this.ox + this.cs / 2, this.oy + p.rows * this.cs + 12);
    ctx.fillText('front (room side)', this.ox + (p.depth - 0.5) * this.cs, this.oy + p.rows * this.cs + 24);
  }

  refresh(refit = false) {
    this.drawGrid();
    const preview = { ...this.wall, length: Math.min(this.wall.length, 16) };
    this.preview.show(stampToVoxels(wallToStamp(preview, this.getPalettes())), refit);
    $('we-info').textContent = `Wall ${this.wall.length} long × ${this.wall.height} high × ${this.wall.profile.depth} deep` +
      (this.wall.length > 16 ? ' · preview shows the first 16 blocks' : '');
  }

  // ---- palette editor (edits the shared palettes in place)
  initPaletteEditor() {
    $('pe-new').onclick = () => {
      const pals = this.getPalettes();
      const pal = { id: 'p' + Date.now().toString(36), name: 'New palette', entries: [{ state: this.spec.startsWith('pal:') ? 'minecraft:stone_bricks' : parseState(this.spec).id, top: 50, bottom: 50 }] };
      pals.push(pal);
      this.setSpec('pal:' + pal.id);
      this.changed();
    };
    $('pe-dup').onclick = () => {
      if (!this.editPal) return;
      const pal = { ...JSON.parse(JSON.stringify(this.editPal)), id: 'p' + Date.now().toString(36), name: this.editPal.name + ' copy' };
      this.getPalettes().push(pal);
      this.setSpec('pal:' + pal.id);
      this.changed();
    };
    $('pe-name').addEventListener('change', (e) => { if (this.editPal) { this.editPal.name = e.target.value || 'Palette'; this.changed(); } });
    $('pe-add').onclick = () => {
      if (!this.editPal) return;
      const st = prompt('Block to add (e.g. mossy_stone_bricks):', 'minecraft:cracked_stone_bricks');
      if (!st) return;
      const id = parseState(st).id;
      this.editPal.entries.push({ state: st.includes('[') ? id + st.slice(st.indexOf('[')) : id, top: 20, bottom: 20 });
      this.changed();
    };
  }

  renderPaletteEditor() {
    const box = $('pe-box');
    box.hidden = !this.editPal;
    if (!this.editPal) return;
    const pal = this.editPal;
    $('pe-name').value = pal.name;
    drawPaletteStrip($('pe-strip'), pal);
    const list = $('pe-entries');
    list.innerHTML = '<div class="pe-row pe-headrow"><span></span><span>block</span><span title="weight at the top">top</span><span title="weight at the bottom">bottom</span><span></span></div>';
    pal.entries.forEach((e, i) => {
      const row = document.createElement('div');
      row.className = 'pe-row';
      row.innerHTML = `<i style="background:${stateColor(e.state)}"></i><input type="text" value="" /><input type="number" min="0" max="100" value="${e.top}" /><input type="number" min="0" max="100" value="${e.bottom}" /><button type="button" title="Remove">✕</button>`;
      const [name, top, bottom] = row.querySelectorAll('input');
      name.value = e.state.replace('minecraft:', '');
      name.onchange = () => { e.state = parseState(name.value).id + (name.value.includes('[') ? name.value.slice(name.value.indexOf('[')) : ''); this.changed(); };
      top.onchange = () => { e.top = Math.max(0, +top.value || 0); this.changed(); };
      bottom.onchange = () => { e.bottom = Math.max(0, +bottom.value || 0); this.changed(); };
      row.querySelector('button').onclick = () => { pal.entries.splice(i, 1); this.changed(); };
      list.appendChild(row);
    });
  }

  changed() {
    this.renderPaletteEditor();
    this.renderPicker();
    this.refresh();
    this.onPalettes();
  }
}
