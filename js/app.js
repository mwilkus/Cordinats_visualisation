/* Application controller: state, UI wiring and the tensor panel. */
(function () {
  'use strict';
  const CV = window.CV;
  const $ = id => document.getElementById(id);
  const tex = (s, el, display) => katex.render(s, el, { throwOnError: false, displayMode: !!display });
  const texStr = (s, display) => katex.renderToString(s, { throwOnError: false, displayMode: !!display });
  const fmt = (v, d) => CV.fmtNum(v, d || 4);
  const plain = (v, d) => (Number.isFinite(v) ? (Math.abs(v) < 1e-12 ? '0' : (+v.toPrecision(d || 4)).toString()) : '∞');

  function el(tag, attrs, html) {
    const e = document.createElement(tag);
    if (attrs) Object.entries(attrs).forEach(([k, v]) => {
      if (k === 'class') e.className = v; else if (k === 'style') e.style.cssText = v; else e.setAttribute(k, v);
    });
    if (html !== undefined) e.innerHTML = html;
    return e;
  }

  /* ================================================================ state */
  const defs = new Map();
  const systems = new Map();
  const perSystem = new Map(); // remembered state per system id

  const state = {
    sysId: null, sys: null,
    consts: [0, 0, 0], surfOn: [true, true, true], point: [0, 0, 0], snap: true,
    showCov: true, showCon: true, showPhys: false, vecScale: 1, labels: true,
    showCurves: true, showGrid: true, showAxes: true, wire: true, opacity: 0.34, viewR: 3.5, gridOpacity: 0.35,
    vis: [[0, 1], [0, 1], [0, 1]],
    V: { on: false, cart: [1, 0.5, 0.6], con: true, co: false, phys: false },
    mode: 'alg', tab: 'metric'
  };

  let view3d, view2d, editor;
  const fields = { surf: [], point: [], params: [], cart: [], vec: [], vscale: null };

  function allDefs() { return [...defs.values()]; }
  const activeView = () => (state.sys && state.sys.n === 3 ? view3d : view2d);

  function loadDefs() {
    defs.clear();
    CV.BUILTIN_SYSTEMS.forEach(d => defs.set(d.id, d));
    CV.store.load().forEach(d => { d.group = 'custom'; defs.set(d.id, d); });
  }

  function getSystem(id) {
    if (!systems.has(id)) systems.set(id, new CV.CoordSystem(defs.get(id)));
    return systems.get(id);
  }

  /* ============================================================ selection */
  function buildSelect() {
    const sel = $('sys-select');
    sel.innerHTML = '';
    CV.GROUPS.forEach(g => {
      const items = allDefs().filter(d => (d.group || 'custom') === g.id);
      if (!items.length) return;
      const og = el('optgroup', { label: g.label });
      items.forEach(d => {
        const o = el('option', { value: d.id });
        o.textContent = d.name + (g.id === 'custom' ? '  (' + d.dim + 'D)' : '');
        og.appendChild(o);
      });
      sel.appendChild(og);
    });
    if (state.sysId) sel.value = state.sysId;
  }

  function saveSystemState() {
    if (!state.sys) return;
    perSystem.set(state.sysId, {
      consts: state.consts.slice(), point: state.point.slice(), surfOn: state.surfOn.slice(),
      V: state.V.cart.slice()
    });
  }

  function selectSystem(id) {
    if (!defs.has(id)) id = 'cylindrical';
    let sys;
    try { sys = getSystem(id); } catch (e) {
      toast('Cannot load system: ' + e.message);
      if (id !== 'cylindrical') selectSystem('cylindrical');
      return;
    }
    saveSystemState();
    state.sysId = id;
    state.sys = sys;
    CV.store.set('coordlab.last', id);
    const mem = perSystem.get(id);
    if (mem) {
      state.consts = mem.consts.slice(); state.point = mem.point.slice(); state.surfOn = mem.surfOn.slice();
      state.V.cart = mem.V.slice();
    } else {
      const u = sys.defaultPoint();
      state.consts = u.slice(); state.point = u.slice();
      state.surfOn = sys.n === 3 ? [true, true, true] : [true, true];
      state.V.cart = sys.n === 3 ? [1.0, 0.5, 0.7] : [1.0, 0.6];
    }
    state.viewR = sys.def.view || 3.5;
    applySnap();
    $('sys-select').value = id;
    const is3 = sys.n === 3;
    view2d.setActive(!is3);
    view3d.setActive(is3);
    if (is3) view3d.setSystem(sys, state); else view2d.setSystem(sys, state);
    fields.surf = []; fields.point = [];
    computeVis();
    buildSystemCard();
    buildSurfRows();
    buildPointRows();
    buildVecInputs();
    syncDisplayControls();
    buildLegend();
    $('hud-hint').innerHTML = is3
      ? 'Drag <b>P</b> to slide it along a surface · double-click a surface to move P there · drag to orbit · right-drag to pan · scroll to zoom'
      : 'Drag <b>P</b> or the tip of <b>V</b> · double-click to place P · drag to pan · scroll to zoom';
    $('custom-actions').classList.toggle('hidden', defs.get(id).group !== 'custom');
    refreshAll();
  }

  /** Restore the current system to its defaults: parameters, point, surfaces, vector and view. */
  function resetSystem() {
    const sys = state.sys;
    const id = state.sysId;
    sys.params.forEach((p, k) => sys.setParam(k, Number(sys.def.params[k].value)));
    perSystem.delete(id);
    state.sys = null; // do not store the current state again
    selectSystem(id);
    toast('“' + sys.name + '” reset to defaults');
  }

  /* ======================================================= visible ranges */
  /** Coordinate intervals covering the visible region (used by surfaces, curves, sliders). */
  function computeVis() {
    const sys = state.sys;
    const b = activeView().box();
    const seeds = [state.point.slice(), state.consts.slice()];
    let vis;
    try { vis = sys.visibleRanges(b.center, b.half, seeds); } catch (e) { vis = null; }
    if (!vis) vis = sys.coords.map((c, i) => sys.sampleRange(i));
    vis = vis.map((r, i) => {
      let [lo, hi] = r;
      if (!Number.isFinite(lo) || !Number.isFinite(hi) || !(lo < hi)) [lo, hi] = sys.sampleRange(i);
      return [lo, hi];
    });
    state.vis = vis;
    updateSliderRanges();
  }

  let visTimer = null;
  function scheduleVis(delay) {
    clearTimeout(visTimer);
    visTimer = setTimeout(() => {
      computeVis();
      invalidate({ surf: [0, 1, 2], frame: true });
    }, delay === undefined ? 160 : delay);
  }

  function onZoom() {
    invalidate({ frame: true });
    scheduleVis();
  }

  /** Zoom out if P (or the vector tip) left the visible region. */
  function keepPointVisible() {
    const f = state.sys.frame(state.point);
    if (!f.x.every(Number.isFinite)) return;
    activeView().ensureVisible([f.x]);
  }

  /* ========================================================== system card */
  function buildSystemCard() {
    const sys = state.sys, d = sys.def;
    const badges = $('sys-badges');
    const orth = sys.isOrthogonalAt(sys.defaultPoint());
    const bits = [];
    bits.push('<span class="badge">' + sys.n + 'D</span>');
    bits.push(orth ? '<span class="badge orth">Orthogonal</span>' : '<span class="badge nonorth">Non-orthogonal</span>');
    if (d.group === 'custom') bits.push('<span class="badge">Custom</span>');
    badges.innerHTML = bits.join('');

    const axes = ['x', 'y', 'z'];
    const lines = sys.X.map((x, a) => axes[a] + ' &= ' + CV.tex(x));
    const box = $('sys-formula');
    box.innerHTML = '';
    const f = el('div');
    tex('\\begin{aligned}' + lines.join('\\\\[2pt]') + '\\end{aligned}', f, true);
    box.appendChild(f);
    box.appendChild(el('div', { class: 'domain' }));
    renderDomain();

    const note = $('sys-note');
    note.textContent = d.note || '';
    note.classList.toggle('hidden', !d.note);

    const pbox = $('sys-params');
    pbox.innerHTML = '';
    fields.params = [];
    sys.params.forEach((p, k) => {
      const row = el('div', { class: 'param-row' });
      const name = el('span', { class: 'name' });
      tex(CV.symTex(p.n), name);
      const nf = new CV.NumField({
        value: sys.pvals[k], min: Math.min(p.min, sys.pvals[k]), max: Math.max(p.max, sys.pvals[k]), settings: true,
        hardMin: p.hmin, hardMax: p.hmax,
        validate: v => {
          // reject values that make the system unusable (empty domain, undefined map)
          const old = sys.pvals[k];
          sys.setParam(k, v);
          const ok = sys.isValidAt(state.point) || sys.isValidAt(sys.defaultPoint());
          sys.setParam(k, old);
          return ok ? v : null;
        },
        onChange: v => { sys.setParam(k, v); onParamsChanged(); }
      });
      fields.params.push(nf);
      row.append(name, nf.el);
      pbox.appendChild(row);
    });
  }

  function boundTex(v) {
    if (!Number.isFinite(v)) return v > 0 ? '\\infty' : '-\\infty';
    const b = CV.fmtBound(v);
    if (/pi/.test(b)) { try { return CV.tex(math.parse(b)); } catch (e) { /* fall through */ } }
    return fmt(v, 3);
  }

  function renderDomain() {
    const sys = state.sys;
    const dom = $('sys-formula').querySelector('.domain');
    if (!dom) return;
    dom.innerHTML = sys.coords.map((c, i) => {
      const [lo, hi] = sys.range(i);
      return '<span style="white-space:nowrap;margin-right:14px">' +
        texStr(boundTex(lo) + (Number.isFinite(lo) ? ' \\le ' : ' < ') + CV.symTex(c.n) + (Number.isFinite(hi) ? ' \\le ' : ' < ') + boundTex(hi)) +
        (c.periodic ? ' <span title="periodic">⟳</span>' : '') + '</span>';
    }).join(' ');
  }

  function onParamsChanged() {
    const sys = state.sys;
    for (let i = 0; i < sys.n; i++) {
      state.consts[i] = sys.clampCoord(i, state.consts[i]);
      state.point[i] = sys.clampCoord(i, state.point[i]);
    }
    renderDomain();
    invalidate({ frame: true, panel: true, ui: true });
    scheduleVis(60);
  }

  /* ======================================================= surfaces/point */
  const coordColor = i => CV.COLORS[i];

  /** Validation for a coordinate value: wrap periodic ones, reject values outside the domain. */
  function coordValidate(i) {
    return v => {
      const sys = state.sys;
      const c = sys.coords[i];
      if (c.periodic) return sys.clampCoord(i, v);
      const [lo, hi] = sys.range(i);
      return v >= lo && v <= hi ? v : null;
    };
  }

  function sliderRange(i) {
    const sys = state.sys;
    if (sys.coords[i].periodic) return sys.range(i);
    return state.vis[i];
  }

  function buildSurfRows() {
    const sys = state.sys, box = $('surf-rows');
    const is3 = sys.n === 3;
    $('surf-title').textContent = is3 ? 'Coordinate surfaces' : 'Coordinate curves';
    $('surf-hint').textContent = is3
      ? 'One coordinate held constant – toggle each family and set its constant.'
      : 'In 2D, holding one coordinate constant gives a curve.';
    box.innerHTML = '';
    fields.surf = [];
    sys.coords.forEach((c, i) => {
      const row = el('div', { class: 'surf-row' + (state.surfOn[i] ? '' : ' off') });
      const top = el('div', { class: 'top' });
      const dot = el('span', { class: 'dot', style: 'color:' + coordColor(i) });
      const name = el('span', { class: 'name' });
      tex(CV.symTex(c.n) + ' = \\text{const}', name);
      const tg = el('label', { class: 'toggle' }, '<input type="checkbox"><span class="track"></span>');
      const cb = tg.querySelector('input');
      cb.checked = state.surfOn[i];
      cb.addEventListener('change', () => {
        state.surfOn[i] = cb.checked;
        row.classList.toggle('off', !cb.checked);
        if (cb.checked && state.snap) state.point[i] = state.consts[i];
        invalidate({ surf: [i], frame: true, panel: true, ui: true });
      });
      top.append(dot, name, tg);
      row.appendChild(top);
      if (c.surf) { const fam = el('div', { class: 'fam' }); fam.textContent = c.surf; row.appendChild(fam); }
      const [lo, hi] = sliderRange(i);
      const nf = new CV.NumField({
        value: state.consts[i], min: lo, max: hi, color: coordColor(i), validate: coordValidate(i),
        onChange: (v, final) => setConst(i, v, final)
      });
      nf.el.classList.add('ctrl');
      fields.surf.push(nf);
      row.appendChild(nf.el);
      box.appendChild(row);
    });
  }

  function buildPointRows() {
    const sys = state.sys, box = $('point-rows');
    box.innerHTML = '';
    fields.point = [];
    sys.coords.forEach((c, i) => {
      const row = el('div', { class: 'pt-row', 'data-pt': i });
      const name = el('span');
      tex(CV.symTex(c.n), name);
      const [lo, hi] = sliderRange(i);
      const nf = new CV.NumField({
        value: state.point[i], min: lo, max: hi, color: coordColor(i), validate: coordValidate(i),
        onChange: (v, final) => setPointCoord(i, v, final)
      });
      fields.point.push(nf);
      row.append(name, nf.el);
      box.appendChild(row);
    });
    // Cartesian position of P (editable: converted to system coordinates)
    const cbox = $('point-cart');
    cbox.innerHTML = '';
    fields.cart = [];
    const f = sys.frame(state.point);
    ['x', 'y', 'z'].slice(0, sys.n).forEach((a, k) => {
      const l = el('label', { class: 'cart-in' });
      const s = el('span');
      tex(a, s);
      const nf = new CV.NumField({ value: f.x[k], slider: false, digits: 6, onChange: (v, final) => { if (final) setCartesian(k, v); } });
      fields.cart.push(nf);
      l.append(s, nf.el);
      cbox.appendChild(l);
    });
    syncPointRows();
  }

  function isLocked(i) { return state.snap && state.surfOn[i]; }

  function syncPointRows() {
    fields.point.forEach((nf, i) => {
      const locked = isLocked(i);
      nf.setDisabled(locked);
      nf.el.parentElement.classList.toggle('locked', locked);
      nf.el.title = locked ? 'Locked to the active surface – move the surface or drag P' : '';
      nf.set(state.point[i]);
    });
    const f = state.sys.frame(state.point);
    fields.cart.forEach((nf, k) => nf.set(f.x[k]));
    $('point-sing').classList.toggle('hidden', f.ok);
  }

  function syncSurfRows() { fields.surf.forEach((nf, i) => nf.set(state.consts[i])); }

  function updateSliderRanges() {
    if (!state.sys) return;
    const n = state.sys.n;
    fields.surf.forEach((nf, i) => { if (i < n) { const [lo, hi] = sliderRange(i); nf.setRange(lo, hi); } });
    fields.point.forEach((nf, i) => { if (i < n) { const [lo, hi] = sliderRange(i); nf.setRange(lo, hi); } });
  }

  function applySnap() {
    if (!state.snap) return;
    for (let i = 0; i < state.sys.n; i++) if (state.surfOn[i]) state.point[i] = state.consts[i];
  }

  function setConst(i, v, final) {
    if (!Number.isFinite(v)) return;
    state.consts[i] = state.sys.clampCoord(i, v);
    if (isLocked(i)) state.point[i] = state.consts[i];
    invalidate({ surf: [i], frame: true, panel: true, ui: true });
    if (final) afterPointMove();
  }

  function setPointCoord(i, v, final) {
    if (!Number.isFinite(v) || isLocked(i)) return;
    state.point[i] = state.sys.clampCoord(i, v);
    invalidate({ frame: true, panel: true, ui: true });
    if (final) afterPointMove();
  }

  /** After a committed move: keep P on screen and refresh the visible ranges. */
  function afterPointMove() {
    keepPointVisible();
    scheduleVis(80);
  }

  /** Move P to the given Cartesian component; converted to system coordinates (nearest point). */
  function setCartesian(k, v) {
    const sys = state.sys;
    const f = sys.frame(state.point);
    const target = f.x.slice();
    target[k] = v;
    const seeds = [state.point, sys.defaultPoint()];
    // a coarse grid of seeds over the visible coordinate ranges for robustness
    const G = sys.n === 3 ? 4 : 7;
    const total = Math.pow(G, sys.n);
    for (let t = 0; t < total; t++) {
      let r = t;
      seeds.push(state.vis.map(([lo, hi]) => { const q = r % G; r = Math.floor(r / G); return lo + (hi - lo) * (q + 0.5) / G; }));
    }
    let best = null;
    for (const s0 of seeds) {
      const res = sys.invert(target, s0);
      if (!best || res.err < best.err) best = res;
      if (res.err < 1e-10 * Math.max(1, Math.abs(v))) break;
    }
    if (!best) return;
    const scale = Math.max(1, Math.hypot.apply(null, target));
    if (best.err > 1e-6 * scale) toast('This point is outside the region covered by the system – P moved to the nearest reachable point.');
    const u = best.u;
    state.point = u.slice();
    if (state.snap) for (let i = 0; i < sys.n; i++) if (state.surfOn[i]) state.consts[i] = u[i];
    invalidate({ surf: [0, 1, 2], frame: true, panel: true, ui: true });
    afterPointMove();
  }

  function onDragPoint(u) {
    const sys = state.sys;
    const changed = [];
    u = u.map((v, i) => sys.clampCoord(i, v));
    if (!u.every(Number.isFinite)) return;
    state.point = u.slice();
    if (state.snap) {
      for (let i = 0; i < sys.n; i++) {
        if (state.surfOn[i] && Math.abs(state.consts[i] - u[i]) > 1e-12) { state.consts[i] = u[i]; changed.push(i); }
      }
    }
    invalidate({ surf: changed, frame: true, panel: true, ui: true });
  }

  function onDragVector(cart) {
    state.V.cart = cart.slice();
    syncVecInputs();
    invalidate({ frame: true, panel: true });
  }

  /* =============================================================== vector */
  function buildVecInputs() {
    const box = $('vec-inputs');
    box.innerHTML = '';
    fields.vec = [];
    const n = state.sys.n;
    box.style.gridTemplateColumns = 'repeat(' + n + ', 1fr)';
    ['x', 'y', 'z'].slice(0, n).forEach((a, k) => {
      const l = el('label');
      const s = el('span');
      tex('V_' + a, s);
      const nf = new CV.NumField({
        value: state.V.cart[k], slider: false, digits: 5,
        onChange: v => { state.V.cart[k] = v; invalidate({ frame: true, panel: true }); }
      });
      fields.vec.push(nf);
      l.append(s, nf.el);
      box.appendChild(l);
    });
    $('vec-hint').classList.toggle('hidden', n !== 2);
    $('vec-body').classList.toggle('off', !state.V.on);
  }
  function syncVecInputs() { fields.vec.forEach((nf, k) => nf.set(state.V.cart[k])); }

  /* ============================================================== display */
  function syncDisplayControls() {
    const is3 = state.sys.n === 3;
    $('w-grid').classList.toggle('hidden', is3);
    $('w-wire').classList.toggle('hidden', !is3);
    $('w-opacity').classList.toggle('hidden', !is3);
  }

  function buildLegend() {
    const sys = state.sys;
    const L = $('legend');
    L.className = 'hud tl glass';
    const rows = sys.coords.map((c, i) => '<div class="row"><span class="sw" style="background:' + coordColor(i) + '"></span>' +
      texStr('u^{' + (i + 1) + '} = ' + CV.symTex(c.n)) + '</div>').join('');
    L.innerHTML = '<div class="title">' + sys.name + '</div>' + rows +
      '<div class="sep"></div>' +
      '<div class="row"><span class="la"></span>' + texStr('\\mathbf E_i') + '&nbsp;covariant (tangent)</div>' +
      '<div class="row"><span class="la d"></span>' + texStr('\\mathbf E^i') + '&nbsp;contravariant (normal)</div>' +
      '<div class="row"><span class="la p"></span>' + texStr('\\hat{\\mathbf e}_{(i)}') + '&nbsp;physical (unit)</div>';
  }

  function updateHudPoint() {
    const sys = state.sys;
    const f = sys.frame(state.point);
    const names = sys.cnames.map(CV.uniName).join(', ');
    $('hud-point').className = 'hud bl glass';
    $('hud-point').innerHTML = 'P(' + names + ') = (' + state.point.map(v => plain(v, 4)).join(', ') + ')<br>' +
      '&nbsp;&nbsp;(' + ['x', 'y', 'z'].slice(0, sys.n).join(', ') + ') = (' + f.x.map(v => plain(v, 4)).join(', ') + ')';
  }

  /* ========================================================= invalidation */
  let pending = null;
  function invalidate(what) {
    if (!pending) {
      pending = { surf: new Set(), frame: false, panel: false, ui: false };
      requestAnimationFrame(flush);
    }
    (what.surf || []).forEach(i => pending.surf.add(i));
    pending.frame = pending.frame || !!what.frame;
    pending.panel = pending.panel || !!what.panel;
    pending.ui = pending.ui || !!what.ui;
  }
  // Continuous interaction (dragging P, moving sliders): render coarse geometry and throttle
  // the tensor panel; a full-quality refresh follows shortly after the last change.
  let lastBusy = 0, fineTimer = null, lastPanel = 0, panelTimer = null;
  function flush() {
    const p = pending;
    pending = null;
    if (!p || !state.sys) return;
    const now = performance.now();
    const busy = p.surf.size > 0 || p.ui;
    state.fast = busy && now - lastBusy < 250;
    if (busy) {
      lastBusy = now;
      clearTimeout(fineTimer);
      fineTimer = setTimeout(() => {
        state.fast = false;
        if (state.sys.n === 3) { for (let i = 0; i < 3; i++) view3d.updateSurface(state, i); view3d.updateFrame(state); }
      }, 260);
    }
    if (state.sys.n === 3) {
      p.surf.forEach(i => view3d.updateSurface(state, i));
      if (p.frame) view3d.updateFrame(state);
    } else view2d.request();
    if (p.ui) { syncSurfRows(); syncPointRows(); }
    if (p.frame) updateHudPoint();
    if (p.panel && (state.mode === 'num' || state.tab === 'vectors')) {
      clearTimeout(panelTimer);
      if (now - lastPanel > 120) { lastPanel = now; renderPanel(); } else panelTimer = setTimeout(() => { lastPanel = performance.now(); renderPanel(); }, 130);
    }
  }
  function refreshAll() {
    if (state.sys.n === 3) view3d.updateAll(state); else view2d.request();
    syncSurfRows(); syncPointRows(); updateHudPoint();
    renderPanel();
  }

  /* =========================================================== tensor panel */
  let panelToken = 0;
  function matTeX(rows) {
    return '\\begin{pmatrix}' + rows.map(r => r.join(' & ')).join(' \\\\[3pt] ') + '\\end{pmatrix}';
  }
  const symTeX = node => (CV.isZeroNode(node) ? '0' : CV.tex(node).replace(/\\frac/g, '\\dfrac'));
  const block = (title, cap, mathHtml, cls) =>
    '<section class="tblock' + (cls ? ' ' + cls : '') + '"><h3>' + title + '</h3>' + (cap ? '<p class="cap">' + cap + '</p>' : '') +
    '<div class="math">' + mathHtml + '</div></section>';

  function showProgress(on, frac) {
    $('sym-progress').classList.toggle('hidden', !on);
    if (on) $('sym-progress').querySelector('i').style.width = Math.round((frac || 0) * 100) + '%';
  }

  async function renderPanel() {
    const token = ++panelToken;
    const sys = state.sys;
    const body = $('tensor-body');
    const n = sys.n;
    const f = sys.frame(state.point);
    const ct = sys.cnames.map(CV.symTex);
    const order = '(' + ct.join(',\\,') + ')';
    const alg = state.mode === 'alg';
    let sym = null, extra = null;
    if (alg) {
      const need = state.tab === 'christoffel' ? 'christoffel' : state.tab === 'vectors' ? 'dual' : 'basic';
      const prog = (fr) => { if (token === panelToken) showProgress(true, fr); };
      const S = sys._sym || {};
      const cached = S.basic && S.basic.__done && (need === 'basic' || (S[need] && S[need].__done)) &&
        (need !== 'dual' || (S.phys && S.phys.__done));
      if (!cached) {
        showProgress(true, 0);
        if (!body.dataset.sys || body.dataset.sys !== sys.id) body.innerHTML = '';
      }
      try {
        sym = await sys.symbolic('basic', need === 'basic' ? prog : null);
        sys._sym.basic.__done = true;
        if (need !== 'basic') {
          extra = await sys.symbolic(need, prog);
          sys._sym[need].__done = true;
        }
        if (need === 'dual') {
          extra = Object.assign({}, extra, { phys: await sys.symbolic('phys', prog) });
          sys._sym.phys.__done = true;
        }
      } catch (e) {
        console.error(e);
        if (token !== panelToken) return;
        showProgress(false);
        body.innerHTML = block('Symbolic computation failed', 'Switch to Numeric mode to see the values.', '<code>' + (e.message || e) + '</code>', 'err');
        return;
      }
      if (token !== panelToken) return;
      showProgress(false);
    } else showProgress(false);
    body.dataset.sys = sys.id;

    let html = '';
    const ptCap = alg ? 'Exact expressions (parameters kept symbolic).' : 'Values at P = (' + state.point.map(v => plain(v, 4)).join(', ') + ').';
    const numMat = M => matTeX(M.map(r => r.map(v => fmt(v))));

    if (state.tab === 'metric') {
      const g = alg ? matTeX(sym.g.map(r => r.map(symTeX))) : numMat(f.g);
      const gi = alg ? matTeX(sym.gi.map(r => r.map(symTeX))) : numMat(f.gi);
      html += block('Covariant metric tensor', 'g<sub>ij</sub> = E<sub>i</sub> · E<sub>j</sub>. Rows and columns ordered ' + texStr(order) + '. ' + ptCap,
        texStr('g_{ij} = ' + g, true));
      html += block('Contravariant metric tensor', 'g<sup>ij</sup> = E<sup>i</sup> · E<sup>j</sup>, the inverse matrix of g<sub>ij</sub>.',
        texStr('g^{ij} = ' + gi, true));
      const detG = alg ? symTeX(sym.detG) : fmt(CV.la.det(f.g));
      let detHtml = texStr('g = \\det(g_{ij}) = ' + detG, true);
      if (!alg) {
        const I = f.g.map((r, i) => f.gi[0].map((_, j) => r.reduce((s, v, k) => s + v * f.gi[k][j], 0)));
        detHtml += texStr('g_{ik}\\,g^{kj} = ' + matTeX(I.map(r => r.map(v => fmt(Math.abs(v) < 1e-10 ? 0 : v, 3)))) + ' = \\delta_i^{\\,j}', true);
      }
      html += block('Determinant', '', detHtml);
      const orthNow = alg ? sym.orthogonal : sys.isOrthogonalAt(state.point);
      html += block(orthNow ? 'Orthogonal system' : 'Non-orthogonal system',
        orthNow ? 'g<sub>ij</sub> is diagonal: E<sub>i</sub> and E<sup>i</sup> are parallel, with |E<sup>i</sup>| = 1/|E<sub>i</sub>| (scale factors h<sub>i</sub> = √g<sub>ii</sub>).'
          : 'Off-diagonal metric terms: the tangent vectors E<sub>i</sub> are not perpendicular, so E<sup>i</sup> (normal to the surfaces u<sup>i</sup> = const) points in a different direction than E<sub>i</sub>.', '');
    } else if (state.tab === 'jacobian') {
      const axes = ['x', 'y', 'z'].slice(0, n);
      const J = alg ? matTeX(sym.J.map(r => r.map(symTeX))) : numMat(f.J);
      const lhs = '\\dfrac{\\partial(' + axes.join(',') + ')}{\\partial' + order + '}';
      html += block('Jacobian matrix', 'J<sup>a</sup><sub>i</sub> = ∂x<sup>a</sup>/∂u<sup>i</sup>; its columns are the covariant basis vectors E<sub>i</sub>. ' + ptCap,
        texStr('J = ' + lhs + ' = ' + J, true));
      const dj = alg ? symTeX(sym.detJ) : fmt(f.detJ);
      const sg = alg ? symTeX(sym.sqrtG) : fmt(Math.sqrt(Math.max(0, CV.la.det(f.g))));
      html += block('Jacobian determinant', '√g = |det J| is the volume (area) distortion factor.',
        texStr('\\det J = ' + dj, true) + texStr('\\sqrt{g} = ' + sg, true));
      // line element
      const du = i => 'd' + ct[i];
      const terms = [];
      for (let i = 0; i < n; i++) for (let j = i; j < n; j++) {
        let coef;
        if (alg) {
          const node = sym.g[i][j];
          if (CV.isZeroNode(node)) continue;
          const s = CV.tex(node);
          const isOne = node.type === 'ConstantNode' && node.value === 1;
          const needPar = /[+-]/.test(s.replace(/^-/, '')) && !/^\\frac/.test(s);
          coef = (i !== j ? '2' : '') + (isOne ? '' : (needPar ? '\\left(' + s + '\\right)' : s));
        } else {
          const v = f.g[i][j] * (i === j ? 1 : 2);
          if (Math.abs(v) < 1e-12) continue;
          coef = fmt(v);
        }
        terms.push(coef + '\\,' + (i === j ? '(' + du(i) + ')^2' : du(i) + '\\,' + du(j)));
      }
      let ds;
      const totalLen = terms.join('').length;
      if (terms.length > 1 && totalLen > 90) {
        ds = '\\begin{aligned} ds^2 &= ' + terms.map((t, k) => (k ? '&\\quad + ' : '') + t).join(' \\\\ ').replace(/\+ -/g, '- ') + '\\end{aligned}';
      } else ds = 'ds^2 = ' + (terms.length ? terms.join(' + ').replace(/\+ -/g, '- ') : '0');
      html += block('Line element', 'ds² = g<sub>ij</sub> du<sup>i</sup> du<sup>j</sup>' + (alg ? '' : ' at P') + '.', texStr(ds, true));
      const dV = (n === 3 ? 'dV' : 'dA') + ' = ' + (alg ? (CV.isZeroNode(sym.sqrtG) ? '0' : symTeX(sym.sqrtG)) : sg) + '\\;' + ct.map((c, i) => du(i)).join('\\,');
      html += block(n === 3 ? 'Volume element' : 'Area element', '', texStr(dV, true));
    } else if (state.tab === 'christoffel') {
      let allZero = true;
      let mats = '';
      for (let k = 0; k < n; k++) {
        const M = alg ? extra.Gamma[k].map(r => r.map(symTeX)) : f.Gamma[k].map(r => r.map(v => fmt(Math.abs(v) < 1e-12 ? 0 : v)));
        if (M.some(r => r.some(v => v !== '0'))) allZero = false;
        mats += texStr('\\Gamma^{' + ct[k] + '}_{ij} = ' + matTeX(M), true);
      }
      html += block('Christoffel symbols of the second kind',
        'Γ<sup>k</sup><sub>ij</sub> = E<sup>k</sup> · ∂E<sub>i</sub>/∂u<sup>j</sup> = ½ g<sup>kl</sup>(∂<sub>i</sub>g<sub>jl</sub> + ∂<sub>j</sub>g<sub>il</sub> − ∂<sub>l</sub>g<sub>ij</sub>), symmetric in i, j. Matrix rows i, columns j, ordered ' + texStr(order) + '. ' + ptCap,
        mats);
      if (allZero) html += block('All symbols vanish', 'The basis vectors do not change from point to point (affine coordinates).', '');
    } else if (state.tab === 'vectors') {
      const vecT = arr => '\\left(' + arr.join(',\\;') + '\\right)';
      let cov = '', con = '';
      for (let i = 0; i < n; i++) {
        const nm = ct[i];
        const L = Math.hypot.apply(null, f.E[i]);
        const Lc = Math.hypot.apply(null, f.Econ[i]);
        if (alg) {
          cov += texStr('\\mathbf E_{' + nm + '} = ' + vecT(sym.J.map(r => symTeX(r[i]))), true);
          con += texStr('\\mathbf E^{' + nm + '} = ' + vecT(extra.Econ[i].map(symTeX)), true);
        } else {
          cov += texStr('\\mathbf E_{' + nm + '} = ' + vecT(f.E[i].map(v => fmt(v))) + ',\\quad |\\mathbf E_{' + nm + '}| = ' + fmt(L), true);
          con += texStr('\\mathbf E^{' + nm + '} = ' + vecT(f.Econ[i].map(v => fmt(v))) + ',\\quad |\\mathbf E^{' + nm + '}| = ' + fmt(Lc), true);
        }
      }
      html += block('Covariant basis (tangent)', 'E<sub>i</sub> = ∂r/∂u<sup>i</sup> — tangent to the coordinate curve along which only u<sup>i</sup> varies. Cartesian components. ' + ptCap, cov);
      html += block('Contravariant basis (normal)', 'E<sup>i</sup> = ∇u<sup>i</sup> = g<sup>ij</sup>E<sub>j</sub> — normal to the surface u<sup>i</sup> = const.', con);
      let phy = '';
      for (let i = 0; i < n; i++) {
        const nm = ct[i];
        const lhs = '\\hat{\\mathbf e}_{(' + nm + ')} = \\frac{\\mathbf E_{' + nm + '}}{h_{' + nm + '}} = ';
        if (alg) {
          phy += texStr(lhs + vecT(extra.phys.e[i].map(symTeX)) + ',\\quad h_{' + nm + '} = \\sqrt{g_{' + nm + nm + '}} = ' + symTeX(extra.phys.h[i]), true);
        } else {
          const h = Math.sqrt(f.g[i][i]);
          phy += texStr(lhs + vecT(f.E[i].map(v => fmt(v / h))) + ',\\quad h_{' + nm + '} = \\sqrt{g_{' + nm + nm + '}} = ' + fmt(h), true);
        }
      }
      html += block('Physical basis (unit vectors)', 'ê<sub>(i)</sub> = E<sub>i</sub>/h<sub>i</sub>, h<sub>i</sub> = √g<sub>ii</sub> — unit tangent vectors; components along them are the physical components. ' + ptCap, phy);
      const D = f.E.map(Ei => f.Econ.map(Ej => CV.la.dot(Ei, Ej)));
      let angles = '';
      for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
        const c = f.g[i][j] / Math.sqrt(f.g[i][i] * f.g[j][j]);
        angles += '<span class="badge">∠(E<sub>' + CV.uniName(sys.cnames[i]) + '</sub>, E<sub>' + CV.uniName(sys.cnames[j]) + '</sub>) = ' + plain(Math.acos(Math.max(-1, Math.min(1, c))) * 180 / Math.PI, 4) + '°</span> ';
      }
      html += block('Reciprocity', 'E<sub>i</sub> · E<sup>j</sup> = δ<sub>i</sub><sup>j</sup> at P; angles between the covariant basis vectors:',
        texStr('\\mathbf E_i\\cdot\\mathbf E^j = ' + matTeX(D.map(r => r.map(v => fmt(Math.abs(v) < 1e-10 ? 0 : v, 3)))), true) + '<div class="chips">' + angles + '</div>');
      if (state.V.on) {
        const V = state.V.cart.slice(0, n);
        const up = f.Econ.map(E => CV.la.dot(E, V));
        const dn = f.E.map(E => CV.la.dot(E, V));
        const lowered = f.g.map(r => CV.la.dot(r, up));
        let vh = texStr('\\mathbf V = ' + vecT(V.map(v => fmt(v))) + '\\ \\text{(Cartesian)}', true);
        vh += texStr('V^{i} = \\mathbf E^{i}\\cdot\\mathbf V = ' + vecT(up.map(v => fmt(v))), true);
        vh += texStr('V_{i} = \\mathbf E_{i}\\cdot\\mathbf V = ' + vecT(dn.map(v => fmt(v))), true);
        vh += texStr('g_{ij}V^{j} = ' + vecT(lowered.map(v => fmt(v))) + ' = V_i', true);
        const phys = up.map((v, i) => v * Math.sqrt(f.g[i][i]));
        vh += texStr('V_{(i)} = \\sqrt{g_{ii}}\\,V^{i} = ' + vecT(phys.map(v => fmt(v))) + '\\ \\text{(physical)}', true);
        vh += texStr('|\\mathbf V|^2 = V^iV_i = ' + fmt(CV.la.dot(up, dn)), true);
        html += block('Vector V at P', 'Contravariant components V<sup>i</sup> give V = V<sup>i</sup>E<sub>i</sub>; covariant components V<sub>i</sub> give V = V<sub>i</sub>E<sup>i</sup>; physical components V<sub>(i)</sub> give V = V<sub>(i)</sub>ê<sub>(i)</sub>.', vh);
      } else {
        html += block('Vector V', 'Enable “Show vector V” in the left panel to see its covariant and contravariant components here.', '');
      }
    }
    if (token !== panelToken) return;
    body.innerHTML = html;
    fitMath(body);
  }

  /** Shrink very wide formulas (down to 70%) so most matrices fit without scrolling. */
  function fitMath(root) {
    root.querySelectorAll('.tblock .math').forEach(m => {
      m.style.fontSize = '';
      const w = m.clientWidth, sw = m.scrollWidth;
      if (sw > w * 1.01 && w > 0) m.style.fontSize = Math.max(0.7, (w / sw) * 0.98).toFixed(3) + 'em';
    });
  }


  /* =============================================================== misc UI */
  function toast(msg) {
    const t = $('toast');
    t.textContent = msg;
    t.classList.remove('hidden');
    clearTimeout(toast._t);
    toast._t = setTimeout(() => t.classList.add('hidden'), 3200);
  }

  function bindControls() {
    $('sys-select').addEventListener('change', e => selectSystem(e.target.value));
    const bindToggle = (id, fn) => $(id).addEventListener('change', e => fn(e.target.checked));
    bindToggle('t-cov', v => { state.showCov = v; invalidate({ frame: true }); });
    bindToggle('t-con', v => { state.showCon = v; invalidate({ frame: true }); });
    bindToggle('t-phys', v => { state.showPhys = v; invalidate({ frame: true }); });
    bindToggle('t-labels', v => { state.labels = v; invalidate({ frame: true }); });
    bindToggle('t-snap', v => {
      state.snap = v;
      $('snap-hint').textContent = v
        ? 'P sits at the intersection of the active surfaces – moving a surface moves P, dragging P moves the surfaces.'
        : 'P moves freely; the surfaces keep their own constants.';
      applySnap();
      invalidate({ frame: true, panel: true, ui: true });
    });
    bindToggle('t-curves', v => { state.showCurves = v; invalidate({ frame: true }); });
    bindToggle('t-grid', v => { state.showGrid = v; invalidate({ frame: true }); });
    bindToggle('t-axes', v => { state.showAxes = v; if (state.sys.n === 3) view3d.updateStyle(state); invalidate({ frame: true }); });
    bindToggle('t-wire', v => { state.wire = v; view3d.updateStyle(state); });
    bindToggle('t-vec', v => { state.V.on = v; $('vec-body').classList.toggle('off', !v); invalidate({ frame: true, panel: true }); if (state.tab === 'vectors') renderPanel(); });
    bindToggle('t-vcon', v => { state.V.con = v; invalidate({ frame: true }); });
    bindToggle('t-vco', v => { state.V.co = v; invalidate({ frame: true }); });
    bindToggle('t-vphys', v => { state.V.phys = v; invalidate({ frame: true }); });

    fields.vscale = new CV.NumField({
      value: state.vecScale, min: 0.05, max: 10, log: true, settings: true, hardMin: 0,
      onChange: v => { state.vecScale = v; invalidate({ frame: true }); }
    });
    $('f-vscale').appendChild(fields.vscale.el);
    $('r-opacity').addEventListener('input', e => { state.opacity = +e.target.value; $('o-opacity').textContent = state.opacity.toFixed(2); view3d.updateStyle(state); });
    fields.gridop = new CV.NumField({
      value: state.gridOpacity, min: 0, max: 1, autoExpand: false, digits: 3,
      validate: v => (v >= 0 && v <= 1 ? v : null),
      onChange: v => { state.gridOpacity = v; view3d.setGridOpacity(v); view2d.request(); }
    });
    $('f-gridop').appendChild(fields.gridop.el);
    $('btn-reset-sys').addEventListener('click', resetSystem);
    $('btn-reset-view').addEventListener('click', () => {
      state.viewR = state.sys.def.view || 3.5;
      if (state.sys.n === 3) view3d.resetCamera(state.viewR); else { view2d.setExtent(state.viewR); view2d.resetView(); }
      keepPointVisible();
      computeVis();
      invalidate({ surf: [0, 1, 2], frame: true });
    });
    $('btn-center-p').addEventListener('click', () => {
      const f = state.sys.frame(state.point);
      if (!f.x.every(Number.isFinite)) return;
      if (state.sys.n === 3) view3d.centerOn(f.x); else view2d.centerOn(f.x);
      scheduleVis(0);
    });

    $('seg-mode').addEventListener('click', e => {
      const b = e.target.closest('button[data-mode]');
      if (!b) return;
      state.mode = b.dataset.mode;
      $('seg-mode').querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b));
      renderPanel();
    });
    $('tabs').addEventListener('click', e => {
      const b = e.target.closest('button[data-tab]');
      if (!b) return;
      state.tab = b.dataset.tab;
      $('tabs').querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b));
      renderPanel();
    });

    $('btn-toggle-left').addEventListener('click', () => { $('app').classList.toggle('no-left'); });
    $('btn-toggle-right').addEventListener('click', () => { $('app').classList.toggle('no-right'); });

    // custom systems
    const saveCustom = def => {
      const list = CV.store.load().filter(d => d.id !== def.id);
      list.push(def);
      if (!CV.store.save(list)) toast('Could not save to browser storage – the system is available until you reload.');
      defs.set(def.id, def);
      systems.delete(def.id);
      perSystem.delete(def.id);
      buildSelect();
      selectSystem(def.id);
      toast('Saved “' + def.name + '”');
    };
    $('btn-new').addEventListener('click', () => editor.open(null, saveCustom));
    $('btn-copy').addEventListener('click', () => {
      const d = defs.get(state.sysId);
      const copy = JSON.parse(JSON.stringify(d));
      copy.params = state.sys.params.map((p, k) => Object.assign({}, p, { value: state.sys.pvals[k] }));
      editor.open(copy, saveCustom);
    });
    $('btn-edit').addEventListener('click', () => editor.open(defs.get(state.sysId), saveCustom));
    $('btn-delete').addEventListener('click', () => {
      const d = defs.get(state.sysId);
      if (!d || d.group !== 'custom') return;
      if (!confirm('Delete custom system “' + d.name + '”?')) return;
      CV.store.save(CV.store.load().filter(x => x.id !== d.id));
      defs.delete(d.id); systems.delete(d.id); perSystem.delete(d.id);
      state.sysId = null;
      buildSelect();
      selectSystem('cylindrical');
      toast('Deleted “' + d.name + '”');
    });

    // import / export
    $('btn-io').addEventListener('click', () => { $('io-status').textContent = ''; $('io-dialog').showModal(); });
    $('io-export').addEventListener('click', () => {
      const list = CV.store.load();
      if (!list.length) { $('io-status').textContent = 'No custom systems to export yet.'; return; }
      const blob = new Blob([JSON.stringify({ format: 'coordlab', version: 1, systems: list }, null, 2)], { type: 'application/json' });
      const a = el('a', { href: URL.createObjectURL(blob), download: 'custom-coordinate-systems.json' });
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
      $('io-status').textContent = 'Exported ' + list.length + ' system(s).';
    });
    $('io-file').addEventListener('change', async e => {
      const file = e.target.files[0];
      e.target.value = '';
      if (!file) return;
      try {
        const data = JSON.parse(await file.text());
        const arr = Array.isArray(data) ? data : data.systems;
        if (!Array.isArray(arr)) throw new Error('No systems found in file.');
        const list = CV.store.load();
        let added = 0, bad = 0;
        arr.forEach(d => {
          try {
            d.group = 'custom';
            if (!d.id || !String(d.id).startsWith('custom-')) d.id = 'custom-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
            new CV.CoordSystem(d); // validate
            const k = list.findIndex(x => x.id === d.id);
            if (k >= 0) list[k] = d; else list.push(d);
            defs.set(d.id, d); systems.delete(d.id);
            added++;
          } catch (err) { bad++; }
        });
        CV.store.save(list);
        buildSelect();
        $('io-status').textContent = 'Imported ' + added + ' system(s)' + (bad ? ', skipped ' + bad + ' invalid.' : '.');
      } catch (err) {
        $('io-status').textContent = 'Import failed: ' + err.message;
      }
    });

    document.querySelectorAll('.k[data-tex]').forEach(e => tex(e.dataset.tex, e));
  }

  /* ================================================================= init */
  function init() {
    const cb = {
      getState: () => state, onDragPoint, onDragVector,
      onZoom, onPan: () => scheduleVis(), onViewChanged: () => scheduleVis(0),
      onDragEnd: afterPointMove
    };
    view3d = new CV.View3D($('view3d'), $('labels'), cb);
    view2d = new CV.View2D($('view2d'), cb);
    editor = new CV.Editor();
    loadDefs();
    buildSelect();
    bindControls();
    const last = CV.store.get('coordlab.last');
    selectSystem(last && defs.has(last) ? last : 'cylindrical');
    CV.app = { state, view3d, view2d, selectSystem, computeVis, onDragPoint, renderPanel };
    window.addEventListener('resize', () => fitMath($('tensor-body')));
  }

  window.addEventListener('error', e => { try { toast('Error: ' + e.message); } catch (err) { /* ignore */ } });
  window.addEventListener('unhandledrejection', e => { try { toast('Error: ' + (e.reason && e.reason.message || e.reason)); } catch (err) { /* ignore */ } });

  window.addEventListener('DOMContentLoaded', () => {
    try { init(); } catch (e) {
      console.error(e);
      document.body.innerHTML = '<pre style="color:#f87171;padding:20px">Failed to start: ' + (e.stack || e) + '</pre>';
    }
  });
})();
