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
 *   func  := sin | cos | exp | log | sqrt | abs          (log is natural)
 *
 * Accepts × · for *, ÷ for /, − for -, π for pi, and ** for ^.
 */
export type Fn = (x: number) => number;

export class ExprError extends Error {}

const FUNCS: Record<string, (v: number) => number> = {
  sin: Math.sin, cos: Math.cos, exp: Math.exp, log: Math.log, sqrt: Math.sqrt, abs: Math.abs,
};
export const MAX_EXPR_CHARS = 120;
const MAX_DEPTH = 32;

type Tok = { t: 'num'; v: number } | { t: 'id'; v: string } | { t: 'op'; v: string };

function lex(src: string): Tok[] {
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
    if ('+-*/^()'.includes(c)) { out.push({ t: 'op', v: c }); i++; continue; }
    throw new ExprError(`unexpected "${c}"`);
  }
  return out;
}

/** Compiles `src` into a function of x. Throws ExprError on anything outside the grammar. */
export function compile(src: string): Fn {
  if (src.length > MAX_EXPR_CHARS) throw new ExprError('too long');
  const toks = lex(src);
  if (!toks.length) throw new ExprError('empty');
  let i = 0;
  let depth = 0;
  const peek = () => toks[i];
  const isOp = (v: string) => peek()?.t === 'op' && peek()!.v === v;
  const enter = () => { if (++depth > MAX_DEPTH) throw new ExprError('too deep'); };
  const startsAtom = () => { const k = peek(); return !!k && (k.t === 'num' || k.t === 'id' || (k.t === 'op' && k.v === '(')); };

  const sum = (): Fn => {
    let f = prod();
    while (isOp('+') || isOp('-')) {
      const op = toks[i++].v, a = f, b = prod();
      f = op === '+' ? (x) => a(x) + b(x) : (x) => a(x) - b(x);
    }
    return f;
  };
  const prod = (): Fn => {
    let f = unary();
    for (;;) {
      if (isOp('*') || isOp('/')) {
        const op = toks[i++].v, a = f, b = unary();
        f = op === '*' ? (x) => a(x) * b(x) : (x) => a(x) / b(x);
      } else if (startsAtom()) {
        const a = f, b = power();
        f = (x) => a(x) * b(x);
      } else return f;
    }
  };
  const unary = (): Fn => {
    enter();
    try {
      if (isOp('-')) { i++; const a = unary(); return (x) => -a(x); }
      if (isOp('+')) { i++; return unary(); }
      return power();
    } finally { depth--; }
  };
  const power = (): Fn => {
    const base = atom();
    if (!isOp('^')) return base;
    i++;
    const e = unary();
    return (x) => Math.pow(base(x), e(x));
  };
  const atom = (): Fn => {
    const k = toks[i++];
    if (!k) throw new ExprError('unexpected end');
    if (k.t === 'num') { const v = k.v; return () => v; }
    if (k.t === 'op' && k.v === '(') {
      enter();
      const f = sum();
      depth--;
      if (!isOp(')')) throw new ExprError('missing )');
      i++;
      return f;
    }
    if (k.t === 'id') {
      if (k.v === 'x') return (x) => x;
      if (k.v === 'pi') return () => Math.PI;
      const fn = FUNCS[k.v];
      if (!fn) throw new ExprError(`unknown name "${k.v}"`);
      if (!isOp('(')) throw new ExprError(`${k.v} needs (`);
      i++;
      enter();
      const a = sum();
      depth--;
      if (!isOp(')')) throw new ExprError('missing )');
      i++;
      return (x) => fn(a(x));
    }
    throw new ExprError(`unexpected "${k.v}"`);
  };

  const f = sum();
  if (i < toks.length) throw new ExprError(`unexpected "${String(toks[i].v)}"`);
  return f;
}
