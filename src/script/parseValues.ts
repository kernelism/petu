// src/script/parseValues.ts — gated beats, step 2: bound numbers ({{val}}), named readouts
// ({{find}}) and demonstration moves ({{contrast}}, {{limit}}, {{beforeafter}}). See types.ts.
//
//   The total is {{val id=s}}, about {{val id=r as=percent}} of the budget.
//   {{find id=E of=demand,supply}} They meet at a price of {{val id=E}}.
//   {{find id=top of=path max}} {{point on=s at=top "highest"}}
//   {{contrast of=path v=30 "faster"}}  {{limit of=path k=0 dur=4 show=top}}  {{beforeafter of=v rate=0.1}}
import type { FindAction, FindMode, MoveAction, ValAction } from './types';
import { normName, NAME } from './pointExpr';

/** A value reference: an id, optionally a part (`[2]`, `[1,2]`), optionally a field (`.x`, `.c`, `.price`). */
const VAL_REF = /^([A-Za-z][A-Za-z0-9_′]{0,23})(\[\d{1,2}(?:,\d{1,2})?\])?(?:\.([A-Za-z_][A-Za-z0-9_ ]{0,23}))?$/;
const FORMULA = /^[A-Za-z0-9_.+\-*/^() ]{1,60}$/;
const MAX_LABEL = 40;

const ref = (s?: string) => {
  if (!s) return undefined;
  const t = normName(s.trim().replace(/-/g, '_'));
  return VAL_REF.test(t) ? t : undefined;
};
const eid = (s?: string) => { const n = s ? normName(s.trim().replace(/-/g, '_')) : ''; return n && NAME.test(n) ? n : undefined; };
const formula = (s?: string) => (s != null && FORMULA.test(s.trim()) ? s.trim() : undefined);
const num = (s?: string) => (s == null || s === '' ? undefined : Number.isFinite(Number(s)) ? Number(s) : undefined);

export function parseVal(args: Record<string, string>): ValAction | null {
  const r = ref(args.id);
  if (!r) return null;
  const fmt = num(args.fmt ?? args.dp);
  if ((args.fmt ?? args.dp) != null && !(fmt != null && Number.isInteger(fmt) && fmt >= 0 && fmt <= 6)) return null;
  const as = args.as?.toLowerCase();
  if (as != null && as !== 'percent' && as !== 'abs') return null;
  // x=: the plot's value at x (a slip for {{find … x=}}); a field other than .x/.y, or a part, is no plot.
  const x = args.x != null ? formula(args.x) : undefined;
  if (args.x != null && (x == null || r.includes('[') || !/^[^.]+(\.[xy])?$/.test(r))) return null;
  return { kind: 'val', ref: r, ...(x != null ? { x } : {}), ...(fmt != null ? { fmt } : {}), ...(as ? { as: as as 'percent' | 'abs' } : {}) };
}

export function parseFind(args: Record<string, string>, flags: Set<string>): FindAction | null {
  const id = eid(args.id);
  const of = args.of?.split(',').map((s) => eid(s));
  if (!id || !of || !of.length || of.length > 2 || of.some((x) => !x)) return null;
  const base = { kind: 'find' as const, id, of: of as string[] };
  const bad = (k: string) => args[k] != null && formula(args[k]) == null;
  if (['x', 'level', 'from', 'to'].some(bad)) return null;
  let mode: FindMode;
  if (args.inside != null) {
    const w = num(args.inside);
    if (!(w != null && w > 0) || of.length !== 1) return null;
    return { ...base, mode: 'inside', w };
  }
  if (flags.has('residual') || args.residual != null) {
    const k = num(args.residual);
    if (args.residual != null && !(k != null && Number.isInteger(k) && k >= 1)) return null;
    return { ...base, mode: 'residual', ...(k != null ? { point: k } : {}) };
  }
  if (flags.has('area')) mode = 'area';
  else if (flags.has('slope')) { if (args.x == null) return null; mode = 'slope'; }
  else if (args.x != null) mode = 'at';
  else if (args.level != null) mode = 'level';
  else if (flags.has('max')) mode = 'max';
  else if (flags.has('min')) mode = 'min';
  else if (of.length === 2) mode = 'cross';
  else return null;
  if ((mode === 'cross') !== (of.length === 2) && mode !== 'area') return null;
  const n = num(args.n);
  if (args.n != null && !(n != null && Number.isInteger(n) && n >= 1 && n <= 9)) return null;
  const opt = (k: 'x' | 'level' | 'from' | 'to') => (args[k] != null ? { [k]: formula(args[k]) } : {});
  return { ...base, mode, ...opt('x'), ...opt('level'), ...opt('from'), ...opt('to'), ...(n != null ? { n } : {}) };
}

const MOVE_KEYS = new Set(['of', 'id', 'dur', 'show']);

export function parseMove(name: 'contrast' | 'limit' | 'beforeafter', rawArgs: Record<string, string>, quotes: string[]): MoveAction | null {
  const r = eid(rawArgs.of);
  if (!r) return null;
  const sets = Object.entries(rawArgs).filter(([k]) => !MOVE_KEYS.has(k.toLowerCase()));
  if (sets.length !== 1) return null;
  const [k, v] = sets[0];
  const val = formula(v);
  if (!/^[A-Za-z][A-Za-z0-9_]{0,15}$/.test(k) || !val) return null;
  const text = quotes[0]?.trim() ? quotes[0].trim().slice(0, MAX_LABEL) : undefined;
  const set: [string, string] = [k, val];
  if (name === 'contrast') {
    const id = rawArgs.id != null ? eid(rawArgs.id) : undefined;
    if (rawArgs.id != null && !id) return null;
    return { kind: 'contrast', ref: r, set, ...(id ? { id } : {}), ...(text ? { text } : {}) };
  }
  if (name === 'limit') {
    const dur = num(rawArgs.dur);
    if (rawArgs.dur != null && !(dur != null && dur > 0 && dur <= 20)) return null;
    const show = rawArgs.show != null ? eid(rawArgs.show) : undefined;
    if (rawArgs.show != null && !show) return null;
    return { kind: 'limit', ref: r, set, ...(dur != null ? { dur } : {}), ...(show ? { show } : {}) };
  }
  return { kind: 'beforeafter', ref: r, set, ...(text ? { text } : {}) };
}
