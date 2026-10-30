/* NumField: slider + text field with validation, auto-expanding range and optional
   range/scale settings (min, max, linear/log). */
(function () {
  'use strict';
  const CV = (window.CV = window.CV || {});

  /** Parse user text: numbers or constant expressions (pi/2, 2*pi, 1e-3, inf). NaN when invalid. */
  CV.parseNum = function (str) {
    if (typeof str !== 'string') return NaN;
    const t = str.trim().replace(/,/g, '.');
    if (!t) return NaN;
    const inf = CV.infBound ? CV.infBound(t) : null;
    if (inf !== null) return inf;
    if (!/^[0-9a-zA-Z_+\-*/^().\s]+$/.test(t)) return NaN;
    try {
      const node = math.parse(t);
      let ok = true;
      node.traverse((n, path, parent) => {
        if (n.type === 'SymbolNode' && !(parent && parent.type === 'FunctionNode' && path === 'fn') &&
          !['pi', 'e', 'tau'].includes(n.name)) ok = false;
        if (n.type === 'AssignmentNode' || n.type === 'FunctionAssignmentNode') ok = false;
      });
      if (!ok) return NaN;
      const v = node.evaluate();
      return typeof v === 'number' ? v : NaN;
    } catch (e) { return NaN; }
  };

  CV.fmtVal = function (v, digits) {
    if (!Number.isFinite(v)) return v > 0 ? 'inf' : v < 0 ? '-inf' : '';
    if (v === 0) return '0';
    const a = Math.abs(v);
    if (a >= 1e6 || a < 1e-4) return v.toExponential(3).replace(/\.?0+e/, 'e');
    return String(+v.toPrecision(digits || 6));
  };

  const RES = 1000; // slider resolution

  class NumField {
    /**
     * opts: value, min, max, log, color, settings (bool), digits,
     *       validate(v) -> number | null  (null = reject; may wrap/adjust),
     *       hardMin/hardMax (exclusive limits for auto-expansion), onChange(v, final)
     */
    constructor(opts) {
      this.o = Object.assign({ min: 0, max: 1, log: false, settings: false, digits: 6, autoExpand: true }, opts);
      this.min = this.o.min; this.max = this.o.max; this.log = !!this.o.log && this.min > 0;
      this.value = opts.value;
      const el = (this.el = document.createElement('div'));
      el.className = 'numfield' + (this.o.settings ? ' with-set' : '') + (this.o.slider === false ? ' noslider' : '');
      this.range = document.createElement('input');
      this.range.type = 'range'; this.range.min = 0; this.range.max = RES; this.range.step = 1;
      if (this.o.color) this.range.style.setProperty('--c', this.o.color);
      this.text = document.createElement('input');
      this.text.type = 'text';
      this.text.spellcheck = false;
      this.text.setAttribute('inputmode', 'decimal');
      el.append(this.range, this.text);
      if (this.o.settings) {
        this.gear = document.createElement('button');
        this.gear.type = 'button';
        this.gear.className = 'mini-btn';
        this.gear.title = 'Slider range and scale';
        this.gear.innerHTML = '<svg viewBox="0 0 24 24"><path d="M4 8h10M18 8h2M4 16h2M10 16h10"/><circle cx="16" cy="8" r="2"/><circle cx="8" cy="16" r="2"/></svg>';
        el.appendChild(this.gear);
        this.panel = document.createElement('div');
        this.panel.className = 'nf-settings hidden';
        this.panel.innerHTML = '<label>min <input type="text" data-k="min"></label><label>max <input type="text" data-k="max"></label>' +
          '<div class="seg tiny"><button type="button" data-s="lin">lin</button><button type="button" data-s="log">log</button></div>';
        el.appendChild(this.panel);
        this.gear.addEventListener('click', () => { this.panel.classList.toggle('hidden'); this._syncPanel(); });
        this.panel.querySelectorAll('input').forEach(inp => {
          const commit = () => {
            const v = CV.parseNum(inp.value);
            const k = inp.dataset.k;
            const other = k === 'min' ? this.max : this.min;
            const okv = Number.isFinite(v) && (k === 'min' ? v < other : v > other) && this._withinHard(v) &&
              !(this.log && v <= 0);
            if (okv) { this[k] = v; this._syncSlider(); }
            this._syncPanel();
          };
          inp.addEventListener('change', commit);
          inp.addEventListener('keydown', e => { if (e.key === 'Enter') { commit(); inp.blur(); } if (e.key === 'Escape') { this._syncPanel(); inp.blur(); } });
        });
        this.panel.querySelector('.seg').addEventListener('click', e => {
          const b = e.target.closest('button');
          if (!b) return;
          if (b.dataset.s === 'log') {
            if (this.min <= 0) {
              // a log scale needs a positive range
              const hi = Math.max(this.max, Math.abs(this.value) || 1);
              this.min = Math.max(hi / 1000, this.o.hardMin !== undefined ? this.o.hardMin + 1e-9 : 0) || hi / 1000;
              if (!(this.min > 0)) return;
            }
            this.log = true;
          } else this.log = false;
          this._syncPanel(); this._syncSlider();
        });
      }
      this.range.addEventListener('input', () => {
        const v = this._fromT(+this.range.value);
        const vv = this._validate(v);
        if (vv === null) return;
        this.value = vv;
        this.text.value = CV.fmtVal(vv, 4);
        this.o.onChange && this.o.onChange(vv, false);
      });
      this.range.addEventListener('change', () => this.o.onChange && this.o.onChange(this.value, true));
      const tryText = final => {
        const raw = CV.parseNum(this.text.value);
        const v = Number.isNaN(raw) ? null : this._validate(raw);
        if (v === null) {
          if (final) this.text.value = CV.fmtVal(this.value, this.o.digits); // revert invalid input
          this.text.classList.toggle('bad', !final && this.text.value.trim() !== '');
          return;
        }
        this.text.classList.remove('bad');
        this.value = v;
        this._ensureInRange(v);
        this._syncSlider();
        if (final) this.text.value = CV.fmtVal(v, this.o.digits);
        this.o.onChange && this.o.onChange(v, final);
      };
      this.text.addEventListener('input', () => {
        // live update only for complete numbers, never for partial input like "1e" or "-"
        const raw = CV.parseNum(this.text.value);
        if (Number.isFinite(raw) && this._validate(raw) !== null) tryText(false);
        else this.text.classList.toggle('bad', this.text.value.trim() !== '' && !/^[-+.]?$|e[-+]?$/i.test(this.text.value.trim()));
      });
      this.text.addEventListener('change', () => tryText(true));
      this.text.addEventListener('blur', () => { this.text.classList.remove('bad'); this.text.value = CV.fmtVal(this.value, this.o.digits); });
      this.text.addEventListener('keydown', e => {
        if (e.key === 'Enter') { tryText(true); this.text.blur(); }
        if (e.key === 'Escape') { this.text.value = CV.fmtVal(this.value, this.o.digits); this.text.blur(); }
      });
      this._syncSlider();
      this.text.value = CV.fmtVal(this.value, this.o.digits);
    }

    _withinHard(v) {
      if (this.o.hardMin !== undefined && !(v > this.o.hardMin)) return false;
      if (this.o.hardMax !== undefined && !(v < this.o.hardMax)) return false;
      return true;
    }
    _validate(v) {
      if (!Number.isFinite(v)) return null;
      if (!this._withinHard(v)) return null;
      if (this.o.validate) { const r = this.o.validate(v); return r === null || r === undefined || !Number.isFinite(r) ? null : r; }
      return v;
    }
    _toT(v) {
      if (this.log) return RES * Math.log(v / this.min) / Math.log(this.max / this.min);
      return RES * (v - this.min) / (this.max - this.min);
    }
    _fromT(t) {
      const f = t / RES;
      if (this.log) return this.min * Math.pow(this.max / this.min, f);
      return this.min + (this.max - this.min) * f;
    }
    _ensureInRange(v) {
      if (!this.o.autoExpand) return;
      if (this.log && v <= 0) this.log = false;
      if (v > this.max) this.max = this.log ? v * 1.5 : v + 0.25 * Math.max(v - this.min, 1e-9);
      if (v < this.min) this.min = this.log ? v / 1.5 : v - 0.25 * Math.max(this.max - v, 1e-9);
      if (this.o.hardMin !== undefined && this.min <= this.o.hardMin) this.min = this.log ? Math.max(this.o.hardMin, v / 1.5) : Math.min(v, this.o.hardMin + 1e-9 * Math.max(1, Math.abs(v)));
      if (this.o.hardMax !== undefined && this.max >= this.o.hardMax) this.max = Math.max(v, this.o.hardMax - 1e-9 * Math.max(1, Math.abs(v)));
      this._syncPanel();
    }
    _syncSlider() {
      const t = this._toT(this.value);
      this.range.value = Number.isFinite(t) ? Math.max(0, Math.min(RES, t)) : 0;
    }
    _syncPanel() {
      if (!this.panel) return;
      this.panel.querySelector('[data-k=min]').value = CV.fmtVal(this.min, 5);
      this.panel.querySelector('[data-k=max]').value = CV.fmtVal(this.max, 5);
      this.panel.querySelectorAll('[data-s]').forEach(b => b.classList.toggle('on', (b.dataset.s === 'log') === this.log));
    }

    /** Programmatic update (does not fire onChange). */
    set(v) {
      if (!Number.isFinite(v)) return;
      this.value = v;
      this._ensureInRange(v);
      this._syncSlider();
      if (document.activeElement !== this.text) this.text.value = CV.fmtVal(v, this.o.digits);
    }
    /** Replace the slider interval (keeps the value inside by expanding if needed). */
    setRange(min, max) {
      if (!(min < max) || !Number.isFinite(min) || !Number.isFinite(max)) return;
      this.min = min; this.max = max;
      if (this.log && min <= 0) this.log = false;
      this._ensureInRange(this.value);
      this._syncSlider();
      this._syncPanel();
    }
    setDisabled(d) { this.range.disabled = d; this.text.disabled = d; this.el.classList.toggle('disabled', d); }
  }

  CV.NumField = NumField;
})();
