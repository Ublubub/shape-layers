import { generatePillar, DEFAULT_PILLAR } from './wallData.js';
import { stampToVoxels } from './stampData.js';
import { Preview3D } from './stampEditor.js';

const $ = (id) => document.getElementById(id);
const WOODS = ['spruce', 'dark_oak', 'oak', 'birch', 'jungle', 'acacia', 'mangrove', 'cherry', 'bamboo', 'crimson', 'warped'];

/**
 * Pillar builder: a pillar described by settings (column, base, trapdoor wraps, bands, capital).
 * onCreate(stamp, openEditor) receives the generated stamp; the settings are kept in stamp.gen
 * so the pillar can be re-opened here and regenerated later.
 */
export class PillarBuilder {
  constructor(onCreate) {
    this.onCreate = onCreate;
    this.dlg = $('pillar-dialog');
    this.form = $('pillar-form');
    this.preview = new Preview3D($('pb-3d'));
    for (const name of ['wood', 'bandWood']) {
      const sel = this.form.elements[name];
      for (const w of WOODS) { const o = document.createElement('option'); o.value = w; o.textContent = w.replace('_', ' '); sel.appendChild(o); }
    }
    this.form.addEventListener('input', () => this.update());
    this.form.addEventListener('change', () => this.update());
    $('pb-cancel').onclick = () => this.dlg.close();
    $('pb-create').onclick = () => this.create(false);
    $('pb-edit').onclick = () => this.create(true);
    this.dlg.addEventListener('close', () => this.preview.stop());
  }

  open(existing = null) {
    this.existing = existing; // stamp being regenerated, or null
    const o = { ...DEFAULT_PILLAR, ...(existing && existing.gen ? existing.gen : {}) };
    const f = this.form.elements;
    f.name.value = existing ? existing.name : o.name;
    f.height.value = o.height;
    f.wood.value = o.wood;
    f.bandWood.value = o.bandWood;
    f.column.value = (o.column || '').replace('minecraft:', '');
    f.base.value = o.base;
    f.lowerWrap.value = o.lowerWrap;
    f.upperWrap.value = o.upperWrap;
    f.bands.value = (o.bands || []).join(', ');
    f.capital.value = o.capital;
    $('pb-create').textContent = existing ? 'Update stamp' : 'Create stamp';
    this.dlg.showModal();
    this.update(true);
    this.preview.start();
  }

  options() {
    const f = this.form.elements;
    const col = f.column.value.trim();
    return {
      name: f.name.value.trim() || 'Pillar',
      height: Math.max(3, Math.min(64, Math.round(+f.height.value || 9))),
      wood: f.wood.value, bandWood: f.bandWood.value,
      column: col ? (col.includes(':') ? col : 'minecraft:' + col) : `minecraft:stripped_${f.wood.value}_log[axis=y]`,
      base: f.base.value,
      lowerWrap: Math.max(0, Math.round(+f.lowerWrap.value || 0)),
      upperWrap: Math.max(0, Math.round(+f.upperWrap.value || 0)),
      bands: f.bands.value.split(/[,\s]+/).map(Number).filter((n) => Number.isFinite(n) && n >= 0),
      capital: f.capital.value,
    };
  }

  update(refit = false) {
    const o = this.options();
    const s = generatePillar(o);
    this.preview.show(stampToVoxels(s), refit);
    $('pb-info').textContent = `${s.size[0]} × ${s.size[1]} × ${s.size[2]} footprint · ${Object.keys(s.blocks).length} blocks · column is the center block`;
  }

  create(openEditor) {
    const o = this.options();
    const s = generatePillar(o);
    s.name = o.name;
    s.gen = o;
    if (this.existing) { s.id = this.existing.id; s.rev = (this.existing.rev || 0) + 1; }
    this.dlg.close();
    this.onCreate(s, openEditor);
  }
}
