/* 3D view: coordinate surfaces, local bases, coordinate curves and vector decomposition.
   The visible region is a cube (centre = orbit target, half-size R). Scrolling changes R
   (map-like zoom): the cube always fills the view, and axes, ticks, grid, surfaces and glyphs
   are rebuilt for the new scale. */
(function () {
  'use strict';
  const CV = (window.CV = window.CV || {});
  const V3 = (x, y, z) => new THREE.Vector3(x, y, z);

  CV.COLORS = ['#ff6b8a', '#4ade80', '#60a5fa'];
  CV.COLORS_CON = ['#ffb3c3', '#a7f3c4', '#b4d5ff'];
  CV.COLORS_PHY = ['#ffd9b0', '#e6f7a8', '#c9c2ff'];
  CV.VEC_COLOR = '#fbbf24';

  const UNIT_CYL = new THREE.CylinderGeometry(1, 1, 1, 14, 1, false).translate(0, 0.5, 0);
  const UNIT_CONE = new THREE.ConeGeometry(1, 1, 22, 1, false).translate(0, 0.5, 0);
  const YAXIS = V3(0, 1, 0);

  CV.niceStep = function (span, target) {
    const raw = span / (target || 8);
    const p = Math.pow(10, Math.floor(Math.log10(raw)));
    const m = raw / p;
    return (m < 1.5 ? 1 : m < 3.5 ? 2 : m < 7.5 ? 5 : 10) * p;
  };
  CV.fmtTick = function (v, step) {
    if (Math.abs(v) < step * 1e-6) return '0';
    if (Math.abs(v) >= 1e5 || step < 1e-4) return v.toExponential(1);
    const dec = Math.max(0, -Math.floor(Math.log10(step) + 1e-9));
    return v.toFixed(dec);
  };

  /** Fast tube along a polyline (parallel-transport frames, O(n)). */
  function tubeGeometry(pts, radius, radial) {
    const n = pts.length;
    const pos = new Float32Array(n * radial * 3), nor = new Float32Array(n * radial * 3);
    const T = V3(), Nv = V3(), B = V3(), tmp = V3();
    for (let i = 0; i < n; i++) {
      const a = pts[Math.max(0, i - 1)], b = pts[Math.min(n - 1, i + 1)];
      T.subVectors(b, a);
      if (T.lengthSq() < 1e-30) T.set(1, 0, 0);
      T.normalize();
      if (i === 0) {
        tmp.set(Math.abs(T.x) < 0.9 ? 1 : 0, Math.abs(T.x) < 0.9 ? 0 : 1, 0);
        Nv.crossVectors(T, tmp).normalize();
      } else {
        Nv.addScaledVector(T, -Nv.dot(T));
        if (Nv.lengthSq() < 1e-12) { tmp.set(0, 0, 1); Nv.crossVectors(T, tmp); if (Nv.lengthSq() < 1e-12) Nv.set(1, 0, 0); }
        Nv.normalize();
      }
      B.crossVectors(T, Nv);
      for (let k = 0; k < radial; k++) {
        const ang = 2 * Math.PI * k / radial, c = Math.cos(ang), sn = Math.sin(ang);
        const nx = c * Nv.x + sn * B.x, ny = c * Nv.y + sn * B.y, nz = c * Nv.z + sn * B.z;
        const o = (i * radial + k) * 3;
        nor[o] = nx; nor[o + 1] = ny; nor[o + 2] = nz;
        pos[o] = pts[i].x + radius * nx; pos[o + 1] = pts[i].y + radius * ny; pos[o + 2] = pts[i].z + radius * nz;
      }
    }
    const idx = [];
    for (let i = 0; i + 1 < n; i++) for (let k = 0; k < radial; k++) {
      const a = i * radial + k, b = i * radial + (k + 1) % radial, c = a + radial, d = b + radial;
      idx.push(a, c, b, b, c, d);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    g.setIndex(idx);
    return g;
  }

  /* --------------------------------------------------------------- arrows */
  class Arrow3 {
    constructor(color, dashed, opts) {
      opts = opts || {};
      this.dashed = dashed;
      this.group = new THREE.Group();
      this.mat = new THREE.MeshPhongMaterial({ color, emissive: new THREE.Color(color).multiplyScalar(0.28), shininess: 60 });
      this.head = new THREE.Mesh(UNIT_CONE, this.mat);
      this.group.add(this.head);
      this.thin = opts.thin || 1;
      if (dashed) {
        this.dashes = [];
        for (let k = 0; k < 40; k++) {
          const m = new THREE.Mesh(UNIT_CYL, this.mat);
          this.dashes.push(m);
          this.group.add(m);
        }
      } else {
        this.shaft = new THREE.Mesh(UNIT_CYL, this.mat);
        this.group.add(this.shaft);
      }
      this.tip = V3(0, 0, 0);
    }
    set(origin, vec, size) {
      const len = vec.length();
      if (!Number.isFinite(len) || len < 1e-12) { this.hide(); return; }
      this.group.visible = true;
      this.group.position.copy(origin);
      this.group.quaternion.setFromUnitVectors(YAXIS, vec.clone().normalize());
      const headLen = Math.min(len * 0.38, size * 2.4);
      const headR = size * 0.85 * Math.sqrt(this.thin);
      const shaftR = size * 0.3 * this.thin;
      const sl = len - headLen;
      this.head.scale.set(headR, headLen, headR);
      this.head.position.set(0, sl, 0);
      if (this.dashed) {
        const period = size * 2.0;
        const count = Math.max(2, Math.min(this.dashes.length, Math.round(sl / period)));
        const p = sl / count;
        this.dashes.forEach((m, k) => {
          if (k < count) {
            m.visible = true;
            m.scale.set(shaftR * 0.95, p * 0.58, shaftR * 0.95);
            m.position.set(0, k * p, 0);
          } else m.visible = false;
        });
      } else {
        this.shaft.scale.set(shaftR, Math.max(sl, 1e-9), shaftR);
      }
      this.tip.copy(origin).add(vec);
    }
    hide() { this.group.visible = false; }
  }

  /* ---------------------------------------------------------------- labels */
  class Labels {
    constructor(layer) { this.layer = layer; this.items = []; }
    add(tex, color, cls) {
      const el = document.createElement('div');
      el.className = cls || 'lbl3d';
      el.style.color = color;
      if (cls === 'lbl-tick') el.textContent = tex; else katex.render(tex, el, { throwOnError: false });
      this.layer.appendChild(el);
      const it = { el, pos: V3(0, 0, 0), on: false, tex };
      this.items.push(it);
      return it;
    }
    remove(list) {
      list.forEach(it => it.el.remove());
      this.items = this.items.filter(it => !list.includes(it));
    }
    update(camera, w, h) {
      const v = V3(0, 0, 0);
      this.items.forEach(it => {
        if (!it.on) { if (it.el.style.display !== 'none') it.el.style.display = 'none'; return; }
        v.copy(it.pos).project(camera);
        if (v.z > 1 || v.z < -1) { it.el.style.display = 'none'; return; }
        let sx = (v.x + 1) / 2 * w, sy = (1 - v.y) / 2 * h;
        if (it.dir) {
          const q = it.pos.clone().add(it.dir).project(camera);
          let dx = (q.x + 1) / 2 * w - sx, dy = (1 - q.y) / 2 * h - sy;
          const L = Math.hypot(dx, dy) || 1;
          dx /= L; dy /= L;
          sx += dx * 13 - dy * 13 * it.side;
          sy += dy * 13 + dx * 13 * it.side;
        }
        it.el.style.display = '';
        it.el.style.transform = 'translate(' + sx.toFixed(1) + 'px,' + sy.toFixed(1) + 'px) translate(-50%,-50%)';
      });
    }
  }

  /* ------------------------------------------------------------------ view */
  class View3D {
    constructor(container, labelLayer, cb) {
      this.container = container;
      this.cb = cb;
      this.R = 3.5;
      const r = (this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true }));
      r.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      r.localClippingEnabled = true;
      r.setClearColor(0x000000, 0);
      container.appendChild(r.domElement);

      this.scene = new THREE.Scene();
      this.camera = new THREE.PerspectiveCamera(40, 1, 0.01, 500);
      this.camera.up.set(0, 0, 1);
      this.controls = new THREE.OrbitControls(this.camera, r.domElement);
      this.controls.enableDamping = true;
      this.controls.dampingFactor = 0.09;
      this.controls.rotateSpeed = 0.8;
      this.controls.enableZoom = false; // scrolling changes the visible extent instead
      this.center = V3(0, 0, 0);

      this.scene.add(new THREE.AmbientLight(0xffffff, 0.55));
      const d1 = new THREE.DirectionalLight(0xffffff, 0.75); d1.position.set(4, -3, 7); this.scene.add(d1);
      const d2 = new THREE.DirectionalLight(0xaab4ff, 0.35); d2.position.set(-5, 4, -3); this.scene.add(d2);

      this.clipPlanes = [0, 1, 2, 3, 4, 5].map(() => new THREE.Plane(V3(1, 0, 0), 1));

      this.root = new THREE.Group(); this.scene.add(this.root);
      this.axesGroup = new THREE.Group(); this.scene.add(this.axesGroup);
      this.paneGroup = new THREE.Group(); this.scene.add(this.paneGroup);
      this.gridOpacity = 0.35;
      this._paneSig = '';
      this.surfGroups = [null, null, null];
      this.curveGroup = new THREE.Group(); this.root.add(this.curveGroup);
      this.labels = new Labels(labelLayer);
      this.tickLabels = [];
      this.axisLabels = ['x', 'y', 'z'].map(nm => this.labels.add('\\mathsf{' + nm + '}', '#8a94aa'));
      this.showAxes = true;

      this.pointMesh = new THREE.Mesh(new THREE.SphereGeometry(1, 28, 20),
        new THREE.MeshPhongMaterial({ color: 0xffffff, emissive: 0x666677, shininess: 90 }));
      this.pointHalo = new THREE.Mesh(new THREE.SphereGeometry(1, 28, 20),
        new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.12, depthWrite: false }));
      this.root.add(this.pointMesh, this.pointHalo);

      this.covArrows = [0, 1, 2].map(i => new Arrow3(CV.COLORS[i], false));
      this.conArrows = [0, 1, 2].map(i => new Arrow3(CV.COLORS_CON[i], true));
      this.phyArrows = [0, 1, 2].map(i => new Arrow3(CV.COLORS_PHY[i], false, { thin: 0.55 }));
      this.vArrow = new Arrow3(CV.VEC_COLOR, false, { thin: 1.15 });
      this.vCon = [0, 1, 2].map(i => new Arrow3(CV.COLORS[i], false, { thin: 0.6 }));
      this.vCo = [0, 1, 2].map(i => new Arrow3(CV.COLORS_CON[i], true, { thin: 0.6 }));
      this.vPhy = [0, 1, 2].map(i => new Arrow3(CV.COLORS_PHY[i], false, { thin: 0.45 }));
      [...this.covArrows, ...this.conArrows, ...this.phyArrows, this.vArrow, ...this.vCon, ...this.vCo, ...this.vPhy]
        .forEach(a => this.root.add(a.group));

      this.active = false;
      this._raf = null;
      this._bindPointer();
      this.controls.addEventListener('change', () => this._onControlsChange());
      this._resizeObs = new ResizeObserver(() => this.resize());
      this._resizeObs.observe(container);
    }

    /* ------------------------------------------------------------- basics */
    resize() {
      const w = this.container.clientWidth, h = this.container.clientHeight;
      if (!w || !h) return;
      this.renderer.setSize(w, h, false);
      this.renderer.domElement.style.width = w + 'px';
      this.renderer.domElement.style.height = h + 'px';
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
      this.w = w; this.h = h;
    }

    setActive(on) {
      this.active = on;
      this.container.style.display = on ? '' : 'none';
      if (on) {
        this.resize();
        if (!this._raf) this._loop();
      } else {
        if (this._raf) cancelAnimationFrame(this._raf);
        this._raf = null;
        this.labels.items.forEach(i => { i.el.style.display = 'none'; });
      }
    }

    _loop() {
      this._raf = requestAnimationFrame(() => this._loop());
      this.controls.update();
      // the grid panes sit on the box faces away from the camera: rebuild when that changes
      if (this._paneSides().join('') !== this._paneSig) this._buildAxes();
      this.renderer.render(this.scene, this.camera);
      this.labels.update(this.camera, this.w || 1, this.h || 1);
    }

    /** Visible box (centre and half sizes) for the coordinate-range computation. */
    box() { return { center: this.center.toArray(), half: [this.R, this.R, this.R] }; }

    _onControlsChange() {
      const t = this.controls.target;
      if (t.distanceTo(this.center) > this.R * 1e-6) {
        this.center.copy(t);
        this._updateClip();
        this._buildAxes();
        clearTimeout(this._panT);
        this._panT = setTimeout(() => this.cb.onViewChanged(), 140);
      }
    }

    resetCamera(R) {
      if (R) this.R = R;
      this.center.set(0, 0, 0);
      this.controls.target.set(0, 0, 0);
      const k = this.R;
      this.camera.position.set(3.85 * k, -1.2 * k, 2.3 * k);
      this._updateCameraClip();
      this.controls.update();
      this._updateClip();
      this._buildAxes();
    }

    centerOn(p) {
      const d = V3(p[0], p[1], p[2]).sub(this.controls.target);
      this.controls.target.add(d);
      this.camera.position.add(d);
      this.controls.update();
      this._onControlsChange();
    }

    _updateCameraClip() {
      this.camera.near = this.R / 200;
      this.camera.far = this.R * 80;
      this.camera.updateProjectionMatrix();
    }

    /** Multiply the visible extent by f (the camera distance scales with it). */
    zoom(f, anchor) {
      const R = Math.min(1e6, Math.max(1e-4, this.R * f));
      f = R / this.R;
      if (Math.abs(f - 1) < 1e-9) return;
      this.R = R;
      const t = this.controls.target;
      this.camera.position.sub(t).multiplyScalar(f).add(t);
      if (anchor) {
        // keep the world point under the cursor fixed on screen (zoom toward the cursor)
        const shift = anchor.clone().sub(t).multiplyScalar(1 - f);
        t.add(shift);
        this.camera.position.add(shift);
        this.center.copy(t);
        clearTimeout(this._panT);
      }
      this._updateCameraClip();
      this.controls.update();
      this._updateClip();
      this._buildAxes();
      this.cb.onZoom();
    }

    /** Zoom out (never in) so that all given points are inside the visible box. */
    ensureVisible(points) {
      let m = 0;
      points.forEach(p => {
        if (!p || !p.every(Number.isFinite)) return;
        for (let a = 0; a < 3; a++) m = Math.max(m, Math.abs(p[a] - this.center.getComponent(a)));
      });
      if (m > this.R) this.zoom((m * 1.25) / this.R);
    }

    _updateClip() {
      const R = this.R * 1.0001, c = this.center;
      const P = this.clipPlanes;
      P[0].set(V3(-1, 0, 0), c.x + R); P[1].set(V3(1, 0, 0), R - c.x);
      P[2].set(V3(0, -1, 0), c.y + R); P[3].set(V3(0, 1, 0), R - c.y);
      P[4].set(V3(0, 0, -1), c.z + R); P[5].set(V3(0, 0, 1), R - c.z);
    }

    get size() { return this.R / 48; }

    /** For each axis: 1 if the back face (away from the camera) is the upper face. */
    _paneSides() {
      const cp = this.camera.position, c = this.center;
      return [0, 1, 2].map(a => (cp.getComponent(a) > c.getComponent(a) ? 0 : 1));
    }

    setGridOpacity(o) {
      this.gridOpacity = o;
      this._buildAxes();
    }

    _buildAxes() {
      const g = this.axesGroup;
      while (g.children.length) {
        const ch = g.children.pop();
        if (ch.geometry && ch.geometry !== UNIT_CONE) ch.geometry.dispose();
        if (ch.material) ch.material.dispose();
      }
      this.labels.remove(this.tickLabels);
      this.tickLabels = [];
      const show = this.showAxes;
      const R = this.R, c = this.center;
      const lo = [c.x - R, c.y - R, c.z - R], hi = [c.x + R, c.y + R, c.z + R];
      const inBox = (a, v) => v >= lo[a] && v <= hi[a];
      const step = CV.niceStep(2 * R, 8);
      const tick = R / 45;
      const axisPts = [], tickPts = [], gridPts = [];
      const dirs = [V3(1, 0, 0), V3(0, 1, 0), V3(0, 0, 1)];
      for (let a = 0; a < 3; a++) {
        const visible = [0, 1, 2].every(b => b === a || inBox(b, 0));
        this.axisLabels[a].on = show && visible;
        if (!visible) continue;
        const p0 = V3(0, 0, 0).setComponent(a, lo[a]), p1 = V3(0, 0, 0).setComponent(a, hi[a]);
        axisPts.push(p0, p1);
        const cone = new THREE.Mesh(UNIT_CONE, new THREE.MeshBasicMaterial({ color: 0x6b7690 }));
        cone.scale.set(R / 70, R / 22, R / 70);
        cone.position.copy(p1);
        cone.quaternion.setFromUnitVectors(YAXIS, dirs[a]);
        g.add(cone);
        this.axisLabels[a].pos.copy(p1).addScaledVector(dirs[a], R * 0.09);
        const off = a === 0 ? V3(0, 1, 0) : V3(1, 0, 0);
        for (let v = Math.ceil(lo[a] / step) * step; v <= hi[a] + 1e-9 * step; v += step) {
          if (Math.abs(v) < step * 1e-6) continue;
          const p = V3(0, 0, 0).setComponent(a, v);
          tickPts.push(p.clone().addScaledVector(off, -tick), p.clone().addScaledVector(off, tick));
          const L = this.labels.add(CV.fmtTick(v, step), '#7d879c', 'lbl-tick');
          L.pos.copy(p).addScaledVector(off, -tick * 4.5);
          L.on = show;
          this.tickLabels.push(L);
        }
      }
      const lineMat = (col, op) => new THREE.LineBasicMaterial({ color: col, transparent: true, opacity: op, depthWrite: false });
      this._buildPanes(lo, hi, step, tick);
      if (axisPts.length) g.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(axisPts), lineMat(0x5d6880, 0.95)));
      if (tickPts.length) g.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(tickPts), lineMat(0x7d879c, 0.9)));
      if (gridPts.length) g.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(gridPts), lineMat(0x2a3245, 0.55)));
      const bx = [];
      const corner = (i, j, k) => V3(i ? hi[0] : lo[0], j ? hi[1] : lo[1], k ? hi[2] : lo[2]);
      for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) {
        bx.push(corner(0, i, j), corner(1, i, j), corner(i, 0, j), corner(i, 1, j), corner(i, j, 0), corner(i, j, 1));
      }
      g.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(bx), lineMat(0x232a3a, 0.7)));
      g.visible = show;
    }

    /**
     * Projection of the Cartesian grid onto the three box faces behind the scene (always visible,
     * also when the axes themselves are outside the view). Axes that are out of view (or hidden)
     * get their tick labels along the box edges instead.
     */
    _buildPanes(lo, hi, step, tick) {
      const g = this.paneGroup;
      while (g.children.length) { const ch = g.children.pop(); ch.geometry.dispose(); ch.material.dispose(); }
      const sides = this._paneSides();
      this._paneSig = sides.join('');
      const op = this.gridOpacity;
      g.visible = op > 0;
      if (op <= 0) return;
      const back = a => (sides[a] ? hi[a] : lo[a]);
      const front = a => (sides[a] ? lo[a] : hi[a]);
      const major = [], minor = [];
      const minorStep = step / 5;
      const R = this.R;
      for (let a = 0; a < 3; a++) {
        const [b, d] = [0, 1, 2].filter(t => t !== a);
        const f = back(a);
        const line = (list, axis, v) => {
          const other = axis === b ? d : b;
          const p0 = V3(0, 0, 0), p1 = V3(0, 0, 0);
          p0.setComponent(a, f); p1.setComponent(a, f);
          p0.setComponent(axis, v); p1.setComponent(axis, v);
          p0.setComponent(other, lo[other]); p1.setComponent(other, hi[other]);
          list.push(p0, p1);
        };
        for (const axis of [b, d]) {
          for (let v = Math.ceil(lo[axis] / minorStep) * minorStep; v <= hi[axis] + 1e-9 * step; v += minorStep) {
            const isMajor = Math.abs(v / step - Math.round(v / step)) < 1e-6;
            line(isMajor ? major : minor, axis, v);
          }
        }
      }
      const mat = o => new THREE.LineBasicMaterial({ color: 0x8f9bbd, transparent: true, opacity: o, depthWrite: false });
      if (minor.length) g.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(minor), mat(op * 0.3)));
      if (major.length) g.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(major), mat(op)));

      // edge tick labels for axes that are not visible as lines
      const c = this.center;
      const axisVisible = a => this.showAxes && [0, 1, 2].every(t => t === a || (0 >= lo[t] && 0 <= hi[t]));
      const edge = {
        0: v => [V3(v, front(1), back(2)), V3(0, Math.sign(front(1) - c.y) || 1, 0)],
        1: v => [V3(front(0), v, back(2)), V3(Math.sign(front(0) - c.x) || 1, 0, 0)],
        2: v => [V3(front(0), back(1), v), V3(Math.sign(front(0) - c.x) || 1, 0, 0)]
      };
      for (let a = 0; a < 3; a++) {
        if (axisVisible(a)) continue;
        for (let v = Math.ceil(lo[a] / step) * step; v <= hi[a] + 1e-9 * step; v += step) {
          const [p, out] = edge[a](v);
          const L = this.labels.add(CV.fmtTick(v, step), '#8a94aa', 'lbl-tick');
          L.pos.copy(p).addScaledVector(out, tick * 4);
          L.on = true;
          this.tickLabels.push(L);
        }
        const nameL = this.labels.add(['x', 'y', 'z'][a], '#a3acc0', 'lbl-tick axis-name');
        const mid = edge[a]((lo[a] + hi[a]) / 2);
        nameL.pos.copy(mid[0]).addScaledVector(mid[1], tick * 9 + R * 0.04);
        nameL.on = true;
        this.tickLabels.push(nameL);
      }
    }

    /* ----------------------------------------------------------- system */
    setSystem(sys, state) {
      this.sys = sys;
      this.surfGroups.forEach(gp => { if (gp) { this.root.remove(gp); this._dispose(gp); } });
      this.surfGroups = [null, null, null];
      if (this.sysLabels) this.labels.remove(this.sysLabels);
      const names = sys.cnames.map(CV.symTex);
      this.covLabels = names.map((n, i) => this.labels.add('\\mathbf{E}_{' + n + '}', CV.COLORS[i]));
      this.conLabels = names.map((n, i) => this.labels.add('\\mathbf{E}^{' + n + '}', CV.COLORS_CON[i]));
      this.phyLabels = names.map((n, i) => this.labels.add('\\hat{\\mathbf{e}}_{(' + n + ')}', CV.COLORS_PHY[i]));
      this.pLabel = this.labels.add('P', '#ffffff');
      this.vLabel = this.labels.add('\\mathbf{V}', CV.VEC_COLOR);
      this.sysLabels = [...this.covLabels, ...this.conLabels, ...this.phyLabels, this.pLabel, this.vLabel];
      this.showAxes = state.showAxes;
      this.resetCamera(state.viewR);
    }

    updateAll(state) {
      for (let i = 0; i < 3; i++) this.updateSurface(state, i);
      this.updateFrame(state);
      this.updateStyle(state);
    }

    _dispose(obj) {
      obj.traverse(o => {
        if (o.geometry && o.geometry !== UNIT_CYL && o.geometry !== UNIT_CONE) o.geometry.dispose();
        if (o.material) o.material.dispose();
      });
    }

    /** Build/refresh the coordinate surface u_i = const over the visible coordinate ranges. */
    updateSurface(state, i) {
      const sys = this.sys;
      if (!sys || sys.n !== 3) return;
      const old = this.surfGroups[i];
      if (old) { this.root.remove(old); this._dispose(old); this.surfGroups[i] = null; }
      if (!state.surfOn[i]) return;
      const c = state.consts[i];
      const [j, k] = [0, 1, 2].filter(t => t !== i);
      const [aj, bj] = state.vis[j], [ak, bk] = state.vis[k];
      const R = this.R, C = this.center;
      const far = R * 40;
      // adaptive resolution: follow how much the surface bends inside the visible box
      const cArr = C.toArray();
      const probe = (dir, other, oa, ob) => {
        let n = 0;
        for (let q = 0; q <= 3; q++) {
          const uu = [0, 0, 0]; uu[i] = c; uu[other] = oa + (ob - oa) * q / 3;
          n = Math.max(n, CV.sampleCount(t => { uu[dir] = t; return sys.pos(uu); }, ...(dir === j ? [aj, bj] : [ak, bk]), cArr, R,
            { min: 16, max: 1500 }));
        }
        return n;
      };
      let Nj = probe(j, k, ak, bk), Nk = probe(k, j, aj, bj);
      const cap = state.fast ? 12000 : 110000;
      if (Nj * Nk > cap) { const f = Math.sqrt(cap / (Nj * Nk)); Nj = Math.max(12, Math.floor(Nj * f)); Nk = Math.max(12, Math.floor(Nk * f)); }
      if (state.fast) { Nj = Math.max(12, Math.ceil(Nj / 1.6)); Nk = Math.max(12, Math.ceil(Nk / 1.6)); }
      const W = Nk + 1;
      const pos = new Float32Array((Nj + 1) * W * 3);
      const prm = new Float32Array((Nj + 1) * W * 2);
      const valid = new Uint8Array((Nj + 1) * W);
      const u = [0, 0, 0];
      u[i] = c;
      for (let a = 0; a <= Nj; a++) {
        u[j] = aj + (bj - aj) * a / Nj;
        for (let b = 0; b <= Nk; b++) {
          u[k] = ak + (bk - ak) * b / Nk;
          const x = sys.pos(u);
          const id = a * W + b;
          const ok = Number.isFinite(x[0]) && Number.isFinite(x[1]) && Number.isFinite(x[2]) &&
            Math.abs(x[0] - C.x) < far && Math.abs(x[1] - C.y) < far && Math.abs(x[2] - C.z) < far;
          valid[id] = ok ? 1 : 0;
          pos[id * 3] = ok ? x[0] : 0; pos[id * 3 + 1] = ok ? x[1] : 0; pos[id * 3 + 2] = ok ? x[2] : 0;
          prm[id * 2] = u[j]; prm[id * 2 + 1] = u[k];
        }
      }
      const jump = R * 1.5;
      const d2 = (p, q) => {
        const dx = pos[p * 3] - pos[q * 3], dy = pos[p * 3 + 1] - pos[q * 3 + 1], dz = pos[p * 3 + 2] - pos[q * 3 + 2];
        return dx * dx + dy * dy + dz * dz;
      };
      const okEdge = (p, q) => valid[p] && valid[q] && d2(p, q) < jump * jump;
      const index = [];
      for (let a = 0; a < Nj; a++) for (let b = 0; b < Nk; b++) {
        const p00 = a * W + b, p01 = p00 + 1, p10 = p00 + W, p11 = p10 + 1;
        if (okEdge(p00, p10) && okEdge(p10, p11) && okEdge(p11, p00)) index.push(p00, p10, p11);
        if (okEdge(p00, p11) && okEdge(p11, p01) && okEdge(p01, p00)) index.push(p00, p11, p01);
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      geo.setAttribute('prm', new THREE.BufferAttribute(prm, 2));
      geo.setIndex(index);
      geo.computeVertexNormals();
      const col = new THREE.Color(CV.COLORS[i]);
      const mat = new THREE.MeshPhongMaterial({
        color: col, emissive: col.clone().multiplyScalar(0.18), specular: 0x333333, shininess: 30,
        transparent: true, opacity: state.opacity, side: THREE.DoubleSide, depthWrite: false,
        clippingPlanes: this.clipPlanes, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.renderOrder = 1;
      mesh.userData.surf = i;

      // mesh lines at ~10 round parameter values per direction
      const lp = [];
      const pushSeg = (p, q) => { if (okEdge(p, q)) lp.push(pos[p * 3], pos[p * 3 + 1], pos[p * 3 + 2], pos[q * 3], pos[q * 3 + 1], pos[q * 3 + 2]); };
      const sj = Math.max(1, Math.round(Nj / 10)), sk = Math.max(1, Math.round(Nk / 10));
      for (let a = 0; a <= Nj; a += sj) for (let b = 0; b < Nk; b++) pushSeg(a * W + b, a * W + b + 1);
      for (let b = 0; b <= Nk; b += sk) for (let a = 0; a < Nj; a++) pushSeg(a * W + b, (a + 1) * W + b);
      const lg = new THREE.BufferGeometry();
      lg.setAttribute('position', new THREE.Float32BufferAttribute(lp, 3));
      const lmat = new THREE.LineBasicMaterial({ color: col.clone().lerp(new THREE.Color(0xffffff), 0.35), transparent: true, opacity: 0.42, clippingPlanes: this.clipPlanes, depthWrite: false });
      const lines = new THREE.LineSegments(lg, lmat);
      lines.renderOrder = 2;
      lines.visible = state.wire;

      const grp = new THREE.Group();
      grp.add(mesh, lines);
      grp.userData = { mesh, lines };
      this.surfGroups[i] = grp;
      this.root.add(grp);
    }

    updateStyle(state) {
      this.surfGroups.forEach(g => {
        if (!g) return;
        g.userData.mesh.material.opacity = state.opacity;
        g.userData.lines.visible = state.wire;
      });
      if (this.showAxes !== state.showAxes) {
        this.showAxes = state.showAxes;
        this._buildAxes();
      }
    }

    /** Coordinate curves through P as tubes (over the visible coordinate ranges). */
    _buildCurves(state, u0) {
      const g = this.curveGroup;
      while (g.children.length) { const ch = g.children.pop(); this._dispose(ch); }
      if (!state.showCurves) return;
      const sys = this.sys;
      const R = this.R, C = this.center, far = R * 3;
      for (let i = 0; i < sys.n; i++) {
        const [a, b] = state.vis[i];
        const M = CV.sampleCount(t => { const uu = u0.slice(); uu[i] = t; return sys.pos(uu); }, a, b, C.toArray(), R,
          { min: 60, max: state.fast ? 1500 : 5000, lenDiv: 40 });
        let seg = [];
        const segs = [];
        const u = u0.slice();
        for (let s = 0; s <= M; s++) {
          u[i] = a + (b - a) * s / M;
          const x = sys.pos(u);
          const ok = x.every(Number.isFinite) && Math.max(Math.abs(x[0] - C.x), Math.abs(x[1] - C.y), Math.abs(x[2] - C.z)) < far;
          const p = ok ? V3(x[0], x[1], x[2]) : null;
          if (p && seg.length && p.distanceTo(seg[seg.length - 1]) > R * 0.5) { segs.push(seg); seg = []; }
          if (p) seg.push(p); else if (seg.length) { segs.push(seg); seg = []; }
        }
        if (seg.length) segs.push(seg);
        const mat = new THREE.MeshPhongMaterial({ color: CV.COLORS[i], emissive: new THREE.Color(CV.COLORS[i]).multiplyScalar(0.35), clippingPlanes: this.clipPlanes });
        segs.forEach(sg => {
          if (sg.length < 2) return;
          g.add(new THREE.Mesh(tubeGeometry(sg, this.size * 0.16, 6), mat));
        });
      }
    }

    updateFrame(state) {
      const sys = this.sys;
      if (!sys) return;
      const u = state.point;
      const f = sys.frame(u);
      this.lastFrame = f;
      const S = this.size;
      const P = V3(f.x[0], f.x[1], f.x[2]);
      const okP = f.x.every(Number.isFinite);
      this.pointMesh.visible = this.pointHalo.visible = okP;
      this.pointMesh.position.copy(P); this.pointMesh.scale.setScalar(S * 1.25);
      this.pointHalo.position.copy(P); this.pointHalo.scale.setScalar(S * 2.6);
      this.pLabel.pos.copy(P).add(V3(0, 0, S * 4.5));
      this.pLabel.on = okP && state.labels;

      const cap = this.R * 400; // only guards against singular (huge) vectors
      const vecOf = (arr, unit) => {
        const v = V3(arr[0], arr[1], arr[2]);
        const L = v.length();
        if (!Number.isFinite(L) || L < 1e-14) return null;
        if (unit) v.multiplyScalar(1 / L);
        v.multiplyScalar(state.vecScale);
        if (v.length() > cap) v.setLength(cap);
        return v;
      };
      const place = (lbl, arrow, v, side) => {
        lbl.on = !!v && state.labels;
        if (v) { lbl.pos.copy(arrow.tip); lbl.dir = v.clone().setLength(S); lbl.side = side; }
      };
      for (let i = 0; i < 3; i++) {
        const show = okP && i < sys.n;
        const ev = show && state.showCov ? vecOf(f.E[i], false) : null;
        const cv = show && state.showCon ? vecOf(f.Econ[i], false) : null;
        const pv = show && state.showPhys ? vecOf(f.E[i], true) : null;
        if (ev) this.covArrows[i].set(P, ev, S); else this.covArrows[i].hide();
        if (cv) this.conArrows[i].set(P, cv, S * 0.9); else this.conArrows[i].hide();
        if (pv) this.phyArrows[i].set(P, pv, S * 0.8); else this.phyArrows[i].hide();
        if (i < sys.n) {
          place(this.covLabels[i], this.covArrows[i], ev, 1);
          place(this.conLabels[i], this.conArrows[i], cv, -1);
          place(this.phyLabels[i], this.phyArrows[i], pv, 0);
        }
      }
      this._buildCurves(state, u);
      this._updateVector(state, f, P);
    }

    _updateVector(state, f, P) {
      const S = this.size;
      const V = state.V;
      const hideAll = () => { [this.vArrow, ...this.vCon, ...this.vCo, ...this.vPhy].forEach(a => a.hide()); this.vLabel.on = false; };
      if (!V.on || !f.ok) { hideAll(); return; }
      const sc = state.vecScale;
      const Vc = V3(V.cart[0], V.cart[1], V.cart[2] || 0).multiplyScalar(sc);
      this.vArrow.set(P, Vc, S * 1.1);
      this.vLabel.on = state.labels && Vc.length() > 0;
      this.vLabel.pos.copy(this.vArrow.tip);
      this.vLabel.dir = Vc.length() > 0 ? Vc.clone().setLength(S) : null; this.vLabel.side = 0;
      const cart = [V.cart[0], V.cart[1], V.cart[2] || 0];
      const Vup = f.Econ.map(Ek => CV.la.dot(Ek, cart));
      const Vdn = f.E.map(Ek => CV.la.dot(Ek, cart));
      const hat = f.E.map(E => { const L = Math.hypot.apply(null, E); return E.map(x => x / L); });
      const Vphy = Vup.map((v, i) => v * Math.sqrt(f.g[i][i]));
      const chain = (arrows, comps, basis, on) => {
        let o = P.clone();
        arrows.forEach((a, i) => {
          if (!on || i >= this.sys.n) { a.hide(); return; }
          const b = basis[i];
          const w = V3(b[0], b[1], b[2]).multiplyScalar(comps[i] * sc);
          if (w.length() < 1e-12) { a.hide(); return; }
          a.set(o, w, S * 0.8);
          o = o.clone().add(w);
        });
      };
      chain(this.vCon, Vup, f.E, V.con);
      chain(this.vCo, Vdn, f.Econ, V.co);
      chain(this.vPhy, Vphy, hat, V.phys);
    }

    /* ----------------------------------------------------------- picking */
    _ndc(ev) {
      const r = this.renderer.domElement.getBoundingClientRect();
      return { x: ((ev.clientX - r.left) / r.width) * 2 - 1, y: -((ev.clientY - r.top) / r.height) * 2 + 1, px: ev.clientX - r.left, py: ev.clientY - r.top };
    }
    _nearPoint(ev) {
      if (!this.pointMesh.visible) return false;
      const n = this._ndc(ev);
      const v = this.pointMesh.position.clone().project(this.camera);
      const sx = (v.x + 1) / 2 * this.w, sy = (1 - v.y) / 2 * this.h;
      return Math.hypot(sx - n.px, sy - n.py) < 16;
    }
    _inBox(p) {
      const R = this.R * 1.0001, c = this.center;
      return Math.abs(p.x - c.x) <= R && Math.abs(p.y - c.y) <= R && Math.abs(p.z - c.z) <= R;
    }
    _raySurfaces(ev, only) {
      const n = this._ndc(ev);
      const rc = new THREE.Raycaster();
      rc.setFromCamera(n, this.camera);
      const meshes = this.surfGroups.map((g, i) => (g && (only === undefined || only === i) ? g.userData.mesh : null)).filter(Boolean);
      const hits = rc.intersectObjects(meshes, false).filter(h => this._inBox(h.point));
      if (!hits.length) return null;
      const h = hits[0];
      const geo = h.object.geometry;
      const prm = geo.getAttribute('prm');
      const pa = geo.getAttribute('position');
      const A = V3().fromBufferAttribute(pa, h.face.a), B = V3().fromBufferAttribute(pa, h.face.b), C = V3().fromBufferAttribute(pa, h.face.c);
      const bc = new THREE.Vector3();
      THREE.Triangle.getBarycoord(h.point, A, B, C, bc);
      const pj = bc.x * prm.getX(h.face.a) + bc.y * prm.getX(h.face.b) + bc.z * prm.getX(h.face.c);
      const pk = bc.x * prm.getY(h.face.a) + bc.y * prm.getY(h.face.b) + bc.z * prm.getY(h.face.c);
      return { surf: h.object.userData.surf, j: pj, k: pk, point: h.point };
    }
    _planeTarget(ev) {
      const n = this._ndc(ev);
      const rc = new THREE.Raycaster();
      rc.setFromCamera(n, this.camera);
      const normal = this.camera.getWorldDirection(V3()).negate();
      const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(normal, this.pointMesh.position);
      const out = V3();
      return rc.ray.intersectPlane(plane, out) ? [out.x, out.y, out.z] : null;
    }

    _bindPointer() {
      const el = this.renderer.domElement;
      const host = this.container;
      let drag = null;
      host.addEventListener('pointerdown', ev => {
        if (ev.button !== 0 || !this._nearPoint(ev)) return;
        drag = { surf: undefined, id: ev.pointerId };
        this.controls.enabled = false;
        el.setPointerCapture(ev.pointerId);
        el.style.cursor = 'grabbing';
        ev.preventDefault();
      }, true);
      el.addEventListener('pointermove', ev => {
        if (!drag) { el.style.cursor = this._nearPoint(ev) ? 'grab' : ''; return; }
        const st = this.cb.getState();
        const sys = this.sys;
        const held = [0, 1, 2].map(i => st.snap && st.surfOn[i]);
        const nHeld = held.filter(Boolean).length;
        let u = null;
        const fromHit = h => {
          const [j, k] = [0, 1, 2].filter(t => t !== h.surf);
          const uu = st.point.slice();
          uu[h.surf] = st.consts[h.surf]; uu[j] = h.j; uu[k] = h.k;
          return uu;
        };
        if (nHeld === 3 || nHeld === 1) {
          if (drag.surf === undefined) {
            const h = nHeld === 1 ? this._raySurfaces(ev, held.indexOf(true)) : this._raySurfaces(ev);
            if (h) drag.surf = h.surf;
          }
          if (drag.surf !== undefined) {
            const h = this._raySurfaces(ev, drag.surf);
            if (h) u = fromHit(h);
            else {
              const t = this._planeTarget(ev);
              if (t) u = sys.invert(t, st.point, [0, 1, 2].map(i => i !== drag.surf)).u;
            }
          }
        } else {
          const t = this._planeTarget(ev);
          if (t) u = sys.invert(t, st.point, held.map(h => !h)).u;
        }
        if (u) this.cb.onDragPoint(u);
      });
      const end = ev => {
        if (!drag) return;
        drag = null;
        this.controls.enabled = true;
        el.style.cursor = '';
        try { el.releasePointerCapture(ev.pointerId); } catch (e) { /* ignore */ }
        this.cb.onDragEnd();
      };
      el.addEventListener('pointerup', end);
      el.addEventListener('pointercancel', end);
      el.addEventListener('dblclick', ev => {
        const h = this._raySurfaces(ev);
        if (!h) return;
        const st = this.cb.getState();
        const [j, k] = [0, 1, 2].filter(t => t !== h.surf);
        const u = st.point.slice();
        u[h.surf] = st.consts[h.surf]; u[j] = h.j; u[k] = h.k;
        this.cb.onDragPoint(u);
      });
      el.addEventListener('wheel', ev => {
        ev.preventDefault();
        const dy = ev.deltaMode === 1 ? ev.deltaY * 33 : ev.deltaY;
        // anchor: cursor ray hitting the plane through the target, facing the camera
        const n = this._ndc(ev);
        const rc = new THREE.Raycaster();
        rc.setFromCamera(n, this.camera);
        const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(this.camera.getWorldDirection(V3()).negate(), this.controls.target);
        const hit = V3();
        let anchor = null;
        const np = this.pointMesh.visible ? this.pointMesh.position.clone().project(this.camera) : null;
        if (np && Math.hypot((np.x + 1) / 2 * this.w - n.px, (1 - np.y) / 2 * this.h - n.py) < 40) anchor = this.pointMesh.position.clone();
        if (!anchor) { const h = this._raySurfaces(ev); if (h) anchor = h.point.clone(); }
        if (!anchor && rc.ray.intersectPlane(plane, hit)) anchor = hit;
        this.zoom(Math.exp(dy * 0.0012), anchor);
      }, { passive: false });
    }
  }

  CV.View3D = View3D;
})();
