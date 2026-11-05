// src/desk/expr.ts
/**
 * A tiny safe expression language for `plot fn="…"`. Never uses eval or Function.
 *
 *   expr  := sum
 *   sum   := prod (('+' | '-') prod)*
 *   prod  := unary (('*' | '/' | '%') unary | implicit)*  implicit: "2x", "2(x+1)", "x sin(x)", "(x)(x)";
 *                                                         % is the remainder, never negative (k % 3: a step's column)
 *   unary := ('-' | '+') unary | power
 *   power := atom ('^' unary)?                           right-assoc; -x^2 = -(x^2); 2^-1 = 0.5
 *   atom  := number | name | 'pi' | func '(' expr ')' | '(' expr ')'
 *   name  := [A-Za-z][A-Za-z0-9_]*                       one identifier (K2, n10, T0, rate0), read lowercase;
 *                                                         only a digit-LEADING term multiplies: 2x = 2·x, x2 is a name
 *   func  := sin | cos | tan | asin | acos | atan | exp | log | ln | sqrt | abs | round | floor | ceil | sign
 *            | rad | deg (degrees ↔ radians)                  (log and ln are natural)
 *            | min | max | mean | sum '(' expr (',' expr)* ')'   (a name with no '(' stays a variable)
 *            | if '(' cond ',' expr ',' expr ')'            the second argument when cond ≠ 0, else the third
 *            | integral '(' expr ',' [name ','] expr ',' expr ')'
 *                 ∫ from a to b of the first argument over `name` (default t), which shadows any outer
 *                 name inside it; tanh-sinh quadrature (accurate to ~1e-10 for smooth integrands, and
 *                 for integrable endpoint singularities such as 1/sqrt(t) at 0). NaN if it doesn't converge.
 *
 * Accepts × · for *, ÷ for /, − for -, π for pi, and ** for ^.
 */
export type Fn = (x: number) => number;

export class ExprError extends Error {}

const FUNCS: Record<string, (v: number) => number> = {
  sin: Math.sin, cos: Math.cos, tan: Math.tan, asin: Math.asin, acos: Math.acos, atan: Math.atan,
  exp: Math.exp, log: Math.log, ln: Math.log, sqrt: Math.sqrt, abs: Math.abs,
  round: Math.round, floor: Math.floor, ceil: Math.ceil, sign: Math.sign,
  rad: (d) => (d * Math.PI) / 180, deg: (r) => (r * 180) / Math.PI,
};
/** Functions of several arguments, called as min(a, b, c). */
const MULTI: Record<string, (xs: number[]) => number> = {
  min: (xs) => Math.min(...xs), max: (xs) => Math.max(...xs),
  mean: (xs) => xs.reduce((a, b) => a + b, 0) / xs.length, sum: (xs) => xs.reduce((a, b) => a + b, 0),
};
export const MAX_EXPR_CHARS = 120;
const MAX_DEPTH = 32;

export type Tok = { t: 'num'; v: number } | { t: 'id'; v: string } | { t: 'op'; v: string };

export function lex(src: string): Tok[] {
  const s = src.replace(/\*\*/g, '^').replace(/[×·]/g, '*').replace(/÷/g, '/').replace(/−/g, '-').replace(/π/g, 'pi');
  const out: Tok[] = [];
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (c === ' ' || c === '\t') { i++; continue; }
    const num = /^(\d+\.?\d*|\.\d+)(e[+-]?\d+)?/i.exec(s.slice(i));
    if (num) { out.push({ t: 'num', v: Number(num[0]) }); i += num[0].length; continue; }
    const id = /^[a-z][a-z0-9_]*/i.exec(s.slice(i));
    if (id) { out.push({ t: 'id', v: id[0].toLowerCase() }); i += id[0].length; continue; }
    const cmp = /^(==|!=|<=|>=|<|>|=|≤|≥|≠)/.exec(s.slice(i));
    if (cmp) { out.push({ t: 'op', v: ({ '=': '==', '≤': '<=', '≥': '>=', '≠': '!=' } as Record<string, string>)[cmp[0]] ?? cmp[0] }); i += cmp[0].length; continue; }
    if ('+-*/%^(),'.includes(c)) { out.push({ t: 'op', v: c }); i++; continue; }
    throw new ExprError(`unexpected "${c}"`);
  }
  return out;
}

/**
 * The variable names `src` reads (lowercase, each once): identifiers that are not followed by "(" and
 * are not pi. Null when it doesn't lex. Lets a caller compile a formula whose names are bound later
 * (a vals= cell written with {{const}} names).
 */
export function freeNames(src: string): string[] | null {
  let toks: Tok[];
  try { toks = lex(src); } catch { return null; }
  const out = new Set<string>();
  toks.forEach((k, j) => { if (k.t === 'id' && k.v !== 'pi' && !(toks[j + 1]?.t === 'op' && toks[j + 1].v === '(')) out.add(k.v); });
  return [...out];
}

