// src/desk/expr.ts
/**
 * A tiny safe expression language for `plot fn="…"`. Never uses eval or Function.
 *
 *   expr  := sum
 *   sum   := prod (('+' | '-') prod)*
 *   prod  := unary (('*' | '/') unary | implicit)*      implicit: "2x", "2(x+1)", "x sin(x)", "(x)(x)"
 *   unary := ('-' | '+') unary | power
 *   power := atom ('^' unary)?                           right-assoc; -x^2 = -(x^2); 2^-1 = 0.5
 *   atom  := number | 'x' | 'pi' | func '(' expr ')' | '(' expr ')'
 *   func  := sin | cos | tan | asin | acos | atan | exp | log | ln | sqrt | abs | round | floor | ceil | sign
 *            | rad | deg (degrees ↔ radians)                  (log and ln are natural)
 *            | min | max | mean | sum '(' expr (',' expr)* ')'   (a name with no '(' stays a variable)
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
    const id = /^[a-z]+/i.exec(s.slice(i));
    if (id) { out.push({ t: 'id', v: id[0].toLowerCase() }); i += id[0].length; continue; }
    const cmp = /^(==|!=|<=|>=|<|>|=|≤|≥|≠)/.exec(s.slice(i));
    if (cmp) { out.push({ t: 'op', v: ({ '=': '==', '≤': '<=', '≥': '>=', '≠': '!=' } as Record<string, string>)[cmp[0]] ?? cmp[0] }); i += cmp[0].length; continue; }
    if ('+-*/^(),'.includes(c)) { out.push({ t: 'op', v: c }); i++; continue; }
    throw new ExprError(`unexpected "${c}"`);
  }
  return out;
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
      if (isOp('*') || isOp('/')) {
        const op = toks[i++].v, a = f, b = unary();
        f = op === '*' ? (e) => a(e) * b(e) : (e) => a(e) / b(e);
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

  const f = cmp();
  if (i < toks.length) throw new ExprError(`unexpected "${String(toks[i].v)}"`);
  return f;
}
