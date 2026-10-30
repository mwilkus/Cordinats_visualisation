/* Custom coordinate system editor + persistence. */
(function () {
  'use strict';
  const CV = (window.CV = window.CV || {});
  const KEY = 'coordlab.custom.v1';

  CV.store = {
    load() {
      try {
        const s = localStorage.getItem(KEY);
        const arr = s ? JSON.parse(s) : [];
        return Array.isArray(arr) ? arr : [];
      } catch (e) { return []; }
    },
    save(list) {
      try { localStorage.setItem(KEY, JSON.stringify(list)); return true; } catch (e) { return false; }
    },
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* ignore */ } }
  };

  /** Pretty-print a numeric bound, recognising simple multiples of pi. */
  CV.fmtBound = function (v) {
    if (typeof v === 'string') return v;
    if (!Number.isFinite(v)) return Number.isNaN(v) ? '' : (v > 0 ? 'inf' : '-inf');
    for (const d of [1, 2, 3, 4, 6, 12]) {
      const m = v * d / Math.PI;
      if (Math.abs(m - Math.round(m)) < 1e-9 && Math.round(m) !== 0) {
        const k = Math.round(m);
        const num = k === 1 ? 'pi' : k === -1 ? '-pi' : k + '*pi';
        return d === 1 ? num : num + '/' + d;
      }
    }
    return String(+v.toFixed(6));
  };

  const TEMPLATE = {
    name: 'Stretched spherical', dim: 3,
    params: [{ n: 'a', value: 1.6, min: 0.2, max: 3 }, { n: 'b', value: 1, min: 0.2, max: 3 }, { n: 'c', value: 0.7, min: 0.2, max: 3 }],
    coords: [
      { n: 'r', min: 0, max: 'inf', def: 1.3, surf: 'Similar ellipsoids' },
      { n: 'theta', min: 0, max: Math.PI, def: 1.0, surf: 'Elliptic cones' },
      { n: 'phi', min: 0, max: 2 * Math.PI, periodic: true, def: 0.7, surf: 'Half-planes' }],
    map: ['a*r*sin(theta)*cos(phi)', 'b*r*sin(theta)*sin(phi)', 'c*r*cos(theta)'],
    view: 3.5
  };
  const TEMPLATE_2D_COORDS = [
    { n: 'u', min: '-inf', max: 'inf', def: 0.8, surf: '' },
    { n: 'v', min: '-inf', max: 'inf', def: 0.6, surf: '' }];

  const $ = id => document.getElementById(id);
  const tex = (s, el, display) => katex.render(s, el, { throwOnError: false, displayMode: !!display });

  class Editor {
    constructor() {
      this.dlg = $('editor');
      this.dim = 3;
      $('ed-dim').addEventListener('click', ev => {
        const b = ev.target.closest('button[data-dim]');
        if (!b) return;
        this._setDim(+b.dataset.dim);
      });
      $('ed-add-param').addEventListener('click', () => { this._addParam({ n: '', value: 1, min: 0, max: 2 }); this._validate(); });
      $('ed-cancel').addEventListener('click', () => this.dlg.close());
      $('ed-save').addEventListener('click', () => this._save());
      this.dlg.addEventListener('input', () => this._schedule());
      this.dlg.addEventListener('change', () => this._schedule());
      this.dlg.querySelectorAll('.k[data-tex]').forEach(e => tex(e.dataset.tex, e));
    }

    open(def, onSave) {
      this.onSave = onSave;
      this.editId = def && def.id && def.group === 'custom' ? def.id : null;
      const d = def ? JSON.parse(JSON.stringify(def)) : JSON.parse(JSON.stringify(TEMPLATE));
      if (def && !this.editId) d.name = (def.name || 'System') + ' (custom)';
      $('ed-title').textContent = this.editId ? 'Edit custom system' : 'New custom coordinate system';
      $('ed-name').value = d.name || '';
      $('ed-view').value = d.view || 3.5;
      $('ed-params').innerHTML = '';
      (d.params || []).forEach(p => this._addParam(p));
      this.coordCache = d.coords;
      this.dim = d.dim;
      this._renderCoords(d.coords);
      $('ed-x').value = d.map[0] || '';
      $('ed-y').value = d.map[1] || '';
      $('ed-z').value = d.map[2] || '';
      this._setDim(d.dim, true);
      this.dlg.showModal();
      this._validate();
    }

    _setDim(n, keep) {
      if (!keep) {
        const cur = this._readCoords();
        if (n === 2 && cur.length === 3) this._renderCoords(cur.slice(0, 2));
        if (n === 3 && cur.length === 2) this._renderCoords(cur.concat([{ n: 'w', min: '-inf', max: 'inf', def: 0.5, surf: '' }]));
        if (n === 3 && !$('ed-z').value.trim()) $('ed-z').value = 'w';
      } else if (this._readCoords().length !== n) {
        this._renderCoords(n === 2 ? TEMPLATE_2D_COORDS : TEMPLATE.coords);
      }
      this.dim = n;
      $('ed-dim').querySelectorAll('button').forEach(b => b.classList.toggle('on', +b.dataset.dim === n));
      $('ed-zrow').classList.toggle('hidden', n === 2);
      this._schedule();
    }

    _addParam(p) {
      const row = document.createElement('div');
      row.className = 'param-ed';
      row.innerHTML = '<input type="text" placeholder="name" data-k="n"><input type="number" step="any" placeholder="value" data-k="value">' +
        '<input type="number" step="any" placeholder="min" data-k="min"><input type="number" step="any" placeholder="max" data-k="max">' +
        '<button type="button" class="icon-btn" title="Remove"><svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg></button>';
      row.querySelector('[data-k=n]').value = p.n;
      row.querySelector('[data-k=value]').value = p.value;
      row.querySelector('[data-k=min]').value = p.min !== undefined ? p.min : '';
      row.querySelector('[data-k=max]').value = p.max !== undefined ? p.max : '';
      row.querySelector('button').addEventListener('click', () => { row.remove(); this._validate(); });
      $('ed-params').appendChild(row);
    }

    _renderCoords(coords) {
      const box = $('ed-coords');
      box.innerHTML = '';
      coords.forEach(c => {
        const row = document.createElement('div');
        row.className = 'coord-ed';
        row.innerHTML = '<input type="text" data-k="n" spellcheck="false"><input type="text" data-k="min" spellcheck="false"><input type="text" data-k="max" spellcheck="false">' +
          '<input type="text" data-k="def" spellcheck="false"><input type="checkbox" data-k="periodic" title="periodic"><input type="text" data-k="surf" placeholder="e.g. Spheres">';
        row.querySelector('[data-k=n]').value = c.n;
        row.querySelector('[data-k=min]').value = CV.fmtBound(c.min);
        row.querySelector('[data-k=max]').value = CV.fmtBound(c.max);
        row.querySelector('[data-k=def]').value = CV.fmtBound(c.def);
        row.querySelector('[data-k=periodic]').checked = !!c.periodic;
        row.querySelector('[data-k=surf]').value = c.surf || '';
        box.appendChild(row);
      });
    }

    _readCoords() {
      return [...$('ed-coords').querySelectorAll('.coord-ed')].map(r => {
        const g = k => r.querySelector('[data-k=' + k + ']');
        return { n: g('n').value.trim(), min: g('min').value.trim(), max: g('max').value.trim(), def: g('def').value.trim(), periodic: g('periodic').checked, surf: g('surf').value.trim() };
      });
    }

    _readParams() {
      return [...$('ed-params').querySelectorAll('.param-ed')].map(r => {
        const g = k => r.querySelector('[data-k=' + k + ']').value.trim();
        const num = (s, d) => (s === '' || !Number.isFinite(+s) ? d : +s);
        const value = num(g('value'), 1);
        return { n: g('n'), value, min: num(g('min'), Math.min(0, value)), max: num(g('max'), Math.max(2 * Math.abs(value), value + 1)) };
      });
    }

    _buildDef() {
      const params = this._readParams();
      const scope = {};
      params.forEach(p => { scope[p.n] = p.value; });
      const bound = s => (s === '' ? s : CV.infBound(s) !== null ? (CV.infBound(s) > 0 ? 'inf' : '-inf') : Number.isFinite(+s) ? +s : s);
      const coords = this._readCoords().map(c => {
        let def = CV.parseNum(c.def);
        if (!Number.isFinite(def)) { try { def = math.evaluate(c.def, Object.assign({}, scope)); } catch (e) { def = NaN; } }
        return { n: c.n, min: bound(c.min), max: bound(c.max), def, periodic: c.periodic || undefined, surf: c.surf || undefined };
      });
      const map = [$('ed-x').value.trim(), $('ed-y').value.trim()];
      if (this.dim === 3) map.push($('ed-z').value.trim());
      return {
        id: this.editId || 'custom-' + Date.now().toString(36),
        group: 'custom', name: $('ed-name').value.trim() || 'Custom system', dim: this.dim,
        params, coords, map, view: Math.max(0.5, +$('ed-view').value || 3.5)
      };
    }

    _schedule() {
      clearTimeout(this._t);
      this._t = setTimeout(() => this._validate(), 220);
    }

    /** Returns {ok, def, msg} and updates preview + status. */
    _validate() {
      const def = this._buildDef();
      const status = $('ed-status');
      const prev = $('ed-preview');
      const axes = ['x', 'y', 'z'];
      // preview
      try {
        const lines = def.map.map((m, a) => axes[a] + ' &= ' + (m ? CV.tex(math.parse(m)) : '\\;?'));
        tex('\\begin{aligned}' + lines.join('\\\\') + '\\end{aligned}', prev, true);
      } catch (e) {
        prev.textContent = '–';
      }
      const msgs = [];
      let ok = false;
      try {
        if (!def.map.every(Boolean)) throw new Error('Enter an expression for every Cartesian component.');
        const sys = new CV.CoordSystem(def);
        def.coords.forEach((c, i) => {
          const [lo, hi] = sys.range(i);
          if (Number.isNaN(lo) || Number.isNaN(hi) || !(lo < hi)) throw new Error('Range of ' + c.n + ': min must be smaller than max.');
          if (c.periodic && !(Number.isFinite(lo) && Number.isFinite(hi))) throw new Error(c.n + ': a periodic coordinate needs a finite range.');
          if (!Number.isFinite(c.def) || c.def < lo || c.def > hi) throw new Error('Default of ' + c.n + ' must be a number inside its range.');
        });
        def.params.forEach(p => { if (!(p.min <= p.value && p.value <= p.max)) msgs.push('<span class="warn">Parameter ' + p.n + ': value outside [min, max].</span>'); });
        const u = sys.defaultPoint();
        const f = sys.frame(u);
        if (!f.finite) throw new Error('Position or derivatives are not finite at the default point.');
        if (Math.abs(f.detJ) < 1e-9) msgs.push('<span class="warn">det J ≈ 0 at the default point – the coordinates are singular there.</span>');
        const orth = sys.isOrthogonalAt(u);
        msgs.unshift('<span class="ok">✓ Valid ' + def.dim + 'D system.</span> det J = ' + f.detJ.toPrecision(4) +
          ' at the default point; ' + (orth ? 'orthogonal there.' : 'non-orthogonal there (g<sub>ij</sub> has off-diagonal terms).'));
        ok = true;
      } catch (e) {
        msgs.unshift('<span class="err">✗ ' + (e.message || e) + '</span>');
      }
      status.innerHTML = msgs.join('<br>');
      $('ed-save').disabled = !ok;
      return { ok, def };
    }

    _save() {
      const { ok, def } = this._validate();
      if (!ok) return;
      this.dlg.close();
      if (this.onSave) this.onSave(def);
    }
  }

  CV.Editor = Editor;
})();