/** Compiles `src` into a function of x. Throws ExprError on anything outside the grammar. */
export function compile(src: string): Fn {
  const f = compileVars(src, ['x']);
  return (x) => f({ x });
}

/** A function of named variables (the visual kit's element-wise maps: x, y, mean, a, b…). */
export type VarFn = (env: Record<string, number>) => number;

/**
 * Compiles `src` over the variables `names` (lowercase identifiers; a missing one reads as NaN).
 * Same grammar as `compile`, with those names in place of x. Throws ExprError outside the grammar.
 */
export function compileVars(src: string, names: readonly string[], opts: { rand?: () => number } = {}): VarFn {
  const vars = new Set(names);
  if (src.length > MAX_EXPR_CHARS) throw new ExprError('too long');
  const toks = lex(src);
  if (!toks.length) throw new ExprError('empty');
  let i = 0;
  let depth = 0;
  const peek = () => toks[i];
  const isOp = (v: string) => peek()?.t === 'op' && peek()!.v === v;
  const enter = () => { if (++depth > MAX_DEPTH) throw new ExprError('too deep'); };
  const startsAtom = () => { const k = peek(); return !!k && (k.t === 'num' || k.t === 'id' || (k.t === 'op' && k.v === '(')); };

  // A comparison (lowest precedence, at most one per level; also inside parentheses, as in (c>12)*100):
  // 1 when it holds, else 0. Equality within 1e-9.
  const CMP: Record<string, (a: number, b: number) => boolean> = {
    '==': (a, b) => Math.abs(a - b) <= 1e-9, '!=': (a, b) => Math.abs(a - b) > 1e-9, '<': (a, b) => a < b, '>': (a, b) => a > b, '<=': (a, b) => a <= b + 1e-9, '>=': (a, b) => a >= b - 1e-9,
  };
  const cmp = (): VarFn => {
    const f = sum();
    const k = peek();
    if (k?.t === 'op' && k.v in CMP) {
      i++;
      const b = sum(), test = CMP[k.v];
      return (e) => (test(f(e), b(e)) ? 1 : 0);
    }
    return f;
  };
  const sum = (): VarFn => {
    let f = prod();
    while (isOp('+') || isOp('-')) {
      const op = toks[i++].v, a = f, b = prod();
      f = op === '+' ? (e) => a(e) + b(e) : (e) => a(e) - b(e);
    }
    return f;
  };
  const prod = (): VarFn => {
    let f = unary();
    for (;;) {
      if (isOp('*') || isOp('/') || isOp('%')) {
        const op = toks[i++].v, a = f, b = unary();
        f = op === '*' ? (e) => a(e) * b(e) : op === '/' ? (e) => a(e) / b(e) : (e) => { const m = b(e); return ((a(e) % m) + m) % m; };
      } else if (startsAtom()) {
        const a = f, b = power();
        f = (e) => a(e) * b(e);
      } else return f;
    }
  };
  const unary = (): VarFn => {
    enter();
    try {
      if (isOp('-')) { i++; const a = unary(); return (e) => -a(e); }
      if (isOp('+')) { i++; return unary(); }
      return power();
    } finally { depth--; }
  };
  const power = (): VarFn => {
    const base = atom();
    if (!isOp('^')) return base;
    i++;
    const ex = unary();
    return (e) => Math.pow(base(e), ex(e));
  };
  const atom = (): VarFn => {
    const k = toks[i++];
    if (!k) throw new ExprError('unexpected end');
    if (k.t === 'num') { const v = k.v; return () => v; }
    if (k.t === 'op' && k.v === '(') {
      enter();
      const f = cmp();
      depth--;
      if (!isOp(')')) throw new ExprError('missing )');
      i++;
      return f;
    }
    if (k.t === 'id') {
      if (k.v === 'if' && isOp('(')) {
        const args = callArgs(() => cmp());
        if (args.length !== 3) throw new ExprError('if takes (condition, then, else)');
        const [c, a, b] = args;
        return (e) => { const v = c(e); return v !== 0 && !Number.isNaN(v) ? a(e) : b(e); };
      }
      if (k.v === 'integral' && isOp('(')) return integralCall();
      if (k.v in MULTI && isOp('(')) {
        i++;
        enter();
        const args = [cmp()];
        while (isOp(',')) { i++; args.push(cmp()); }
        depth--;
        if (!isOp(')')) throw new ExprError('missing )');
        i++;
        const g = MULTI[k.v];
        return (e) => g(args.map((a) => a(e)));
      }
      if (vars.has(k.v)) { const n = k.v; return (e) => e[n] ?? NaN; }
      if (k.v === 'pi') return () => Math.PI;
      // Seeded noise (the kit's generated data): rand() uniform in [0, 1), randn() standard normal.
      if ((k.v === 'rand' || k.v === 'randn') && opts.rand) {
        const rnd = opts.rand;
        if (!isOp('(')) throw new ExprError(`${k.v} needs ()`);
        i++;
        if (!isOp(')')) throw new ExprError(`${k.v} takes no argument`);
        i++;
        return k.v === 'rand' ? () => rnd() : () => Math.sqrt(-2 * Math.log(1 - rnd())) * Math.cos(2 * Math.PI * rnd());
      }
      const fn = FUNCS[k.v];
      if (!fn) throw new ExprError(`unknown name "${k.v}"`);
      if (!isOp('(')) throw new ExprError(`${k.v} needs (`);
      i++;
      enter();
      const a = sum();
      depth--;
      if (!isOp(')')) throw new ExprError('missing )');
      i++;
      return (e) => fn(a(e));
    }
    throw new ExprError(`unexpected "${k.v}"`);
  };

  /** '(' arg (',' arg)* ')' from the current '('. */
  function callArgs(arg: () => VarFn): VarFn[] {
    i++;
    enter();
    const args = [arg()];
    while (isOp(',')) { i++; args.push(arg()); }
    depth--;
    if (!isOp(')')) throw new ExprError('missing )');
    i++;
    return args;
  }
  /** integral(f, a, b) over t, or integral(f, u, a, b) over u: the variable is known before f compiles. */
  function integralCall(): VarFn {
    // Top-level commas of the call (lookahead), to see whether the second argument names the variable.
    const commas: number[] = [];
    let d = 0, j = i;
    for (; j < toks.length; j++) {
      const q = toks[j];
      if (q.t !== 'op') continue;
      if (q.v === '(') d++;
      else if (q.v === ')') { if (--d === 0) break; }
      else if (q.v === ',' && d === 1) commas.push(j);
    }
    let name = 't';
    const named = commas.length === 3;
    if (named) {
      const v = toks[commas[0] + 1];
      if (v?.t !== 'id' || commas[1] !== commas[0] + 2) throw new ExprError('integral(f, var, a, b): var must be a name');
      name = v.v;
    } else if (commas.length !== 2) throw new ExprError('integral takes (f, a, b) or (f, var, a, b)');
    const had = vars.has(name);
    vars.add(name);
    i++;
    enter();
    let f: VarFn;
    try { f = cmp(); } finally { if (!had) vars.delete(name); }
    if (!isOp(',')) throw new ExprError('integral takes (f, a, b)');
    i++;
    if (named) { i++; if (!isOp(',')) throw new ExprError('integral(f, var, a, b)'); i++; }
    const a = cmp();
    if (!isOp(',')) throw new ExprError('integral takes (f, a, b)');
    i++;
    const b = cmp();
    depth--;
    if (!isOp(')')) throw new ExprError('missing )');
    i++;
    return (e) => {
      const env: Record<string, number> = { ...e };
      return integrate((u) => { env[name] = u; return f(env); }, a(e), b(e));
    };
  }

  const f = cmp();
  if (i < toks.length) throw new ExprError(`unexpected "${String(toks[i].v)}"`);
  return f;
}

