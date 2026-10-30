/* Expression utilities: math.js AST -> fast JS functions, symbolic simplification
   with numeric verification, and TeX rendering helpers. */
(function () {
  'use strict';
  const CV = (window.CV = window.CV || {});

  const GREEK = ['alpha', 'beta', 'gamma', 'delta', 'epsilon', 'varepsilon', 'zeta', 'eta', 'theta', 'vartheta',
    'iota', 'kappa', 'lambda', 'mu', 'nu', 'xi', 'pi', 'rho', 'varrho', 'sigma', 'tau', 'upsilon', 'phi', 'varphi',
    'chi', 'psi', 'omega', 'Gamma', 'Delta', 'Theta', 'Lambda', 'Xi', 'Pi', 'Sigma', 'Upsilon', 'Phi', 'Psi', 'Omega'];

  // Names that math.js / our evaluator reserve for constants.
  const RESERVED = new Set(['e', 'E', 'i', 'pi', 'PI', 'tau', 'Infinity', 'NaN', 'true', 'false', 'null',
    'LN2', 'LN10', 'LOG2E', 'LOG10E', 'SQRT1_2', 'SQRT2', 'version']);

  const JS_FUNCS = {
    sin: 'Math.sin', cos: 'Math.cos', tan: 'Math.tan', asin: 'Math.asin', acos: 'Math.acos', atan: 'Math.atan',
    atan2: 'Math.atan2', sinh: 'Math.sinh', cosh: 'Math.cosh', tanh: 'Math.tanh', asinh: 'Math.asinh',
    acosh: 'Math.acosh', atanh: 'Math.atanh', exp: 'Math.exp', sqrt: 'Math.sqrt', abs: 'Math.abs',
    sign: 'Math.sign', floor: 'Math.floor', ceil: 'Math.ceil', min: 'Math.min', max: 'Math.max',
    cbrt: 'Math.cbrt', log10: 'Math.log10', log2: 'Math.log2',
    sec: 'H.sec', csc: 'H.csc', cot: 'H.cot', sech: 'H.sech', csch: 'H.csch', coth: 'H.coth',
    asec: 'H.asec', acsc: 'H.acsc', acot: 'H.acot', square: 'H.square', cube: 'H.cube', nthRoot: 'H.nthRoot',
    log: 'H.log', pow: 'Math.pow'
  };
  const H = {
    sec: x => 1 / Math.cos(x), csc: x => 1 / Math.sin(x), cot: x => 1 / Math.tan(x),
    sech: x => 1 / Math.cosh(x), csch: x => 1 / Math.sinh(x), coth: x => 1 / Math.tanh(x),
    asec: x => Math.acos(1 / x), acsc: x => Math.asin(1 / x), acot: x => Math.atan(1 / x),
    square: x => x * x, cube: x => x * x * x, nthRoot: (x, n) => Math.sign(x) * Math.pow(Math.abs(x), 1 / n),
    log: (x, b) => (b === undefined ? Math.log(x) : Math.log(x) / Math.log(b))
  };
  CV.H = H;

  /** Translate a math.js node to a JS expression string. `vars` maps symbol -> JS identifier. */
  function toJS(node, vars) {
    switch (node.type) {
      case 'ConstantNode': {
        const v = node.value;
        if (typeof v === 'number') return '(' + String(v) + ')';
        if (typeof v === 'boolean') return v ? '1' : '0';
        throw new Error('Unsupported constant: ' + v);
      }
      case 'SymbolNode': {
        const n = node.name;
        if (Object.prototype.hasOwnProperty.call(vars, n)) return vars[n];
        if (n === 'pi' || n === 'PI') return 'Math.PI';
        if (n === 'e' || n === 'E') return 'Math.E';
        if (n === 'tau') return '(2*Math.PI)';
        throw new Error('Unknown symbol "' + n + '"');
      }
      case 'ParenthesisNode':
        return '(' + toJS(node.content, vars) + ')';
      case 'OperatorNode': {
        const a = node.args.map(x => toJS(x, vars));
        switch (node.fn) {
          case 'add': return '(' + a.join('+') + ')';
          case 'subtract': return '(' + a[0] + '-' + a[1] + ')';
          case 'multiply': return '(' + a.join('*') + ')';
          case 'divide': return '(' + a[0] + '/' + a[1] + ')';
          case 'pow': return 'Math.pow(' + a[0] + ',' + a[1] + ')';
          case 'unaryMinus': return '(-' + a[0] + ')';
          case 'unaryPlus': return '(+' + a[0] + ')';
          case 'mod': return '(' + a[0] + '%' + a[1] + ')';
          case 'smaller': return '(' + a[0] + '<' + a[1] + ')';
          case 'larger': return '(' + a[0] + '>' + a[1] + ')';
          case 'smallerEq': return '(' + a[0] + '<=' + a[1] + ')';
          case 'largerEq': return '(' + a[0] + '>=' + a[1] + ')';
          default: throw new Error('Unsupported operator: ' + node.op);
        }
      }
      case 'FunctionNode': {
        const name = node.fn.name || node.name;
        const f = JS_FUNCS[name];
        if (!f) throw new Error('Unsupported function: ' + name + '()');
        return f + '(' + node.args.map(x => toJS(x, vars)).join(',') + ')';
      }
      case 'ConditionalNode':
        return '(' + toJS(node.condition, vars) + '?' + toJS(node.trueExpr, vars) + ':' + toJS(node.falseExpr, vars) + ')';
      default:
        throw new Error('Unsupported expression element: ' + node.type);
    }
  }
  CV.toJS = toJS;

  /** Build variable map: each name -> safe JS identifier. */
  CV.jsVarMap = function (names) {
    const m = {};
    names.forEach((n, k) => { m[n] = '_v' + k; });
    return m;
  };

  /** Compile a node into f(values[]) where values follow `names`. */
  CV.compileNode = function (node, names) {
    const vm = CV.jsVarMap(names);
    const decl = names.map((n, k) => 'const _v' + k + '=V[' + k + '];').join('');
    // eslint-disable-next-line no-new-func
    return new Function('H', 'return function(V){' + decl + 'return ' + toJS(node, vm) + ';}')(H);
  };

  /** Collect free symbol names (excluding function names and known constants). */
  CV.symbolsOf = function (node) {
    const s = new Set();
    node.traverse((n, path, parent) => {
      if (n.type === 'SymbolNode' && !(parent && parent.type === 'FunctionNode' && path === 'fn')) {
        if (!['pi', 'PI', 'e', 'E', 'tau'].includes(n.name)) s.add(n.name);
      }
    });
    return s;
  };

  CV.isValidName = function (n) {
    return /^[A-Za-z][A-Za-z0-9_]*$/.test(n) && !RESERVED.has(n) && !JS_FUNCS[n];
  };

  /* ---------------------------------------------------------------- symbolic */

  const RULES = math.simplify.rules.concat([
    'n1*sin(n)^2+n1*cos(n)^2 -> n1', 'sin(n)^2+cos(n)^2 -> 1',
    'n1*cosh(n)^2-n1*sinh(n)^2 -> n1', 'cosh(n)^2-sinh(n)^2 -> 1', 'sinh(n)^2-cosh(n)^2 -> -1',
    '1-sin(n)^2 -> cos(n)^2', '1-cos(n)^2 -> sin(n)^2', 'cosh(n)^2-1 -> sinh(n)^2', '1+sinh(n)^2 -> cosh(n)^2',
    'sinh(n)^2+1 -> cosh(n)^2'
  ]);

  function basicSimplify(node) {
    try { return math.simplify(node, RULES); } catch (e) {
      try { return math.simplify(node); } catch (e2) { return node; }
    }
  }

  const ZERO = new math.ConstantNode(0);
  CV.ZERO = ZERO;
  CV.isZeroNode = n => n && n.type === 'ConstantNode' && n.value === 0;

  function hasFn(str, re) { return re.test(str); }

  /**
   * Simplify `node` and return the shortest form that is numerically equal to the original.
   * ctx: {names, samples (arrays of values in `names` order), extra (candidate nodes)}.
   */
  CV.simplifyVerified = function (node, ctx) {
    const names = ctx.names;
    let f0;
    try { f0 = CV.compileNode(node, names); } catch (e) { return node; }
    const samples = ctx.samples;
    const ref = samples.map(s => f0(s));
    const finiteIdx = [];
    ref.forEach((v, i) => { if (Number.isFinite(v)) finiteIdx.push(i); });
    if (finiteIdx.length >= 3) {
      let scale = 0;
      finiteIdx.forEach(i => { scale = Math.max(scale, Math.abs(ref[i])); });
      if (scale < 1e-11) return ZERO;
    }
    const verify = cand => {
      if (finiteIdx.length < 2) return true;
      let f;
      try { f = CV.compileNode(cand, names); } catch (e) { return false; }
      for (const i of finiteIdx) {
        const v = f(samples[i]);
        const r = ref[i];
        if (!(Math.abs(v - r) <= 1e-7 * Math.max(1, Math.abs(r)))) return false;
      }
      return true;
    };
    // "visual" length: plain length plus a penalty for nested / repeated divisions
    const len = n => {
      const str = n.toString().replace(/\s+/g, '');
      const divs = (str.match(/\//g) || []).length;
      return str.length + 6 * Math.max(0, divs - 1);
    };
    const SMALL = 140;

    let best = node, bestLen = len(node);
    const consider = c => {
      if (!c) return;
      const l = len(c);
      if (l < bestLen && verify(c)) { best = c; bestLen = l; }
    };
    (ctx.extra || []).forEach(consider);

    const str = node.toString();
    const hasTrig = hasFn(str, /\b(sin|cos|tan)\(/);
    const hasHyp = hasFn(str, /\b(sinh|cosh|tanh)\(/);
    const trigModes = hasTrig ? [null, 'sin', 'cos'] : [null];
    const hypModes = hasHyp ? [null, 'sinh', 'cosh'] : [null];
    const canon = [];
    trigModes.forEach(t => hypModes.forEach(h => {
      const c = CV.canonRational(node, { trig: t, hyp: h });
      if (c) { canon.push(c); consider(c); }
    }));
    // math.simplify is slow: only use it as a fallback when the canonical forms are still long
    const LONG = 70;
    if (bestLen > LONG && len(node) < SMALL) consider(basicSimplify(node));
    if (bestLen > LONG) canon.forEach(c => { if (len(c) < SMALL) consider(basicSimplify(c)); });
    return best;
  };

  /* --------------------------------------------------------------------- TeX */

  function symTex(name) {
    if (GREEK.includes(name)) return '\\' + name;
    const m = /^([A-Za-z]+)_?(\d+)$/.exec(name);
    if (m) return (GREEK.includes(m[1]) ? '\\' + m[1] : m[1]) + '_{' + m[2] + '}';
    const m2 = /^([A-Za-z]+)_([A-Za-z0-9]+)$/.exec(name);
    if (m2) return (GREEK.includes(m2[1]) ? '\\' + m2[1] : m2[1]) + '_{' + m2[2] + '}';
    if (name.length > 1) return '\\mathrm{' + name + '}';
    return name;
  }
  CV.symTex = symTex;

  const FN_TEX = {
    sin: '\\sin', cos: '\\cos', tan: '\\tan', cot: '\\cot', sec: '\\sec', csc: '\\csc',
    sinh: '\\sinh', cosh: '\\cosh', tanh: '\\tanh', coth: '\\coth',
    sech: '\\operatorname{sech}', csch: '\\operatorname{csch}', log: '\\ln',
    asin: '\\arcsin', acos: '\\arccos', atan: '\\arctan'
  };
  const strip = n => (n.type === 'ParenthesisNode' ? strip(n.content) : n);
  const isSimpleArg = n => {
    n = strip(n);
    if (n.type === 'SymbolNode' || n.type === 'ConstantNode') return true;
    return n.type === 'OperatorNode' && n.fn === 'multiply' && n.args.length === 2 &&
      strip(n.args[0]).type === 'ConstantNode' && strip(n.args[1]).type === 'SymbolNode';
  };
  function fnArgTex(fn, options) {
    const arg = fn.args[0];
    const t = arg.toTex(options);
    return isSimpleArg(arg) ? ' ' + t : '\\left(' + t + '\\right)';
  }

  function texHandler(node, options) {
    if (node.type === 'SymbolNode') {
      if (node.name === 'pi') return '\\pi';
      return symTex(node.name);
    }
    if (node.type === 'FunctionNode' && node.args.length === 1) {
      const name = node.fn.name;
      if (name === 'exp') return 'e^{' + node.args[0].toTex(options) + '}';
      if (FN_TEX[name]) return FN_TEX[name] + fnArgTex(node, options);
    }
    if (node.type === 'OperatorNode' && node.fn === 'pow') {
      const base = strip(node.args[0]), ex = strip(node.args[1]);
      if (base.type === 'FunctionNode' && base.args.length === 1 && FN_TEX[base.fn.name] &&
        ex.type === 'ConstantNode' && Number.isInteger(ex.value) && ex.value > 0) {
        return FN_TEX[base.fn.name] + '^{' + ex.value + '}' + fnArgTex(base, options);
      }
      if (base.type === 'FunctionNode' && base.fn.name === 'exp' && ex.type === 'ConstantNode') {
        const inner = strip(base.args[0]);
        const simple = n => n.type === 'SymbolNode' || n.type === 'ConstantNode';
        if (inner.type === 'OperatorNode' && inner.fn === 'unaryMinus' && simple(strip(inner.args[0]))) {
          return 'e^{-' + ex.value + strip(inner.args[0]).toTex(options) + '}';
        }
        const it = inner.toTex(options);
        return 'e^{' + ex.value + (simple(inner) ? it : '\\left(' + it + '\\right)') + '}';
      }
    }
    return undefined;
  }

  /** Rewrite products/quotients into a single fraction  (sign*coef*num)/(den). */
  function prettyNode(node) {
    node = strip(node);
    const isMD = n => n.type === 'OperatorNode' && (n.fn === 'multiply' || n.fn === 'divide' || n.fn === 'unaryMinus');
    if (!isMD(node)) {
      if (node.type === 'OperatorNode' && node.fn === 'pow') {
        const ex = strip(node.args[1]);
        let k = null;
        if (ex.type === 'ConstantNode' && ex.value < 0) k = -ex.value;
        if (ex.type === 'OperatorNode' && ex.fn === 'unaryMinus' && strip(ex.args[0]).type === 'ConstantNode') k = strip(ex.args[0]).value;
        if (k !== null) {
          const b = prettyNode(node.args[0]);
          return new math.OperatorNode('/', 'divide', [new math.ConstantNode(1), k === 1 ? b : new math.OperatorNode('^', 'pow', [b, new math.ConstantNode(k)])]);
        }
      }
      return node.map(ch => prettyNode(ch));
    }
    const num = [], den = [];
    let cn = 1, cd = 1, sign = 1;
    (function collect(n, pol) {
      n = strip(n);
      if (n.type === 'OperatorNode' && n.fn === 'multiply') { n.args.forEach(x => collect(x, pol)); return; }
      if (n.type === 'OperatorNode' && n.fn === 'divide') { collect(n.args[0], pol); collect(n.args[1], -pol); return; }
      if (n.type === 'OperatorNode' && n.fn === 'unaryMinus') { sign = -sign; collect(n.args[0], pol); return; }
      if (n.type === 'ConstantNode' && typeof n.value === 'number') {
        let v = n.value;
        if (v < 0) { sign = -sign; v = -v; }
        if (pol > 0) cn *= v; else cd *= v;
        return;
      }
      if (n.type === 'OperatorNode' && n.fn === 'pow') {
        const ex = strip(n.args[1]);
        let k = null;
        if (ex.type === 'ConstantNode' && ex.value < 0) k = -ex.value;
        if (ex.type === 'OperatorNode' && ex.fn === 'unaryMinus' && strip(ex.args[0]).type === 'ConstantNode') k = strip(ex.args[0]).value;
        if (k !== null) {
          const b = prettyNode(n.args[0]);
          (pol > 0 ? den : num).push(k === 1 ? b : new math.OperatorNode('^', 'pow', [b, new math.ConstantNode(k)]));
          return;
        }
      }
      (pol > 0 ? num : den).push(prettyNode(n));
    })(node, 1);
    // reduce integer coefficient ratio
    if (Number.isInteger(cn) && Number.isInteger(cd) && cd !== 0) {
      const gcd = (x, y) => (y ? gcd(y, x % y) : x);
      const g = gcd(cn, cd) || 1;
      cn /= g; cd /= g;
    }
    const rank = n => {
      n = strip(n);
      if (n.type === 'ConstantNode') return [0, ''];
      if (n.type === 'SymbolNode') return [1, n.name];
      if (n.type === 'OperatorNode' && n.fn === 'pow' && strip(n.args[0]).type === 'SymbolNode') return [1, strip(n.args[0]).name];
      if (n.type === 'FunctionNode') return [2, n.fn.name + n.toString()];
      if (n.type === 'OperatorNode' && n.fn === 'pow' && strip(n.args[0]).type === 'FunctionNode') return [2, strip(n.args[0]).fn.name + strip(n.args[0]).toString()];
      return [3, ''];
    };
    const order = list => list.map((n, k) => ({ n, k, r: rank(n) }))
      .sort((x, y) => x.r[0] - y.r[0] || (x.r[0] < 3 ? (x.r[1] < y.r[1] ? -1 : x.r[1] > y.r[1] ? 1 : 0) : 0) || x.k - y.k)
      .map(o => o.n);
    num.splice(0, num.length, ...order(num));
    den.splice(0, den.length, ...order(den));
    const prod = (list, c) => {
      const items = list.slice();
      if (c !== 1 || !items.length) items.unshift(new math.ConstantNode(+c.toPrecision(12)));
      return items.length === 1 ? items[0] : new math.OperatorNode('*', 'multiply', items, true);
    };
    let out = prod(num, cn);
    if (den.length || cd !== 1) out = new math.OperatorNode('/', 'divide', [out, prod(den, cd)]);
    if (sign < 0) out = new math.OperatorNode('-', 'unaryMinus', [out]);
    return out;
  }
  CV.prettyNode = prettyNode;

  CV.tex = function (node) {
    if (typeof node === 'string') node = math.parse(node);
    let t;
    try { t = prettyNode(node).toTex({ parenthesis: 'auto', implicit: 'hide', handler: texHandler }); } catch (e) {
      t = node.toTex({ parenthesis: 'auto', implicit: 'hide', handler: texHandler });
    }
    t = t.replace(/\\cdot/g, '\\,').replace(/~/g, '\\,');
    return t;
  };

  CV.fmtNum = function (v, digits) {
    digits = digits || 4;
    if (!Number.isFinite(v)) return Number.isNaN(v) ? '\\text{NaN}' : (v > 0 ? '\\infty' : '-\\infty');
    if (Math.abs(v) < 1e-12) return '0';
    const a = Math.abs(v);
    if (a >= 1e5 || a < 1e-4) {
      const [m, e] = v.toExponential(digits - 1).split('e');
      return m + '\\!\\times\\!10^{' + parseInt(e, 10) + '}';
    }
    let s = v.toPrecision(digits);
    if (s.includes('.')) s = s.replace(/0+$/, '').replace(/\.$/, '');
    return s;
  };
})();
