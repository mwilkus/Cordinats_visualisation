/* Minimal rational-function canonicalizer used by the symbolic simplifier.
   Expressions are rewritten as  coeff * N / prod(D_k^e_k)  where N and D_k are sparse
   multivariate polynomials in "atoms" (symbols, function calls, non-integer powers).
   Even powers of sin/cos and sinh/cosh are reduced with the Pythagorean identities
   (direction chosen by `mode`), and denominator factors are cancelled by exact division. */
(function () {
  'use strict';
  const CV = (window.CV = window.CV || {});

  const MAX_TERMS = 2500;
  class TooBig extends Error {}

  /* ---------------------------------------------------------- monomials */
  // monomial: sorted array of [atomIndex, exponent]; key: "i^e*i^e"
  const mkey = m => m.map(p => p[0] + '^' + p[1]).join('*');
  const mparse = k => (k === '' ? [] : k.split('*').map(s => s.split('^').map(Number)));
  function mmul(a, b) {
    const out = [];
    let i = 0, j = 0;
    while (i < a.length || j < b.length) {
      if (j >= b.length || (i < a.length && a[i][0] < b[j][0])) out.push(a[i++].slice());
      else if (i >= a.length || b[j][0] < a[i][0]) out.push(b[j++].slice());
      else { out.push([a[i][0], a[i][1] + b[j][1]]); i++; j++; }
    }
    return out;
  }
  function mdiv(a, b) { // a / b if divisible, else null
    const out = [];
    let i = 0;
    for (const [bi, be] of b) {
      while (i < a.length && a[i][0] < bi) out.push(a[i++].slice());
      if (i >= a.length || a[i][0] !== bi || a[i][1] < be) return null;
      if (a[i][1] > be) out.push([bi, a[i][1] - be]);
      i++;
    }
    while (i < a.length) out.push(a[i++].slice());
    return out;
  }
  function mcmp(a, b) { // lex order: higher exponent of lower atom index first
    let i = 0, j = 0;
    while (i < a.length || j < b.length) {
      if (i >= a.length) return -1;
      if (j >= b.length) return 1;
      if (a[i][0] !== b[j][0]) return a[i][0] < b[j][0] ? 1 : -1;
      if (a[i][1] !== b[j][1]) return a[i][1] > b[j][1] ? 1 : -1;
      i++; j++;
    }
    return 0;
  }
  const mdeg = m => m.reduce((s, p) => s + p[1], 0);

  /* --------------------------------------------------------- polynomials */
  // Poly: Map key -> coefficient
  const P = {
    const(c) { const p = new Map(); if (c !== 0) p.set('', c); return p; },
    atom(i, e) { return new Map([[mkey([[i, e || 1]]), 1]]); },
    clone(a) { return new Map(a); },
    add(a, b, s) {
      const out = new Map(a);
      s = s === undefined ? 1 : s;
      b.forEach((c, k) => {
        const v = (out.get(k) || 0) + s * c;
        if (v === 0) out.delete(k); else out.set(k, v);
      });
      return P.clean(out);
    },
    scale(a, s) { const out = new Map(); if (s !== 0) a.forEach((c, k) => out.set(k, c * s)); return out; },
    mul(a, b) {
      const out = new Map();
      a.forEach((ca, ka) => {
        const ma = mparse(ka);
        b.forEach((cb, kb) => {
          const k = mkey(mmul(ma, mparse(kb)));
          const v = (out.get(k) || 0) + ca * cb;
          if (v === 0) out.delete(k); else out.set(k, v);
        });
      });
      if (out.size > MAX_TERMS) throw new TooBig();
      return P.clean(out);
    },
    pow(a, k) { let r = P.const(1); for (let i = 0; i < k; i++) r = P.mul(r, a); return r; },
    clean(a) {
      let mx = 0;
      a.forEach(c => { mx = Math.max(mx, Math.abs(c)); });
      const tol = 1e-11 * Math.max(1, mx);
      a.forEach((c, k) => { if (Math.abs(c) <= tol) a.delete(k); });
      return a;
    },
    isConst(a) { return a.size === 0 || (a.size === 1 && a.has('')); },
    constVal(a) { return a.get('') || 0; },
    key(a) { return [...a.entries()].sort((x, y) => (x[0] < y[0] ? -1 : 1)).map(e => e[0] + ':' + e[1].toPrecision(12)).join('|'); },
    terms(a) { return [...a.entries()].map(([k, c]) => ({ m: mparse(k), c })); },
    lead(a) {
      let best = null;
      a.forEach((c, k) => { const m = mparse(k); if (!best || mcmp(m, best.m) > 0) best = { m, c }; });
      return best;
    },
    /** exact division a / b, or null */
    divExact(a, b) {
      if (b.size === 0) return null;
      const lb = P.lead(b);
      let r = P.clone(a);
      let q = new Map();
      let mx = 0;
      a.forEach(c => { mx = Math.max(mx, Math.abs(c)); });
      for (let it = 0; it < 400 && r.size; it++) {
        const lt = P.lead(r);
        const m = mdiv(lt.m, lb.m);
        if (!m) return null;
        const c = lt.c / lb.c;
        const t = new Map([[mkey(m), c]]);
        q = P.add(q, t);
        r = P.add(r, P.mul(t, b), -1);
        r.forEach((cv, k) => { if (Math.abs(cv) <= 1e-9 * Math.max(1, mx)) r.delete(k); });
      }
      return r.size ? null : q;
    },
    /** exact square root of a polynomial (lex order), or null */
    sqrtExact(p) {
      if (p.size === 0) return p;
      const lt = P.lead(p);
      if (!(lt.c > 0) || lt.m.some(e => e[1] % 2)) return null;
      let r = new Map([[mkey(lt.m.map(([i, e]) => [i, e / 2])), Math.sqrt(lt.c)]]);
      let mx = 0;
      p.forEach(c => { mx = Math.max(mx, Math.abs(c)); });
      for (let it = 0; it < p.size + 4; it++) {
        const rem = P.add(p, P.mul(r, r), -1);
        rem.forEach((cv, k) => { if (Math.abs(cv) <= 1e-9 * Math.max(1, mx)) rem.delete(k); });
        if (!rem.size) return r;
        const lr = P.lead(rem), l0 = P.lead(r);
        const m = mdiv(lr.m, l0.m);
        if (!m) return null;
        r = P.add(r, new Map([[mkey(m), lr.c / (2 * l0.c)]]));
      }
      return null;
    },
    /** gcd of monomials and numeric content */
    content(a) {
      let mono = null;
      a.forEach((c, k) => {
        const m = mparse(k);
        if (mono === null) { mono = m; return; }
        mono = mono.map(([i, e]) => { const f = m.find(p => p[0] === i); return [i, f ? Math.min(e, f[1]) : 0]; }).filter(p => p[1] > 0);
      });
      return mono || [];
    }
  };

  /* -------------------------------------------------------------- atoms */
  class Ctx {
    constructor(mode) {
      this.mode = mode || {};
      this.atoms = [];   // {key, node, kind, argKey, argStr, sqrtOf}
      this.byKey = new Map();
    }
    atom(node, extra) {
      const key = extra && extra.key ? extra.key : node.toString();
      if (this.byKey.has(key)) return this.byKey.get(key);
      const info = Object.assign({ key, node }, extra || {});
      info.index = this.atoms.length;
      this.atoms.push(info);
      this.byKey.set(key, info.index);
      return info.index;
    }
    fnAtom(name, argNode) {
      const argStr = argNode.toString();
      const node = math.parse(name + '(' + argStr + ')');
      return this.atom(node, { key: name + '(' + argStr + ')', kind: name, argStr });
    }
  }

  // Rational: {c: number, num: Poly, den: [{p: Poly, e: int, key}]}
  function R(num, den) { return { num, den: den || [] }; }

  function addFactor(den, p, e) {
    const key = P.key(p);
    const f = den.find(d => d.key === key);
    if (f) f.e += e; else den.push({ p, e, key });
  }

  /** Normalize a polynomial used as denominator factor: returns {scale, factors[]}. */
  function splitDenPoly(p) {
    if (P.isConst(p)) return { scale: P.constVal(p), factors: [] };
    // pull monomial content
    const mono = P.content(p);
    let q = p;
    const factors = [];
    if (mono.length) {
      q = new Map();
      p.forEach((c, k) => q.set(mkey(mdiv(mparse(k), mono)), c));
      mono.forEach(([i, e]) => factors.push({ p: P.atom(i, 1), e }));
    }
    let scale = 1;
    if (!P.isConst(q)) {
      // make leading coefficient positive, and normalize numeric content to the leading coeff magnitude
      const lt = P.lead(q);
      scale = lt.c;
      q = P.scale(q, 1 / lt.c);
      let e = 1;
      for (let k = 0; k < 4; k++) {
        const r = P.sqrtExact(q);
        if (!r || P.isConst(r)) break;
        q = r; e *= 2;
      }
      factors.push({ p: q, e });
    } else scale = P.constVal(q);
    return { scale, factors };
  }

  let curCtx = null; // context used for on-the-fly Pythagorean reduction
  function rMul(a, b) {
    const den = a.den.map(d => Object.assign({}, d));
    b.den.forEach(d => addFactor(den, d.p, d.e));
    const num = P.mul(a.num, b.num);
    return R(curCtx ? reduce(num, curCtx) : num, den);
  }
  function denPoly(den, skip) {
    let p = P.const(1);
    den.forEach(d => { const e = d.e - (skip ? skip(d) : 0); if (e > 0) p = P.mul(p, P.pow(d.p, e)); });
    return p;
  }
  function rAdd(a, b, s) {
    // LCM of factored denominators
    const L = a.den.map(d => Object.assign({}, d));
    b.den.forEach(d => {
      const f = L.find(x => x.key === d.key);
      if (f) f.e = Math.max(f.e, d.e); else L.push(Object.assign({}, d));
    });
    const missing = (x, mine) => { const f = mine.find(y => y.key === x.key); return x.e - (f ? f.e : 0); };
    const ma = denPoly(L.map(d => ({ p: d.p, e: missing(d, a.den) })));
    const mb = denPoly(L.map(d => ({ p: d.p, e: missing(d, b.den) })));
    return R(P.add(P.mul(a.num, ma), P.mul(b.num, mb), s), L);
  }
  function rInv(a, ctx) {
    // 1/(num/den) = den/num
    const { scale, factors } = splitDenPoly(reduce(a.num, ctx));
    if (scale === 0) throw new Error('division by zero');
    const num = P.scale(denPoly(a.den), 1 / scale);
    const den = [];
    factors.forEach(f => addFactor(den, f.p, f.e));
    return R(num, den);
  }
  /** 1/node, keeping products and integer powers in factored form. */
  function recipNode(node, ctx) {
    if (node.type === 'ParenthesisNode') return recipNode(node.content, ctx);
    if (node.type === 'OperatorNode' && node.fn === 'multiply') {
      return node.args.map(a => recipNode(a, ctx)).reduce((x, y) => rMul(x, y));
    }
    if (node.type === 'OperatorNode' && node.fn === 'pow') {
      let k = null;
      try { const v = node.args[1].evaluate(); if (typeof v === 'number') k = v; } catch (e) { k = null; }
      if (k !== null && Number.isInteger(k) && k > 0 && k <= 12) {
        const r = recipNode(node.args[0], ctx);
        let out = R(P.const(1));
        for (let i = 0; i < k; i++) out = rMul(out, r);
        return out;
      }
    }
    return rInv(fromNode(node, ctx), ctx);
  }

  function rPow(a, k, ctx) {
    if (k === 0) return R(P.const(1));
    if (k < 0) return rPow(rInv(a, ctx), -k, ctx);
    if (k > 12) throw new TooBig();
    let r = R(P.const(1));
    for (let i = 0; i < k; i++) r = rMul(r, a);
    return r;
  }

  /** Pythagorean / sqrt reduction to a normal form. */
  function reduce(p, ctx) {
    const mode = ctx.mode;
    let changed = true, guard = 0;
    while (changed && guard++ < 40) {
      changed = false;
      for (const [k, c] of p) {
        const m = mparse(k);
        let hit = null;
        for (const [i, e] of m) {
          if (e < 2) continue;
          const at = ctx.atoms[i];
          if ((mode.trig === 'cos' && at.kind === 'sin') || (mode.trig === 'sin' && at.kind === 'cos') ||
            (mode.hyp === 'cosh' && at.kind === 'sinh') || (mode.hyp === 'sinh' && at.kind === 'cosh') ||
            (at.sqrtOf)) { hit = { i, at }; break; }
        }
        if (!hit) continue;
        const { i, at } = hit;
        let rep;
        if (at.sqrtOf) rep = at.sqrtOf;
        else {
          const other = { sin: 'cos', cos: 'sin', sinh: 'cosh', cosh: 'sinh' }[at.kind];
          const j = ctx.fnAtom(other, math.parse(at.argStr));
          const sq = P.atom(j, 2);
          if (at.kind === 'sin' || at.kind === 'cos') rep = P.add(P.const(1), sq, -1);
          else if (at.kind === 'sinh') rep = P.add(sq, P.const(1), -1);
          else rep = P.add(P.const(1), sq);
        }
        const rest = m.map(p2 => (p2[0] === i ? [i, p2[1] - 2] : p2)).filter(p2 => p2[1] > 0);
        p = P.clone(p);
        p.delete(k);
        p = P.add(p, P.scale(P.mul(new Map([[mkey(rest), 1]]), rep), c));
        changed = true;
        break;
      }
    }
    return p;
  }

  function fromNode(node, ctx) {
    switch (node.type) {
      case 'ConstantNode':
        if (typeof node.value !== 'number') throw new Error('non-numeric constant');
        return R(P.const(node.value));
      case 'SymbolNode':
        if (node.name === 'pi') return R(P.atom(ctx.atom(node), 1));
        return R(P.atom(ctx.atom(node), 1));
      case 'ParenthesisNode':
        return fromNode(node.content, ctx);
      case 'OperatorNode': {
        if (node.fn === 'divide') return rMul(fromNode(node.args[0], ctx), recipNode(node.args[1], ctx));
        if (node.fn === 'pow') {
          let k0 = null;
          try { const v = node.args[1].evaluate(); if (typeof v === 'number') k0 = v; } catch (e) { k0 = null; }
          if (k0 !== null && Number.isInteger(k0) && k0 < 0) {
            const rp = recipNode(node.args[0], ctx);
            if (-k0 > 12) throw new TooBig();
            let out = R(P.const(1));
            for (let i = 0; i < -k0; i++) out = rMul(out, rp);
            return out;
          }
        }
        const a = node.args.map(x => fromNode(x, ctx));
        switch (node.fn) {
          case 'add': return a.reduce((x, y) => rAdd(x, y, 1));
          case 'subtract': return rAdd(a[0], a[1], -1);
          case 'multiply': return a.reduce((x, y) => rMul(x, y));
          case 'divide': return rMul(a[0], recipNode(node.args[1], ctx));
          case 'unaryMinus': return R(P.scale(a[0].num, -1), a[0].den);
          case 'unaryPlus': return a[0];
          case 'pow': {
            const ex = node.args[1];
            let k = null;
            try { const v = ex.evaluate(); if (typeof v === 'number') k = v; } catch (e) { k = null; }
            if (k !== null && Number.isInteger(k)) return rPow(a[0], k, ctx);
            if (k !== null && Number.isInteger(2 * k)) {
              const s = sqrtAtom(node.args[0], ctx);
              return rPow(s, Math.round(2 * k), ctx);
            }
            return R(P.atom(ctx.atom(node), 1));
          }
          default: throw new Error('unsupported op');
        }
      }
      case 'FunctionNode': {
        const name = node.fn.name;
        if (name === 'sqrt') return sqrtAtom(node.args[0], ctx);
        if (['sin', 'cos', 'sinh', 'cosh'].includes(name) && node.args.length === 1) {
          const argC = canonArg(node.args[0], ctx);
          return R(P.atom(ctx.fnAtom(name, argC), 1));
        }
        if (name === 'tan' || name === 'tanh') {
          const argC = canonArg(node.args[0], ctx);
          const s = R(P.atom(ctx.fnAtom(name === 'tan' ? 'sin' : 'sinh', argC), 1));
          const c = R(P.atom(ctx.fnAtom(name === 'tan' ? 'cos' : 'cosh', argC), 1));
          return rMul(s, rInv(c, ctx));
        }
        if (name === 'exp' && node.args.length === 1) {
          const ex = expSplit(node.args[0], ctx);
          if (ex) return ex;
        }
        const args = node.args.map(x => canonArg(x, ctx));
        const nn = new math.FunctionNode(node.fn, args);
        return R(P.atom(ctx.atom(nn), 1));
      }
      default: throw new Error('unsupported node');
    }
  }

  /** exp(sum c_k m_k) -> prod exp(m_k)^c_k for small integer c_k. */
  function expSplit(argNode, ctx) {
    let sub;
    const saved = curCtx;
    try { const sc = new Ctx(ctx.mode); curCtx = sc; sub = fromNode(argNode, sc); sub.ctx = sc; } catch (e) { return null; } finally { curCtx = saved; }
    if (sub.den.length) return null;
    let out = R(P.const(1));
    for (const t of P.terms(sub.num)) {
      const ms = monoStr(t.m, sub.ctx);
      let base, k;
      if (Number.isInteger(t.c) && Math.abs(t.c) <= 6 && ms) { base = ms; k = t.c; }
      else { base = ms ? fracStr(t.c) + '*' + ms : fracStr(t.c); k = 1; }
      const nd = math.parse('exp(' + base + ')');
      const at = R(P.atom(ctx.atom(nd, { key: 'exp(' + base + ')' }), 1));
      out = rMul(out, k >= 0 ? rPow(at, k, ctx) : rPow(rInv(at, ctx), -k, ctx));
    }
    return out;
  }

  function canonArg(node, ctx) {
    const saved = curCtx;
    try {
      const sub = new Ctx(ctx.mode);
      curCtx = sub;
      return toNode(fromNode(node, sub), sub);
    } catch (e) { return node; } finally { curCtx = saved; }
  }

  function plainSqrtAtom(innerNode, ctx, sqrtOf) {
    const key = 'sqrt(' + innerNode.toString() + ')';
    const idx = ctx.atom(math.parse(key), { key, sqrtOf: sqrtOf || null });
    return R(P.atom(idx, 1));
  }

  /** sqrt(arg): pull perfect squares (even powers of atoms / denominator factors) outside. */
  function sqrtAtom(argNode, ctx) {
    const argC = canonArg(argNode, ctx);
    let sub;
    try { sub = fromNode(argC, ctx); } catch (e) { return plainSqrtAtom(argC, ctx, null); }
    let num = reduce(sub.num, ctx);
    if (num.size === 0) return R(P.const(0));
    // outside / inside parts
    let outNum = P.const(1);
    const outDen = [], inDen = [];
    let scale = 1;
    sub.den.forEach(d => {
      const sp = splitDenPoly(reduce(d.p, ctx));
      scale *= Math.pow(sp.scale, d.e);
      sp.factors.forEach(f => {
        const e = f.e * d.e;
        if (e >= 2) addFactor(outDen, f.p, Math.floor(e / 2));
        if (e % 2) addFactor(inDen, f.p, 1);
      });
    });
    num = P.scale(num, 1 / scale);
    const terms = P.terms(num);
    const mono = terms.length === 1 ? terms[0].m : P.content(num);
    const outMono = mono.map(([i, e]) => [i, Math.floor(e / 2)]).filter(p => p[1] > 0);
    if (outMono.length) {
      const rem = new Map();
      num.forEach((c, k) => {
        let m = mparse(k);
        outMono.forEach(([i, e]) => { m = mdiv(m, [[i, 2 * e]]); });
        rem.set(mkey(m), c);
      });
      num = rem;
      outNum = new Map([[mkey(outMono), 1]]);
    }
    if (!(num.size === 1 && num.has(''))) {
      let sq = P.sqrtExact(num);
      if (sq) { outNum = P.mul(outNum, sq); num = P.const(1); }
      else if (inDen.length && (sq = P.sqrtExact(P.scale(num, -1)))) {
        // -S^2 / D: absorb the sign into one denominator factor
        outNum = P.mul(outNum, sq); num = P.const(1);
        inDen[0] = { p: P.scale(inDen[0].p, -1), e: inDen[0].e, key: 'neg' + inDen[0].key };
      }
    }
    if (num.size === 1 && num.get('') === -1 && inDen.length) {
      num = P.const(1);
      inDen[0] = { p: P.scale(inDen[0].p, -1), e: inDen[0].e, key: 'neg' + inDen[0].key };
    }
    if (num.size === 1 && num.has('')) {
      const c = num.get('');
      const r = Math.sqrt(Math.abs(c));
      if (c > 0 && Math.abs(r - Math.round(r)) < 1e-12) { outNum = P.scale(outNum, Math.round(r)); num = P.const(1); }
    }
    const outside = R(outNum, outDen);
    if (num.size === 1 && num.get('') === 1 && !inDen.length) return outside;
    // build the inner node directly so the chosen factor signs are kept
    const numS = polyStr(num, ctx);
    let innerStr = P.terms(num).length > 1 ? '(' + numS + ')' : numS;
    if (inDen.length) {
      innerStr += '/(' + inDen.map(d => '(' + polyStr(d.p, ctx) + ')' + (d.e > 1 ? '^' + d.e : '')).join('*') + ')';
    }
    const innerNode = math.parse(innerStr);
    return rMul(outside, plainSqrtAtom(innerNode, ctx, inDen.length ? null : num));
  }

  /* ------------------------------------------------------------ output */
  function fracStr(v) {
    const s = v < 0 ? '-' : '';
    v = Math.abs(v);
    if (Math.abs(v - Math.round(v)) < 1e-10) return s + String(Math.round(v));
    for (let q = 2; q <= 720; q++) {
      const p = v * q;
      if (Math.abs(p - Math.round(p)) < 1e-9 * q) return s + Math.round(p) + '/' + q;
    }
    return s + String(+v.toPrecision(12));
  }

  function monoStr(m, ctx) {
    return m.map(([i, e]) => {
      const at = ctx.atoms[i];
      let b = at.node.toString();
      if (at.node.type !== 'SymbolNode' && at.node.type !== 'FunctionNode') b = '(' + b + ')';
      return e === 1 ? b : b + '^' + e;
    }).join('*');
  }

  function polyStr(p, ctx) {
    const terms = P.terms(p).sort((x, y) => mdeg(y.m) - mdeg(x.m) || mcmp(y.m, x.m));
    if (!terms.length) return '0';
    if (terms[0].c < 0) {
      const k = terms.findIndex(t => t.c > 0);
      if (k > 0) terms.unshift(terms.splice(k, 1)[0]);
    }
    return terms.map((t, k) => {
      const ms = monoStr(t.m, ctx);
      const neg = t.c < 0;
      const a = Math.abs(t.c);
      let body;
      if (!ms) body = fracStr(a);
      else if (Math.abs(a - 1) < 1e-12) body = ms;
      else {
        const f = fracStr(a);
        body = f.includes('/') ? '(' + f.split('/')[0] + '*' + ms + ')/' + f.split('/')[1] : f + '*' + ms;
      }
      return (neg ? (k ? ' - ' : '-') : (k ? ' + ' : '')) + body;
    }).join('');
  }

  function toNode(r, ctx) {
    let num = reduce(r.num, ctx);
    if (num.size === 0) return new math.ConstantNode(0);
    let den = r.den.map(d => ({ p: reduce(d.p, ctx), e: d.e }));
    // re-split factors after reduction and normalize
    let scale = 1;
    const nd = [];
    den.forEach(d => {
      const s = splitDenPoly(d.p);
      scale *= Math.pow(s.scale, d.e);
      s.factors.forEach(f => addFactor(nd, f.p, f.e * d.e));
    });
    num = P.scale(num, 1 / scale);
    den = nd;
    // cancel
    for (const d of den) {
      while (d.e > 0) {
        const q = P.divExact(num, d.p);
        if (!q) break;
        num = q; d.e--;
      }
    }
    // also cancel monomial content of num against atom factors (already covered by divExact)
    den = den.filter(d => d.e > 0);

    // numeric content of numerator
    const terms = P.terms(num);
    let content = null;
    if (terms.length > 1) {
      const absMin = Math.min(...terms.map(t => Math.abs(t.c)));
      const ok = terms.every(t => Math.abs(t.c / absMin - Math.round(t.c / absMin)) < 1e-9);
      if (ok && Math.abs(absMin - 1) > 1e-12) content = absMin;
    }
    const lt = terms.length > 1 ? P.lead(num) : null;
    let sign = 1;
    if (lt && lt.c < 0 && terms.filter(t => t.c < 0).length > terms.length / 2) sign = -1;
    const cf = (content || 1) * sign;
    if (cf !== 1) num = P.scale(num, 1 / cf);

    // monomial content of numerator
    const mono = terms.length > 1 ? P.content(num) : [];
    if (mono.length) {
      const q = new Map();
      num.forEach((c, k) => q.set(mkey(mdiv(mparse(k), mono)), c));
      num = q;
    }

    let s = polyStr(num, ctx);
    let multi = P.terms(num).length > 1;
    if (multi) {
      // perfect powers: print (q)^k instead of the expanded polynomial
      let q = num, k = 1;
      for (let t = 0; t < 3; t++) {
        const r = P.sqrtExact(q);
        if (!r || P.isConst(r) || P.terms(r).length < 2) break;
        q = r; k *= 2;
      }
      if (k > 1) { s = '(' + polyStr(q, ctx) + ')^' + k; multi = false; }
    }
    const parts = [];
    if (cf !== 1) parts.push(fracStr(cf));
    if (mono.length) parts.push(monoStr(mono, ctx));
    if (parts.length && multi) s = '(' + s + ')';
    if (parts.length && !(P.terms(num).length === 1 && s === '1')) parts.push(s);
    else if (!parts.length) parts.push(multi ? '(' + s + ')' : s);
    let numStr = parts.join('*');
    if (den.length) {
      const dStr = den.map(d => {
        const isAtom = d.p.size === 1 && Math.abs(P.terms(d.p)[0].c - 1) < 1e-12;
        const b = isAtom ? monoStr(P.terms(d.p)[0].m, ctx) : '(' + polyStr(d.p, ctx) + ')';
        return d.e === 1 ? b : b + '^' + d.e;
      }).join('*');
      numStr = '(' + numStr + ')/' + (den.length > 1 ? '(' + dStr + ')' : dStr);
    }
    return math.parse(numStr);
  }

  /** Canonicalize node under a Pythagorean reduction mode. Returns a node or null. */
  CV.canonRational = function (node, mode) {
    const saved = curCtx;
    try {
      const ctx = new Ctx(mode);
      curCtx = ctx;
      const r = fromNode(node, ctx);
      return toNode(r, ctx);
    } catch (e) {
      return null;
    } finally {
      curCtx = saved;
    }
  };
})();
