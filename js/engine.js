/* CoordSystem: compiled coordinate map with numeric differential geometry
   (bases, metrics, Christoffel symbols), Newton inversion and lazy symbolic tensors. */
(function () {
  'use strict';
  const CV = (window.CV = window.CV || {});

  /* ------------------------------------------------------------ linear algebra */
  function det(M) {
    if (M.length === 2) return M[0][0] * M[1][1] - M[0][1] * M[1][0];
    return M[0][0] * (M[1][1] * M[2][2] - M[1][2] * M[2][1]) -
      M[0][1] * (M[1][0] * M[2][2] - M[1][2] * M[2][0]) +
      M[0][2] * (M[1][0] * M[2][1] - M[1][1] * M[2][0]);
  }
  function inv(M) {
    const d = det(M);
    if (M.length === 2) {
      return [[M[1][1] / d, -M[0][1] / d], [-M[1][0] / d, M[0][0] / d]];
    }
    const c = (r0, c0, r1, c1) => M[r0][c0] * M[r1][c1] - M[r0][c1] * M[r1][c0];
    return [
      [c(1, 1, 2, 2) / d, -c(0, 1, 2, 2) / d, c(0, 1, 1, 2) / d],
      [-c(1, 0, 2, 2) / d, c(0, 0, 2, 2) / d, -c(0, 0, 1, 2) / d],
      [c(1, 0, 2, 1) / d, -c(0, 0, 2, 1) / d, c(0, 0, 1, 1) / d]
    ];
  }
  const dot = (a, b) => a.reduce((s, v, i) => s + v * b[i], 0);
  CV.la = { det, inv, dot };

  /**
   * Number of segments needed to draw t -> f(t), t in [lo, hi], smoothly inside the visible
   * region (centre c, half-size R): enough that consecutive segments turn by at most ~4 degrees
   * and are at most R/60 long. Parts far outside the region are ignored.
   */
  CV.sampleCount = function (f, lo, hi, c, R, opts) {
    opts = opts || {};
    const P = opts.probe || 160;
    const maxAngle = opts.maxAngle || 0.07, maxLen = R / (opts.lenDiv || 12);
    const n = c.length;
    let turn = 0, len = 0, prev = null, has = false;
    let dx = 0, dy = 0, dz = 0, pdx = 0, pdy = 0, pdz = 0;
    for (let s = 0; s <= P; s++) {
      const x = f(lo + (hi - lo) * s / P);
      const z3 = n === 3 ? x[2] : 0, cz = n === 3 ? c[2] : 0;
      if (!(Math.abs(x[0] - c[0]) < 2 * R && Math.abs(x[1] - c[1]) < 2 * R && Math.abs(z3 - cz) < 2 * R)) { prev = null; has = false; continue; }
      if (prev) {
        dx = x[0] - prev[0]; dy = x[1] - prev[1]; dz = n === 3 ? x[2] - prev[2] : 0;
        const L = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (L > 1.5 * R) { prev = x; has = false; continue; }
        len += L;
        if (has && L > 0) {
          const Lp = Math.sqrt(pdx * pdx + pdy * pdy + pdz * pdz);
          const cs = (dx * pdx + dy * pdy + dz * pdz) / (L * Lp);
          if (cs === cs) turn += Math.acos(cs > 1 ? 1 : cs < -1 ? -1 : cs);
        }
        pdx = dx; pdy = dy; pdz = dz; has = true;
      }
      prev = x;
    }
    const need = Math.max(turn / maxAngle, len / maxLen);
    return Math.max(opts.min || 24, Math.min(opts.max || 1200, Math.ceil(need)));
  };


  // Deterministic PRNG for reproducible symbolic verification samples.
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  const INF_RE = /^\s*([+-]?)\s*(inf|infinity|∞)\s*$/i;
  /** Infinite bound marker (number) or null. */
  function infBound(b) {
    if (typeof b === 'number' && !Number.isFinite(b) && !Number.isNaN(b)) return b;
    if (b === null || b === undefined || b === '') return null;
    const m = INF_RE.exec(String(b));
    return m ? (m[1] === '-' ? -Infinity : Infinity) : null;
  }
  CV.infBound = infBound;

  class CoordSystem {
    constructor(def) {
      this.def = def;
      this.id = def.id;
      this.name = def.name;
      this.dim = def.dim;
      const n = (this.n = def.dim);
      if (n !== 2 && n !== 3) throw new Error('Dimension must be 2 or 3');
      if (!def.coords || def.coords.length !== n) throw new Error('Need exactly ' + n + ' coordinates');
      if (!def.map || def.map.length !== n) throw new Error('Need exactly ' + n + ' map expressions');

      this.coords = def.coords.map(c => Object.assign({}, c));
      this.params = (def.params || []).map(p => Object.assign({}, p));
      this.cnames = this.coords.map(c => c.n);
      this.pnames = this.params.map(p => p.n);
      this.names = this.cnames.concat(this.pnames);

      const seen = new Set();
      this.names.forEach(nm => {
        if (!CV.isValidName(nm)) throw new Error('Invalid or reserved name: "' + nm + '"');
        if (seen.has(nm)) throw new Error('Duplicate name: "' + nm + '"');
        seen.add(nm);
      });

      const axes = ['x', 'y', 'z'];
      this.X = def.map.map((s, a) => {
        let node;
        try { node = math.parse(String(s)); } catch (e) { throw new Error(axes[a] + ': ' + e.message); }
        CV.symbolsOf(node).forEach(sym => {
          if (!seen.has(sym)) throw new Error(axes[a] + ': unknown symbol "' + sym + '"');
        });
        return node;
      });
      this.dX = this.X.map(x => this.cnames.map(c => math.derivative(x, c, { simplify: false })));
      this.ddX = this.dX.map(row => row.map(d => this.cnames.map(c => math.derivative(d, c, { simplify: false }))));

      // Fast numeric evaluators.
      const vm = CV.jsVarMap(this.names);
      const decl = this.names.map((nm, k) => 'const _v' + k + '=V[' + k + '];').join('');
      const posCode = '[' + this.X.map(x => CV.toJS(x, vm)).join(',') + ']';
      const parts = [];
      for (let a = 0; a < n; a++) for (let i = 0; i < n; i++) parts.push(CV.toJS(this.dX[a][i], vm));
      for (let a = 0; a < n; a++) for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
        parts.push(j >= i ? CV.toJS(this.ddX[a][i][j], vm) : 'NaN');
      }
      /* eslint-disable no-new-func */
      this._pos = new Function('H', 'return function(V){' + decl + 'return ' + posCode + ';}')(CV.H);
      this._diff = new Function('H', 'return function(V){' + decl + 'return [' + parts.join(',') + '];}')(CV.H);
      /* eslint-enable no-new-func */

      // Bounds may depend on parameters.
      this._bounds = this.coords.map(c => [c.min, c.max].map((b, side) => {
        const inf = infBound(b);
        if (inf !== null) return () => inf;
        if (b === null || b === undefined || b === '') return () => (side ? Infinity : -Infinity);
        let node;
        try { node = math.parse(String(b)); } catch (e) { throw new Error('Range of ' + c.n + ': ' + e.message); }
        CV.symbolsOf(node).forEach(sym => {
          if (!this.pnames.includes(sym)) throw new Error('Range of ' + c.n + ': unknown symbol "' + sym + '"');
        });
        return CV.compileNode(node, this.pnames);
      }));

      this.pvals = this.params.map(p => Number(p.value));
      // optional parameter constraints such as 'b > a'
      this._constraints = (def.constraints || []).map(c => {
        const node = math.parse(String(c));
        return CV.compileNode(node, this.pnames);
      });
      this._V = new Array(this.names.length).fill(0);

      // Metric override (orthogonal hand-checked forms) - validated numerically.
      this.metricOverride = null;
      if (def.metric) {
        try {
          const nodes = def.metric.map(s => math.parse(String(s)));
          if (this._checkMetricOverride(nodes)) this.metricOverride = nodes;
          else console.warn('[' + this.id + '] metric override does not match computed metric; ignored');
        } catch (e) { console.warn('[' + this.id + '] bad metric override', e); }
      }
      this._sym = null;
    }

    setParam(k, v) { this.pvals[k] = v; }
    paramValues() { return this.pvals.slice(); }

    range(i) {
      const r = this._bounds[i].map(f => f(this.pvals));
      return r;
    }

    /** Finite interval inside the domain, used for sampling (verification, fallbacks). */
    sampleRange(i) {
      let [lo, hi] = this.range(i);
      const d = Number(this.coords[i].def);
      const c = Number.isFinite(d) ? d : (Number.isFinite(lo) ? lo + 1 : Number.isFinite(hi) ? hi - 1 : 0);
      if (!Number.isFinite(lo)) lo = Math.min(c, Number.isFinite(hi) ? hi : c) - 2.5;
      if (!Number.isFinite(hi)) hi = Math.max(c, lo) + 2.5;
      return [lo, hi];
    }

    isFiniteDomain(i) { const [lo, hi] = this.range(i); return Number.isFinite(lo) && Number.isFinite(hi); }

    /** Is the current parameter set usable (non-empty domains, finite map at u)? */
    constraintsOk() { return this._constraints.every(f => !!f(this.pvals)); }

    isValidAt(u) {
      if (!this.constraintsOk()) return false;
      for (let i = 0; i < this.n; i++) {
        const [lo, hi] = this.range(i);
        if (Number.isNaN(lo) || Number.isNaN(hi) || !(lo < hi)) return false;
      }
      const x = this.pos(u.map((v, i) => this.clampCoord(i, v)));
      return x.every(Number.isFinite);
    }

    /**
     * Coordinate intervals covering the visible box (center +- half per axis), found by
     * mapping a grid of box points back to coordinates. Finite domains are returned as is.
     */
    visibleRanges(center, half, seeds) {
      const n = this.n;
      const needs = [];
      for (let i = 0; i < n; i++) needs.push(i);
      const out = [];
      for (let i = 0; i < n; i++) out.push(this.range(i).slice());
      const G = n === 3 ? 7 : 15;
      const seedList = (seeds || []).concat([this.defaultPoint()]);
      const sols = [];
      // nested grids: the full box plus boxes shrunk 4x around the centre (down to ~unit scale),
      // so small but important regions (foci, rings) are found even when zoomed far out
      const levels = [];
      for (let f = 1; levels.length < 6; f /= 4) {
        levels.push(half.map(h => h * f));
        if (Math.max.apply(null, half) * f / 4 < 0.75) break;
      }
      for (const hl of levels) {
        const scale = Math.max.apply(null, hl);
        const idx = new Array(n).fill(0);
        const total = Math.pow(G, n);
        let prev = null;
        for (let k = 0; k < total; k++) {
          let r = k;
          for (let a = 0; a < n; a++) { idx[a] = r % G; r = Math.floor(r / G); }
          const p = [];
          for (let a = 0; a < n; a++) {
            let t = idx[a];
            if (a === 0 && n > 1 && idx[1] % 2) t = G - 1 - t; // serpentine: neighbours seed each other
            p.push(center[a] - hl[a] + 2 * hl[a] * t / (G - 1));
          }
          let best = null;
          const tries = prev ? [prev].concat(seedList) : seedList;
          for (const s0 of tries) {
            const res = this.invert(p, s0);
            if (!best || res.err < best.err) best = res;
            if (res.err < 1e-6 * Math.max(1, scale)) break;
          }
          if (best && best.err < 1e-4 * Math.max(1, scale) && best.u.every(Number.isFinite)) {
            prev = best.u;
            const d = Math.abs(det(this.jacobian(best.u)));
            if (Number.isFinite(d)) sols.push({ u: best.u, d });
          } else prev = null;
        }
      }
      // drop near-singular solutions (foci, origin of log coordinates ...) which give huge values
      const ds = sols.map(o => o.d).sort((x, y) => x - y);
      const med = ds.length ? ds[Math.floor(ds.length / 2)] : 0;
      const lo = needs.map(() => Infinity), hi = needs.map(() => -Infinity);
      sols.forEach(o => {
        if (o.d < 1e-5 * med) return;
        needs.forEach((i, k) => { lo[k] = Math.min(lo[k], o.u[i]); hi[k] = Math.max(hi[k], o.u[i]); });
      });
      (seeds || []).forEach(u => needs.forEach((i, k) => {
        if (Number.isFinite(u[i])) { lo[k] = Math.min(lo[k], u[i]); hi[k] = Math.max(hi[k], u[i]); }
      }));
      needs.forEach((i, k) => {
        const [dlo, dhi] = this.range(i);
        let a = lo[k], b = hi[k];
        if (this.isFiniteDomain(i)) {
          // bounded coordinates: keep the whole domain unless only a small part is visible
          if (!(a <= b) || (b - a) > 0.6 * (dhi - dlo)) { out[i] = [dlo, dhi]; return; }
        }
        if (!(a <= b)) { [a, b] = this.sampleRange(i); }
        const pad = Math.max((b - a) * 0.12, 1e-3 * Math.max(1, Math.abs(a), Math.abs(b)));
        a -= pad; b += pad;
        out[i] = [Math.max(dlo, a), Math.min(dhi, b)];
      });
      return out;
    }

    defaultPoint() {
      return this.coords.map((c, i) => {
        const [lo, hi] = this.range(i);
        const v = Number(c.def);
        return Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : (lo + hi) / 2;
      });
    }

    clampCoord(i, v) {
      const [lo, hi] = this.range(i);
      if (this.coords[i].periodic) {
        const w = hi - lo;
        return lo + ((((v - lo) % w) + w) % w);
      }
      return Math.min(hi, Math.max(lo, v));
    }

    _fill(u) {
      const V = this._V;
      for (let i = 0; i < this.n; i++) V[i] = u[i];
      for (let k = 0; k < this.pvals.length; k++) V[this.n + k] = this.pvals[k];
      return V;
    }

    pos(u) { return this._pos(this._fill(u)); }

    /** Jacobian J[a][i] = dx^a/du^i */
    jacobian(u) {
      const n = this.n;
      const d = this._diff(this._fill(u));
      const J = [];
      for (let a = 0; a < n; a++) { J.push([]); for (let i = 0; i < n; i++) J[a].push(d[a * n + i]); }
      return J;
    }

    /** Full local frame at coordinates u. */
    frame(u) {
      const n = this.n;
      const V = this._fill(u);
      const x = this._pos(V);
      const d = this._diff(V);
      const J = [];
      for (let a = 0; a < n; a++) { J.push([]); for (let i = 0; i < n; i++) J[a].push(d[a * n + i]); }
      const E = [];
      for (let i = 0; i < n; i++) E.push(J.map(row => row[i]));
      const g = E.map(Ei => E.map(Ej => dot(Ei, Ej)));
      const detJ = det(J);
      const Jinv = inv(J);
      const Econ = Jinv.map(row => row.slice()); // E^k = grad u^k = row k of J^{-1}
      const gi = Econ.map(Ei => Econ.map(Ej => dot(Ei, Ej)));
      // second derivatives d^2 x^a / du^i du^j
      const off = n * n;
      const dd = (a, i, j) => (j >= i ? d[off + a * n * n + i * n + j] : d[off + a * n * n + j * n + i]);
      const Gamma = [];
      for (let k = 0; k < n; k++) {
        Gamma.push([]);
        for (let i = 0; i < n; i++) {
          Gamma[k].push([]);
          for (let j = 0; j < n; j++) {
            let s = 0;
            for (let a = 0; a < n; a++) s += Econ[k][a] * dd(a, i, j);
            Gamma[k][i].push(s);
          }
        }
      }
      const finite = x.every(Number.isFinite) && J.every(r => r.every(Number.isFinite));
      const ok = finite && Math.abs(detJ) > 1e-10 && Econ.every(r => r.every(Number.isFinite));
      return { u: u.slice(), x, J, E, Econ, g, gi, detJ, Gamma, ok, finite };
    }

    isOrthogonalAt(u) {
      const f = this.frame(u);
      if (!f.ok) return null;
      let off = 0, diag = 0;
      for (let i = 0; i < this.n; i++) for (let j = 0; j < this.n; j++) {
        if (i === j) diag = Math.max(diag, Math.abs(f.g[i][i]));
        else off = Math.max(off, Math.abs(f.g[i][j]));
      }
      return off <= 1e-9 * Math.max(1, diag);
    }

    /**
     * Least-squares solve pos(u) ~ target starting at u0, varying only coordinates with
     * free[i] true (Levenberg-Marquardt). Returns {u, err}.
     */
    invert(target, u0, free) {
      const n = this.n;
      free = free || new Array(n).fill(true);
      const idx = [];
      for (let i = 0; i < n; i++) if (free[i]) idx.push(i);
      let u = u0.slice();
      const resid = uu => {
        const x = this.pos(uu);
        return x.map((v, a) => v - target[a]);
      };
      let r = resid(u);
      let err = Math.hypot.apply(null, r);
      if (!idx.length || !Number.isFinite(err)) return { u, err };
      let lam = 1e-3;
      for (let it = 0; it < 60 && err > 1e-11; it++) {
        const J = this.jacobian(u);
        const m = idx.length;
        // normal equations on free coordinates
        const A = [], g = [];
        for (let p = 0; p < m; p++) {
          A.push([]);
          let gp = 0;
          for (let a = 0; a < n; a++) gp += J[a][idx[p]] * r[a];
          g.push(gp);
          for (let q = 0; q < m; q++) {
            let s = 0;
            for (let a = 0; a < n; a++) s += J[a][idx[p]] * J[a][idx[q]];
            A[p].push(s);
          }
        }
        if (!A.every(row => row.every(Number.isFinite))) break;
        let accepted = false;
        for (let bt = 0; bt < 14; bt++) {
          const M = A.map((row, p) => row.map((v, q) => v + (p === q ? lam * (A[p][p] + 1e-12) : 0)));
          let du;
          if (m === 1) du = [-g[0] / M[0][0]];
          else {
            const Mi = inv(M);
            du = Mi.map(row => -dot(row, g));
          }
          const un = u.slice();
          idx.forEach((i, p) => { un[i] = this.clampCoord(i, u[i] + du[p]); });
          const rn = resid(un);
          const en = Math.hypot.apply(null, rn);
          if (Number.isFinite(en) && en < err) {
            u = un; r = rn;
            const rel = (err - en) / Math.max(err, 1e-300);
            err = en; lam = Math.max(lam / 4, 1e-9); accepted = true;
            if (rel < 1e-12) it = 1e9;
            break;
          }
          lam *= 6;
        }
        if (!accepted) break;
      }
      return { u, err };
    }

    /* ---------------------------------------------------------- verification */
    _samples(count, seed) {
      const rnd = mulberry32(seed || 12345);
      const out = [];
      for (let s = 0; s < count; s++) {
        const pv = this.pvals.map(v => (v === 0 ? 0.3 + rnd() : v * (0.85 + 0.3 * rnd())));
        const saved = this.pvals;
        this.pvals = pv;
        const coords = this.coords.map((c, i) => {
          const [lo, hi] = this.sampleRange(i);
          const w = hi - lo;
          return lo + w * (0.15 + 0.7 * rnd());
        });
        this.pvals = saved;
        out.push(coords.concat(pv));
      }
      return out;
    }

    _checkMetricOverride(nodes) {
      if (nodes.length !== this.n) return false;
      const fs = nodes.map(nd => CV.compileNode(nd, this.names));
      const samples = this._samples(6, 999);
      for (const V of samples) {
        const saved = this.pvals;
        this.pvals = V.slice(this.n);
        const f = this.frame(V.slice(0, this.n));
        this.pvals = saved;
        if (!f.ok) continue;
        for (let i = 0; i < this.n; i++) for (let j = 0; j < this.n; j++) {
          const expect = i === j ? fs[i](V) : 0;
          if (!(Math.abs(f.g[i][j] - expect) <= 1e-6 * Math.max(1, Math.abs(expect)))) return false;
        }
      }
      return true;
    }

    /* -------------------------------------------------------------- symbolic */
    /**
     * Lazily compute symbolic tensors. `parts` selects work: 'basic' (J, det J, g, g^-1)
     * or 'christoffel'. Returns a promise; progress reported via onProgress(fraction, label).
     */
    symbolic(part, onProgress) {
      if (!this._sym) this._sym = {};
      const S = this._sym;
      if (S[part]) return S[part];
      const job = part === 'basic' ? this._symBasic(onProgress)
        : part === 'dual' ? this._symDual(onProgress)
          : part === 'phys' ? this._symPhys(onProgress) : this._symChristoffel(onProgress);
      S[part] = job;
      return job;
    }

    async _symBasic(onProgress) {
      const n = this.n;
      const ctx = { names: this.names, samples: this._samples(7, 4242) };
      const simp = node => CV.simplifyVerified(node, ctx);
      const P = s => math.parse(s);
      const tick = () => new Promise(r => setTimeout(r, 0));
      const total = n * n + 1 + n * (n + 1) / 2 + n * (n + 1) / 2 + 1;
      let done = 0;
      const step = async label => { done++; if (onProgress) onProgress(done / total, label); await tick(); };

      const J = [];
      for (let a = 0; a < n; a++) {
        J.push([]);
        for (let i = 0; i < n; i++) { J[a].push(simp(this.dX[a][i])); await step('Jacobian'); }
      }
      const js = (a, i) => '(' + J[a][i].toString() + ')';
      const g = [...Array(n)].map(() => new Array(n));
      for (let i = 0; i < n; i++) for (let j = i; j < n; j++) {
        let node;
        if (this.metricOverride) node = i === j ? this.metricOverride[i] : CV.ZERO;
        else {
          const terms = [];
          for (let a = 0; a < n; a++) {
            if (CV.isZeroNode(J[a][i]) || CV.isZeroNode(J[a][j])) continue;
            terms.push(js(a, i) + '*' + js(a, j));
          }
          node = terms.length ? simp(P(terms.join('+'))) : CV.ZERO;
        }
        g[i][j] = g[j][i] = node;
        await step('metric');
      }

      const gs = (i, j) => (CV.isZeroNode(g[i][j]) ? null : '(' + g[i][j].toString() + ')');
      const mul = (...xs) => (xs.some(v => v === null) ? null : xs.join('*'));
      const sum = list => {
        const terms = list.filter(t => t && t.s !== null);
        if (!terms.length) return '0';
        return terms.map((t, k) => (t.neg ? '-' : (k ? '+' : '')) + t.s).join('');
      };
      let detG, gi = [...Array(n)].map(() => new Array(n));
      const diag = g.every((row, i) => row.every((v, j) => i === j || CV.isZeroNode(v)));
      if (diag) {
        detG = simp(P(g.map((r, i) => '(' + r[i].toString() + ')').join('*')));
        for (let i = 0; i < n; i++) for (let j = i; j < n; j++) {
          gi[i][j] = gi[j][i] = i === j ? simp(P('1/(' + g[i][i].toString() + ')')) : CV.ZERO;
          await step('inverse metric');
        }
      } else {
        let detS;
        if (n === 2) detS = sum([{ s: mul(gs(0, 0), gs(1, 1)) }, { s: mul(gs(0, 1), gs(1, 0)), neg: true }]);
        else {
          detS = sum([
            { s: mul(gs(0, 0), gs(1, 1), gs(2, 2)) }, { s: mul(gs(0, 1), gs(1, 2), gs(2, 0)) },
            { s: mul(gs(0, 2), gs(1, 0), gs(2, 1)) }, { s: mul(gs(0, 2), gs(1, 1), gs(2, 0)), neg: true },
            { s: mul(gs(0, 0), gs(1, 2), gs(2, 1)), neg: true }, { s: mul(gs(0, 1), gs(1, 0), gs(2, 2)), neg: true }]);
        }
        detG = simp(P(detS));
        const dg = '(' + detG.toString() + ')';
        for (let i = 0; i < n; i++) for (let j = i; j < n; j++) {
          let cof;
          if (n === 2) {
            cof = i === j ? sum([{ s: gs(1 - i, 1 - i) }]) : sum([{ s: gs(0, 1), neg: true }]);
          } else {
            // adjugate: inv[i][j] = cofactor(j,i)/det
            const r = [0, 1, 2].filter(k => k !== j), c = [0, 1, 2].filter(k => k !== i);
            const sgn = (i + j) % 2 ? -1 : 1;
            const pos = mul(gs(r[0], c[0]), gs(r[1], c[1]));
            const neg = mul(gs(r[0], c[1]), gs(r[1], c[0]));
            cof = sgn > 0 ? sum([{ s: pos }, { s: neg, neg: true }]) : sum([{ s: neg }, { s: pos, neg: true }]);
          }
          gi[i][j] = gi[j][i] = cof === '0' ? CV.ZERO : simp(P('(' + cof + ')/' + dg));
          await step('inverse metric');
        }
      }
      let detStr;
      if (n === 2) detStr = js(0, 0) + '*' + js(1, 1) + '-' + js(0, 1) + '*' + js(1, 0);
      else {
        detStr = js(0, 0) + '*(' + js(1, 1) + '*' + js(2, 2) + '-' + js(1, 2) + '*' + js(2, 1) + ')-' +
          js(0, 1) + '*(' + js(1, 0) + '*' + js(2, 2) + '-' + js(1, 2) + '*' + js(2, 0) + ')+' +
          js(0, 2) + '*(' + js(1, 0) + '*' + js(2, 1) + '-' + js(1, 1) + '*' + js(2, 0) + ')';
      }
      const sqrtG = simp(P('sqrt(' + detG.toString() + ')'));
      const detJ = CV.simplifyVerified(P(detStr), Object.assign({}, ctx, {
        extra: [sqrtG, P('-(' + sqrtG.toString() + ')')]
      }));
      await step('det J');

      await step('done');
      return { J, detJ, sqrtG, g, gi, detG, orthogonal: diag };
    }

    /** Contravariant basis E^k (Cartesian components) = g^{kl} E_l = row k of J^{-1}. */
    async _symDual(onProgress) {
      const n = this.n;
      const basic = await this.symbolic('basic');
      const ctx = { names: this.names, samples: this._samples(7, 555) };
      const tick = () => new Promise(r => setTimeout(r, 0));
      const { J, gi } = basic;
      const out = [];
      let done = 0;
      for (let k = 0; k < n; k++) {
        out.push([]);
        for (let a = 0; a < n; a++) {
          const terms = [];
          for (let l = 0; l < n; l++) {
            if (CV.isZeroNode(gi[k][l]) || CV.isZeroNode(J[a][l])) continue;
            terms.push('(' + gi[k][l].toString() + ')*(' + J[a][l].toString() + ')');
          }
          out[k].push(terms.length ? CV.simplifyVerified(math.parse(terms.join('+')), ctx) : CV.ZERO);
          done++;
          if (onProgress) onProgress(done / (n * n), 'contravariant basis');
          await tick();
        }
      }
      return { Econ: out };
    }

    /** Physical (unit) basis: scale factors h_i = sqrt(g_ii) and e_(i) = E_i / h_i. */
    async _symPhys(onProgress) {
      const n = this.n;
      const basic = await this.symbolic('basic');
      const ctx = { names: this.names, samples: this._samples(7, 919) };
      const tick = () => new Promise(r => setTimeout(r, 0));
      const { J, g } = basic;
      const h = [], e = [];
      let done = 0;
      for (let i = 0; i < n; i++) {
        h.push(CV.simplifyVerified(math.parse('sqrt(' + g[i][i].toString() + ')'), ctx));
        e.push([]);
        for (let a = 0; a < n; a++) {
          e[i].push(CV.isZeroNode(J[a][i]) ? CV.ZERO
            : CV.simplifyVerified(math.parse('(' + J[a][i].toString() + ')/(' + h[i].toString() + ')'), ctx));
          done++;
          if (onProgress) onProgress(done / (n * n), 'physical basis');
          await tick();
        }
      }
      return { h, e };
    }

    async _symChristoffel(onProgress) {
      const n = this.n;
      const basic = await this.symbolic('basic');
      const ctx = { names: this.names, samples: this._samples(7, 777), maxLen: 1400 };
      const simp = node => CV.simplifyVerified(node, ctx);
      const tick = () => new Promise(r => setTimeout(r, 0));
      const { g, gi } = basic;
      // derivatives of the metric
      const dg = g.map(row => row.map(e => this.cnames.map(c =>
        CV.isZeroNode(e) ? CV.ZERO : math.derivative(e, c, { simplify: false }))));
      const str = nd => '(' + nd.toString() + ')';
      // first kind: G1[l][i][j] = 1/2 (d_i g_jl + d_j g_il - d_l g_ij)
      const G1 = [];
      for (let l = 0; l < n; l++) {
        G1.push([]);
        for (let i = 0; i < n; i++) {
          G1[l].push([]);
          for (let j = 0; j < n; j++) {
            const t = [];
            if (!CV.isZeroNode(dg[j][l][i])) t.push('+' + str(dg[j][l][i]));
            if (!CV.isZeroNode(dg[i][l][j])) t.push('+' + str(dg[i][l][j]));
            if (!CV.isZeroNode(dg[i][j][l])) t.push('-' + str(dg[i][j][l]));
            G1[l][i].push(t.length ? '(' + t.join('') + ')/2' : null);
          }
        }
      }
      const total = n * n * (n + 1) / 2;
      let done = 0;
      const G = [...Array(n)].map(() => [...Array(n)].map(() => new Array(n)));
      for (let k = 0; k < n; k++) {
        for (let i = 0; i < n; i++) {
          for (let j = i; j < n; j++) {
            const terms = [];
            for (let l = 0; l < n; l++) {
              if (CV.isZeroNode(gi[k][l]) || G1[l][i][j] === null) continue;
              terms.push(str(gi[k][l]) + '*' + G1[l][i][j]);
            }
            let node = CV.ZERO;
            if (terms.length) {
              try { node = simp(math.parse(terms.join('+'))); } catch (e) { node = math.parse(terms.join('+')); }
            }
            G[k][i][j] = G[k][j][i] = node;
            done++;
            if (onProgress) onProgress(done / total, 'Christoffel symbols');
            await tick();
          }
        }
      }
      return { Gamma: G };
    }
  }

  CV.CoordSystem = CoordSystem;
})();
