/* 2D view (canvas): coordinate curves, grid, local bases and vector decomposition. */
(function () {
  'use strict';
  const CV = (window.CV = window.CV || {});

  const GREEK_UNI = {
    alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', epsilon: 'ε', zeta: 'ζ', eta: 'η', theta: 'θ', iota: 'ι',
    kappa: 'κ', lambda: 'λ', mu: 'μ', nu: 'ν', xi: 'ξ', pi: 'π', rho: 'ρ', sigma: 'σ', tau: 'τ', upsilon: 'υ',
    phi: 'φ', chi: 'χ', psi: 'ψ', omega: 'ω', varphi: 'ϕ', vartheta: 'ϑ'
  };
  CV.uniName = n => GREEK_UNI[n] || n.replace(/_?(\d+)$/, (m, d) => d.split('').map(c => '₀₁₂₃₄₅₆₇₈₉'[+c]).join(''));

  const niceStep = span => CV.niceStep(span, 8);

  class View2D {
    constructor(canvas, cb) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.cb = cb;
      this.k = 100; this.cx = 0; this.cy = 0; // screen = (cx + x*k, cy - y*k)
      this.R = 3.5;
      this.active = false;
      this._pending = false;
      this._bind();
      this._ro = new ResizeObserver(() => { this.resize(); this.request(); });
      this._ro.observe(canvas.parentElement);
    }

    resize() {
      const host = this.canvas.parentElement;
      const w = host.clientWidth, h = host.clientHeight;
      if (!w || !h) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const oldW = this.w, oldH = this.h;
      this.w = w; this.h = h; this.dpr = dpr;
      this.canvas.width = Math.round(w * dpr);
      this.canvas.height = Math.round(h * dpr);
      this.canvas.style.width = w + 'px';
      this.canvas.style.height = h + 'px';
      if (oldW && oldH) { this.cx += (w - oldW) / 2; this.cy += (h - oldH) / 2; }
    }

    setActive(on) {
      this.active = on;
      this.canvas.style.display = on ? '' : 'none';
      if (on) { this.resize(); this.request(); }
    }

    setExtent(R) { this.R = R; }

    resetView() {
      this.resize();
      const w = this.w || 800, h = this.h || 600;
      this.k = Math.min(w, h) / (2.25 * this.R);
      this.cx = w / 2; this.cy = h / 2;
      this.request();
    }

    setSystem(sys, state) {
      this.sys = sys;
      this.setExtent(state.viewR);
      this.resetView();
    }

    /** Visible rectangle (centre, half sizes) in world units. */
    box() {
      const c = this.toWorld(this.w / 2, this.h / 2);
      return { center: c, half: [this.w / 2 / this.k, this.h / 2 / this.k] };
    }

    /** Zoom out (about the view centre) until the given points are visible. */
    ensureVisible(points) {
      const b = this.box();
      let f = 1;
      points.forEach(p => {
        if (!p || !p.every(Number.isFinite)) return;
        for (let a = 0; a < 2; a++) f = Math.max(f, Math.abs(p[a] - b.center[a]) / (b.half[a] * 0.92));
      });
      if (f > 1) {
        const c = b.center;
        this.k /= f * 1.1;
        this.cx = this.w / 2 - c[0] * this.k; this.cy = this.h / 2 + c[1] * this.k;
        this.request();
        this.cb.onZoom();
      }
    }

    centerOn(p) {
      this.cx = this.w / 2 - p[0] * this.k; this.cy = this.h / 2 + p[1] * this.k;
      this.request();
    }

    toScreen(x, y) { return [this.cx + x * this.k, this.cy - y * this.k]; }
    toWorld(sx, sy) { return [(sx - this.cx) / this.k, (this.cy - sy) / this.k]; }

    request() {
      if (!this.active || this._pending) return;
      this._pending = true;
      requestAnimationFrame(() => { this._pending = false; this.draw(); });
    }

    /* -------------------------------------------------------------- draw */
    draw() {
      const st = this.cb.getState();
      const sys = this.sys;
      if (!sys || sys.n !== 2) return;
      const c = this.ctx, dpr = this.dpr;
      // static background (Cartesian grid + coordinate grid) is cached: it does not change
      // while P is dragged, only when the view, parameters or display options change
      const key = [this.k, this.cx, this.cy, this.w, this.h, dpr, sys.id, sys.pvals.join(','),
        JSON.stringify(st.vis), st.gridOpacity, st.showGrid, st.showAxes].join('|');
      if (key !== this._bgKey) {
        this._bgKey = key;
        if (!this._bg) this._bg = document.createElement('canvas');
        this._bg.width = this.canvas.width; this._bg.height = this.canvas.height;
        const main = this.ctx;
        this.ctx = this._bg.getContext('2d');
        this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        this.ctx.clearRect(0, 0, this.w, this.h);
        this._drawCartGrid(st);
        if (st.showGrid) {
          for (let i = 0; i < 2; i++) {
            const [lo, hi] = st.vis[i];
            const per = sys.coords[i].periodic;
            const step = per ? (hi - lo) / 24 : CV.niceStep(hi - lo, 14);
            const start = per ? lo : Math.ceil(lo / step) * step;
            let count = 0;
            for (let v = start; v <= hi + 1e-9 * step && count < 80; v += step, count++) {
              if (per && v >= hi - 1e-9 * step) break;
              this._drawConstCurve(i, v, st, CV.COLORS[i], 1, 0.16);
            }
          }
        }
        this.ctx = main;
      }
      c.setTransform(1, 0, 0, 1, 0, 0);
      c.clearRect(0, 0, this.canvas.width, this.canvas.height);
      c.drawImage(this._bg, 0, 0);
      c.setTransform(dpr, 0, 0, dpr, 0, 0);
      const f = sys.frame(st.point);
      this.lastFrame = f;

      // coordinate curves through P (where they don't coincide with an active constant curve)
      if (st.showCurves) {
        for (let i = 0; i < 2; i++) {
          const coincide = st.surfOn[i] && Math.abs(st.consts[i] - st.point[i]) < 1e-9;
          if (!coincide) this._drawConstCurve(i, st.point[i], st, CV.COLORS[1 - i], 1.6, 0.85, [2, 4]);
        }
      }
      for (let i = 0; i < 2; i++) {
        if (st.surfOn[i]) this._drawConstCurve(i, st.consts[i], st, CV.COLORS[i], 2.6, 1, null, true);
      }

      const P = f.x;
      if (!P.every(Number.isFinite)) return;
      const [px, py] = this.toScreen(P[0], P[1]);
      const sc = st.vecScale;
      const vscreen = (vec, unit) => {
        let L = Math.hypot(vec[0], vec[1]);
        if (!Number.isFinite(L) || L < 1e-12) return null;
        let m = unit ? sc / L : sc;
        const cap = 400 * Math.max(this.w, this.h) / this.k;
        if (L * m > cap) m = cap / L;
        return [vec[0] * m, vec[1] * m];
      };

      // vector decomposition (under the bases)
      if (st.V.on && f.ok) this._drawVector(st, f, P);

      for (let i = 0; i < 2; i++) {
        if (st.showPhys) {
          const v = vscreen(f.E[i], true);
          if (v) this._arrow(P, [P[0] + v[0], P[1] + v[1]], CV.COLORS_PHY[i], 2, [1.5, 4], st.labels ? ['ê', '(' + sys.cnames[i] + ')', false, 0] : null);
        }
        if (st.showCon) {
          const v = vscreen(f.Econ[i], false);
          if (v) this._arrow(P, [P[0] + v[0], P[1] + v[1]], CV.COLORS_CON[i], 2.4, [7, 5], st.labels ? ['E', sys.cnames[i], true] : null);
        }
        if (st.showCov) {
          const v = vscreen(f.E[i], false);
          if (v) this._arrow(P, [P[0] + v[0], P[1] + v[1]], CV.COLORS[i], 3, null, st.labels ? ['E', sys.cnames[i], false] : null);
        }
      }

      // point
      c.beginPath(); c.arc(px, py, 11, 0, Math.PI * 2); c.fillStyle = 'rgba(255,255,255,0.12)'; c.fill();
      c.beginPath(); c.arc(px, py, 5.5, 0, Math.PI * 2); c.fillStyle = '#fff'; c.fill();
      c.lineWidth = 2; c.strokeStyle = '#0b0e14'; c.stroke();
      if (st.labels) {
        c.font = 'italic 600 15px "STIX Two Math", "Cambria Math", "Latin Modern Math", "Times New Roman", serif';
        c.fillStyle = '#fff';
        c.shadowColor = '#000'; c.shadowBlur = 4;
        c.fillText('P', px - 18, py + 18);
        c.shadowBlur = 0;
      }
    }

    _drawCartGrid(st) {
      const c = this.ctx;
      const [x0, y1] = this.toWorld(0, 0), [x1, y0] = this.toWorld(this.w, this.h);
      const step = niceStep(Math.max(x1 - x0, y1 - y0));
      c.lineWidth = 1;
      const minor = step / 5;
      if (minor * this.k > 9) {
        c.strokeStyle = 'rgba(143,155,189,' + (0.16 * st.gridOpacity).toFixed(3) + ')';
        c.beginPath();
        for (let x = Math.ceil(x0 / minor) * minor; x <= x1; x += minor) { const s = this.toScreen(x, 0)[0]; c.moveTo(s, 0); c.lineTo(s, this.h); }
        for (let y = Math.ceil(y0 / minor) * minor; y <= y1; y += minor) { const s = this.toScreen(0, y)[1]; c.moveTo(0, s); c.lineTo(this.w, s); }
        c.stroke();
      }
      c.strokeStyle = 'rgba(143,155,189,' + (0.4 * st.gridOpacity).toFixed(3) + ')';
      c.beginPath();
      for (let x = Math.ceil(x0 / step) * step; x <= x1; x += step) { const s = this.toScreen(x, 0)[0]; c.moveTo(s, 0); c.lineTo(s, this.h); }
      for (let y = Math.ceil(y0 / step) * step; y <= y1; y += step) { const s = this.toScreen(0, y)[1]; c.moveTo(0, s); c.lineTo(this.w, s); }
      c.stroke();
      if (!st.showAxes) return;
      const [ox, oy] = this.toScreen(0, 0);
      c.strokeStyle = 'rgba(150,162,190,0.45)'; c.lineWidth = 1.2;
      c.beginPath(); c.moveTo(0, oy); c.lineTo(this.w, oy); c.moveTo(ox, 0); c.lineTo(ox, this.h); c.stroke();
      c.fillStyle = 'rgba(150,162,190,0.6)';
      c.font = '11px ' + getComputedStyle(document.body).fontFamily;

      const ly = Math.min(Math.max(oy + 14, 14), this.h - 6);
      const lx = Math.min(Math.max(ox + 5, 5), this.w - 30);
      for (let x = Math.ceil(x0 / step) * step; x <= x1; x += step) {
        if (Math.abs(x) < step / 2) continue;
        c.fillText(CV.fmtTick(x, step), this.toScreen(x, 0)[0] + 3, ly);
      }
      for (let y = Math.ceil(y0 / step) * step; y <= y1; y += step) {
        if (Math.abs(y) < step / 2) continue;
        c.fillText(CV.fmtTick(y, step), lx, this.toScreen(0, y)[1] - 3);
      }
      c.font = 'italic 14px "STIX Two Math", "Cambria Math", serif';
      c.fillStyle = 'rgba(170,180,205,0.8)';
      c.fillText('x', this.w - 16, oy - 8);
      c.fillText('y', ox + 8, 16);
    }

    /** Curve u_i = v, parametrized by the other coordinate. */
    _drawConstCurve(i, v, st, color, width, alpha, dash, glow) {
      const sys = this.sys, c = this.ctx;
      const j = 1 - i;
      const [lo, hi] = st.vis[j];
      const bx = this.box();
      const M = CV.sampleCount(t => { const uu = [0, 0]; uu[i] = v; uu[j] = t; return sys.pos(uu); }, lo, hi, bx.center,
        Math.max(bx.half[0], bx.half[1]), { min: 100, max: width < 1.5 ? 3000 : 8000, lenDiv: 60, maxAngle: 0.04 });
      const u = [0, 0];
      u[i] = v;
      const maxJump = Math.max(this.w, this.h) * 0.6;
      c.save();
      c.globalAlpha = alpha;
      c.strokeStyle = color;
      c.lineWidth = width;
      c.lineJoin = 'round'; c.lineCap = 'round';
      if (dash) c.setLineDash(dash);

      c.beginPath();
      let pen = false, last = null;
      for (let s = 0; s <= M; s++) {
        u[j] = lo + (hi - lo) * s / M;
        const x = sys.pos(u);
        if (!Number.isFinite(x[0]) || !Number.isFinite(x[1])) { pen = false; continue; }
        const p = this.toScreen(x[0], x[1]);
        if (Math.abs(p[0]) > 1e5 || Math.abs(p[1]) > 1e5) { pen = false; continue; }
        if (pen && last && Math.hypot(p[0] - last[0], p[1] - last[1]) > maxJump) pen = false;
        if (pen) c.lineTo(p[0], p[1]); else c.moveTo(p[0], p[1]);
        pen = true; last = p;
      }
      if (glow) {
        // cheap glow: wide translucent strokes under the line (shadowBlur is very slow)
        const lw = c.lineWidth, ga = c.globalAlpha;
        c.lineWidth = lw * 4; c.globalAlpha = ga * 0.12; c.stroke();
        c.lineWidth = lw * 2.2; c.globalAlpha = ga * 0.25; c.stroke();
        c.lineWidth = lw; c.globalAlpha = ga;
      }
      c.stroke();
      c.restore();
    }

    _arrow(from, to, color, width, dash, label, alpha) {
      const c = this.ctx;
      const [x0, y0] = this.toScreen(from[0], from[1]);
      const [x1, y1] = this.toScreen(to[0], to[1]);
      const L = Math.hypot(x1 - x0, y1 - y0);
      if (L < 1) return;
      const ux = (x1 - x0) / L, uy = (y1 - y0) / L;
      const hl = Math.min(13 + width, L * 0.45), hw = (5 + width) * 0.9;
      c.save();
      c.globalAlpha = alpha === undefined ? 1 : alpha;
      c.strokeStyle = color; c.fillStyle = color;
      c.lineWidth = width; c.lineCap = 'round';
      // dark outline for contrast (cheaper than shadowBlur)
      c.beginPath(); c.moveTo(x0, y0); c.lineTo(x1 - ux * hl * 0.8, y1 - uy * hl * 0.8);
      c.save(); c.strokeStyle = 'rgba(5,7,12,0.55)'; c.lineWidth = width + 2.5; if (dash) c.setLineDash(dash); c.stroke(); c.restore();
      if (dash) c.setLineDash(dash);
      c.stroke();
      c.setLineDash([]);
      c.beginPath();
      c.moveTo(x1, y1);
      c.lineTo(x1 - ux * hl - uy * hw, y1 - uy * hl + ux * hw);
      c.lineTo(x1 - ux * hl * 0.72, y1 - uy * hl * 0.72);
      c.lineTo(x1 - ux * hl + uy * hw, y1 - uy * hl - ux * hw);
      c.closePath();
      if (dash) { c.lineWidth = 1.6; c.fillStyle = '#0b0e14'; c.fill(); c.stroke(); } else c.fill();
      c.restore();
      if (label) {
        const side = label[3] !== undefined ? label[3] : label[2] ? -1 : 1;
        this._indexLabel(x1 + ux * 14 - uy * 12 * side, y1 + uy * 14 + ux * 12 * side, label[0], label[1], label[2], color);
      }
    }

    _indexLabel(x, y, base, idx, up, color) {
      const c = this.ctx;
      const serif = '"STIX Two Math", "Cambria Math", "Latin Modern Math", "Times New Roman", serif';
      c.save();
      c.fillStyle = color;
      c.shadowColor = '#000'; c.shadowBlur = 5;
      c.font = 'bold 17px ' + serif;
      c.textBaseline = 'middle';
      const bw = c.measureText(base).width;
      const idxS = idx.charAt(0) === '(' ? '(' + CV.uniName(idx.slice(1, -1)) + ')' : CV.uniName(idx);
      c.font = 'italic 13px ' + serif;
      const iw = c.measureText(idxS).width;
      const x0 = x - (bw + iw) / 2;
      c.font = 'bold 17px ' + serif;
      c.fillText(base, x0, y);
      c.font = 'italic 13px ' + serif;
      c.fillText(idxS, x0 + bw + 1, y + (up ? -7 : 6));
      c.restore();
    }

    _drawVector(st, f, P) {
      const sc = st.vecScale;
      const V = [st.V.cart[0], st.V.cart[1]];
      const tip = [P[0] + V[0] * sc, P[1] + V[1] * sc];
      const Vup = f.Econ.map(E => E[0] * V[0] + E[1] * V[1]);
      const Vdn = f.E.map(E => E[0] * V[0] + E[1] * V[1]);
      const decomp = (comps, basis, dashed, colors) => {
        const a = basis.map((b, i) => [b[0] * comps[i] * sc, b[1] * comps[i] * sc]);
        const p1 = [P[0] + a[0][0], P[1] + a[0][1]];
        const p2 = [P[0] + a[1][0], P[1] + a[1][1]];
        // parallelogram completion
        const c = this.ctx;
        c.save();
        c.strokeStyle = 'rgba(251,191,36,0.35)'; c.setLineDash([3, 5]); c.lineWidth = 1.2;
        c.beginPath();
        const s1 = this.toScreen(p1[0], p1[1]), s2 = this.toScreen(p2[0], p2[1]), st2 = this.toScreen(tip[0], tip[1]);
        c.moveTo(s1[0], s1[1]); c.lineTo(st2[0], st2[1]); c.lineTo(s2[0], s2[1]);
        c.stroke(); c.restore();
        this._arrow(P, p1, colors[0], 2, dashed ? [6, 4] : null, null, 0.95);
        this._arrow(P, p2, colors[1], 2, dashed ? [6, 4] : null, null, 0.95);
      };
      if (st.V.phys) {
        const hat = f.E.map(E => { const L = Math.hypot(E[0], E[1]); return [E[0] / L, E[1] / L]; });
        decomp(Vup.map((v, i) => v * Math.sqrt(f.g[i][i])), hat, false, CV.COLORS_PHY);
      }
      if (st.V.con) decomp(Vup, f.E, false, CV.COLORS);
      if (st.V.co) decomp(Vdn, f.Econ, true, CV.COLORS_CON);
      this._arrow(P, tip, CV.VEC_COLOR, 3.4, null, null);
      if (st.labels) {
        const [x1, y1] = this.toScreen(tip[0], tip[1]);
        const c = this.ctx;
        c.save();
        c.font = 'bold 17px "STIX Two Math", "Cambria Math", serif';
        c.fillStyle = CV.VEC_COLOR; c.shadowColor = '#000'; c.shadowBlur = 5;
        c.fillText('V', x1 + 8, y1 - 8);
        c.restore();
      }
      this.vTip = tip;
    }

    /* ------------------------------------------------------- interaction */
    _bind() {
      const cv = this.canvas;
      let mode = null, last = null;
      const pos = ev => { const r = cv.getBoundingClientRect(); return [ev.clientX - r.left, ev.clientY - r.top]; };
      const nearP = p => {
        const f = this.lastFrame;
        if (!f || !f.x.every(Number.isFinite)) return false;
        const s = this.toScreen(f.x[0], f.x[1]);
        return Math.hypot(s[0] - p[0], s[1] - p[1]) < 14;
      };
      const nearV = p => {
        const st = this.cb.getState();
        if (!st.V.on || !this.vTip) return false;
        const s = this.toScreen(this.vTip[0], this.vTip[1]);
        return Math.hypot(s[0] - p[0], s[1] - p[1]) < 14;
      };
      cv.addEventListener('pointerdown', ev => {
        if (ev.button !== 0 && ev.button !== 1) return;
        const p = pos(ev);
        mode = ev.button === 0 && nearP(p) ? 'point' : ev.button === 0 && nearV(p) ? 'vec' : 'pan';
        last = p;
        cv.setPointerCapture(ev.pointerId);
        cv.style.cursor = mode === 'pan' ? 'grabbing' : 'grabbing';
        ev.preventDefault();
      });
      cv.addEventListener('pointermove', ev => {
        const p = pos(ev);
        if (!mode) { cv.style.cursor = nearP(p) || nearV(p) ? 'grab' : 'default'; return; }
        if (mode === 'pan') {
          this.cx += p[0] - last[0]; this.cy += p[1] - last[1];
          last = p; this.request();
          this.cb.onPan();
        } else if (mode === 'point') {
          this._movePointTo(this.toWorld(p[0], p[1]));
        } else if (mode === 'vec') {
          const st = this.cb.getState();
          const f = this.lastFrame;
          const w = this.toWorld(p[0], p[1]);
          this.cb.onDragVector([(w[0] - f.x[0]) / st.vecScale, (w[1] - f.x[1]) / st.vecScale]);
        }
      });
      const end = ev => {
        if (!mode) return;
        const was = mode;
        mode = null; cv.style.cursor = 'default';
        try { cv.releasePointerCapture(ev.pointerId); } catch (e) { /* */ }
        if (was === 'point') this.cb.onDragEnd();
      };
      cv.addEventListener('pointerup', end);
      cv.addEventListener('pointercancel', end);
      cv.addEventListener('wheel', ev => {
        ev.preventDefault();
        const p = pos(ev);
        const w = this.toWorld(p[0], p[1]);
        const z = Math.exp(-ev.deltaY * (ev.deltaMode === 1 ? 0.05 : 0.0015));
        this.k = Math.min(1e7, Math.max(1e-5, this.k * z));
        this.cx = p[0] - w[0] * this.k; this.cy = p[1] + w[1] * this.k;
        this.request();
        this.cb.onZoom();
      }, { passive: false });
      cv.addEventListener('dblclick', ev => {
        const p = pos(ev);
        this._movePointTo(this.toWorld(p[0], p[1]));
      });
    }

    _movePointTo(target) {
      const st = this.cb.getState();
      const held = [0, 1].map(i => st.snap && st.surfOn[i]);
      const free = held.every(Boolean) ? [true, true] : held.map(h => !h);
      let best = this.sys.invert(target, st.point, free);
      if (best.err > 1e-6 && free.every(Boolean)) {
        // try a few restarts across the domain for multi-valued / far targets
        for (let t = 0; t < 12 && best.err > 1e-6; t++) {
          const u0 = [0, 1].map(i => { const [a, b] = st.vis[i]; return a + (b - a) * ((t * 0.37 + i * 0.61) % 1); });
          const r = this.sys.invert(target, u0, free);
          if (r.err < best.err) best = r;
        }
      }
      this.cb.onDragPoint(best.u);
    }
  }

  CV.View2D = View2D;
})();