/**
 * ∫ₐᵇ g by tanh-sinh (double-exponential) quadrature: never evaluates the endpoints, so integrable
 * endpoint singularities are fine. Step halves until two levels agree to ~1e-10 (relative). NaN when a
 * limit is not finite, g is not finite inside, or it doesn't converge.
 */
export function integrate(g: (u: number) => number, a: number, b: number): number {
  if (!Number.isFinite(a) || !Number.isFinite(b)) return NaN;
  if (a === b) return 0;
  const c = (a + b) / 2, r = (b - a) / 2;
  const TMAX = 3.2;
  let bad = false;
  const at = (t: number): number => {
    const u = (Math.PI / 2) * Math.sinh(t), ch = Math.cosh(u);
    const w = ((Math.PI / 2) * Math.cosh(t)) / (ch * ch);
    // 1 - |tanh(u)| = 2/(e^{2|u|}+1): the distance to the end, without cancellation.
    const off = 2 / (Math.exp(2 * Math.abs(u)) + 1);
    const x = t < 0 ? a + (b - a) * (off / 2) : t > 0 ? b - (b - a) * (off / 2) : c;
    if (x === a || x === b || w === 0) return 0; // underflowed onto the end: its weight is ~0
    const y = g(x);
    if (!Number.isFinite(y)) { bad = true; return 0; }
    return w * y;
  };
  let h = 0.5;
  let sum = at(0);
  for (let k = 1; k * h <= TMAX; k++) sum += at(k * h) + at(-k * h);
  let prev = r * h * sum;
  for (let level = 0; level < 8; level++) {
    h /= 2;
    for (let k = 1; k * h <= TMAX; k += 2) sum += at(k * h) + at(-k * h);
    const cur = r * h * sum;
    if (bad) return NaN;
    if (Math.abs(cur - prev) <= 1e-10 * Math.max(1, Math.abs(cur))) return cur;
    prev = cur;
  }
  return bad ? NaN : prev;
}
