// src/script/pointExpr.ts
import type { Pt } from './types';

/**
 * A point argument as the model writes it. Literals stay numbers; everything else is resolved by
 * the engine (src/geometry/figure.ts) when the element is built.
 *   x,y            literal (page: 0–1000 both axes; region: world units, any range when the sketch is `fit`)
 *   X | O′ | x_L   a named point (`{{let}}`, `{{point id=}}`, a line's `id.a` / `id.b`)
 *   #d3            a page mark from the grounding (dots, segment ends, text labels)
 *   mid(A,B)       midpoint
 *   along(A,B,t)   A + t·(B−A): t=0.5 is mid, t=2 doubles the distance from A, t<0 goes backwards
 *   meet(A,B,C,D)  where line AB crosses line CD (both infinite)
 *   foot(P,A,B)    the foot of the perpendicular from P to line AB
 */
export type PtExpr =
  | { ref: string }
  | { fn: 'mid'; args: [PtExpr, PtExpr] }
  | { fn: 'along'; args: [PtExpr, PtExpr]; t: number }
  | { fn: 'meet'; args: [PtExpr, PtExpr, PtExpr, PtExpr] }
  | { fn: 'foot'; args: [PtExpr, PtExpr, PtExpr] };
export type PtArg = Pt | PtExpr;

export const isLiteral = (p: PtArg): p is Pt => 'x' in p;

/** Point names: a letter, then letters, digits, _, primes. Case-sensitive (X and x differ). ' → ′. */
export const NAME = /^[A-Za-zͰ-Ͽ][A-Za-z0-9_Ͱ-Ͽ′″]{0,23}$/u;
/** Page marks from the grounding: #d3, #s1.a, #t12. */
const MARK = /^#[a-z]\d{1,3}(\.[ab])?$/;
const ARITY = { mid: 2, along: 2, meet: 4, foot: 3 } as const;
/** Coordinates beyond this are rejected (literals) or treated as degenerate (constructions). */
export const MAX_ABS = 100_000;

/**
 * A part of a kit block (1-based): `v[3]` a bar or point, `g[2,3]` a cell, `g[1:2,1:3]` cells,
 * `v[2:4]` bars. Resolved by the kit when the element is built (its layout exists only then).
 */
export const BLOCK_REF = /^([A-Za-z][A-Za-z0-9_]{0,23})\[(\d{1,2})(?::(\d{1,2}))?(?:,(\d{1,2})(?::(\d{1,2}))?)?\]$/;
export const isBlockRef = (s: string) => BLOCK_REF.test(s);
/** A parsed block part: rows r0–r1 and columns c0–c1, 0-based inclusive (a vector's index is its column, row 0). */
export type BlockPart = { id: string; r0: number; r1: number; c0: number; c1: number; one?: boolean };
export function blockPart(s: string): BlockPart | null {
  const m = BLOCK_REF.exec(s);
  if (!m) return null;
  const n = (v?: string) => (v == null ? undefined : Number(v));
  const a = n(m[2])!, b = n(m[3]) ?? a, c = n(m[4]), d = n(m[5]) ?? c;
  if (a < 1 || b < a) return null;
  if (c == null) return { id: m[1], r0: 0, r1: 0, c0: a - 1, c1: b - 1, one: true };
  if (c < 1 || d! < c) return null;
  return { id: m[1], r0: a - 1, r1: b - 1, c0: c - 1, c1: d! - 1 };
}

export const normName = (s: string) => s.replace(/'/g, '′').replace(/′′/g, '″');

/** Parses one point argument; null when malformed. `lit` handles literals (the caller clamps pages). */
export function parsePtArg(s: string | undefined, lit: (s: string) => Pt | undefined): PtArg | undefined {
  if (!s) return undefined;
  const t = s.trim();
  if (/^-?\d*\.?\d+,-?\d*\.?\d+$/.test(t)) return lit(t);
  const e = expr(t, 0);
  return e ? e : undefined;
}

function ref(s: string): PtExpr | null {
  if (MARK.test(s)) return { ref: s };
  if (BLOCK_REF.test(s)) return blockPart(s) ? { ref: s } : null;
  const dot = s.match(/^(.+)\.([ab])$/);
  const base = dot ? dot[1] : s;
  const n = normName(base);
  return NAME.test(n) ? { ref: dot ? `${n}.${dot[2]}` : n } : null;
}

/** Splits "a,b,(c,d),e" at top-level commas. */
function splitArgs(s: string): string[] | null {
  const out: string[] = [];
  let depth = 0, cur = '';
  for (const c of s) {
    if (c === '(' || c === '[') depth++;
    if (c === ')' || c === ']') depth--;
    if (depth < 0) return null;
    if (c === ',' && depth === 0) { out.push(cur); cur = ''; } else cur += c;
  }
  if (depth) return null;
  out.push(cur);
  return out.map((x) => x.trim());
}

function expr(s: string, depth: number): PtExpr | null {
  if (depth > 3) return null; // no deep nesting: keeps scripts readable and resolution cheap
  const m = s.match(/^(mid|along|meet|foot)\((.*)\)$/);
  if (!m) return ref(s);
  const fn = m[1] as keyof typeof ARITY;
  const parts = splitArgs(m[2]);
  if (!parts) return null;
  if (fn === 'along') {
    if (parts.length !== 3) return null;
    const t = Number(parts[2]);
    const a = expr(parts[0], depth + 1), b = expr(parts[1], depth + 1);
    return a && b && Number.isFinite(t) && Math.abs(t) <= 20 ? { fn, args: [a, b], t } : null;
  }
  if (parts.length !== ARITY[fn]) return null;
  const args = parts.map((p) => expr(p, depth + 1));
  if (args.some((a) => !a)) return null;
  return { fn, args } as PtExpr;
}

/** Literal in world units: finite and within ±100000 (no clamping; the resolver clamps after fitting). */
export function worldPt(s: string): Pt | undefined {
  const [a, b] = s.split(',').map(Number);
  return Number.isFinite(a) && Number.isFinite(b) && Math.abs(a) <= MAX_ABS && Math.abs(b) <= MAX_ABS ? { x: a, y: b } : undefined;
}
