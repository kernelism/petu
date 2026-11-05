// src/calc/prepare.ts — a <calc> program, read: every computed number comes from code the engine runs,
// never from the model's head (docs/briefs/proposals/teaching-engine.md §0).
/**
 * The model writes plain JavaScript and marks what the board and the narration may name:
 *
 *   <calc id="rod">
 *     const M = 1, L = 1;
 *     const slices = n => { let I = 0; for (let i = 0; i < n; i++) { const x = -L/2 + (i + .5) * L/n; I += x*x * M/n; } return I; };
 *     export const I4 = slices(4), I10 = slices(10);
 *     export function at(n) { return slices(n); }      (functions are not values: not exported)
 *   </calc>
 *
 * This module only reads the source: it strips `export`, collects the exported names and builds the
 * body of a function that returns them. Running it is the sandbox's job (sandbox.ts), and so is
 * keeping it from the network: the source check here is the first fence, not the only one.
 * Pure, no DOM.
 */

export const MAX_CALC_CHARS = 6000;
export const MAX_EXPORTS = 60;

export class CalcError extends Error {}

/** A program read: the function body to run, and the names it exports (in order). */
export type Prepared = { id: string; body: string; names: string[] };

/**
 * Words a program never needs and an escape would: module loading, string evaluation, the realm's
 * globals, prototype surgery. Matched as whole words outside nothing (strings included: a program
 * has no reason to spell them).
 */
const BANNED = /\b(import|eval|Function|constructor|__proto__|prototype|globalThis|self|window|this|with|fetch|XMLHttpRequest|WebSocket|importScripts|postMessage|setTimeout|setInterval|queueMicrotask|Worker|Proxy|Reflect|WebAssembly|async|await|yield|require|process|arguments)\b/;

const ID = /^[A-Za-z][A-Za-z0-9_]{0,23}$/;

/** `src` (the text between <calc id> and </calc>) as a runnable body. Throws CalcError with a repair-ready message. */
export function prepareCalc(id: string, src: string): Prepared {
  if (!ID.test(id)) throw new CalcError(`calc id "${id}" must be a name (letters, digits, _)`);
  if (src.length > MAX_CALC_CHARS) throw new CalcError(`calc ${id} is ${src.length} characters (max ${MAX_CALC_CHARS})`);
  src = stripComments(src);
  const bad = src.match(BANNED);
  if (bad) throw new CalcError(`calc ${id} uses "${bad[1]}", which a calc may not use`);
  if (/`/.test(src)) throw new CalcError(`calc ${id}: template strings are not allowed`);
  const names: string[] = [];
  const add = (n: string) => {
    if (!ID.test(n)) throw new CalcError(`calc ${id}: export name "${n}" must be a plain name`);
    if (!names.includes(n)) names.push(n);
  };
  let body = src.replace(/\bexport\s+(?:const|let|var)\s+([^;]*)/g, (_m, decl: string) => {
    for (const n of topNames(decl)) add(n);
    return `const ${decl}`;
  });
  body = body.replace(/\bexport\s+function\s+/g, 'function ');
  body = body.replace(/\bexport\s*\{([^}]*)\}\s*;?/g, (_m, list: string) => {
    for (const n of list.split(',').map((s) => s.trim()).filter(Boolean)) add(n);
    return '';
  });
  if (/\bexport\b/.test(body)) throw new CalcError(`calc ${id}: write exports as "export const name = …"`);
  if (!names.length) throw new CalcError(`calc ${id} exports nothing (write "export const name = …")`);
  if (names.length > MAX_EXPORTS) throw new CalcError(`calc ${id} exports ${names.length} names (max ${MAX_EXPORTS})`);
  return { id, body: `"use strict";\n${body}\n;return { ${names.map((n) => `${JSON.stringify(n)}: ${n}`).join(', ')} };`, names };
}

/** `src` without its comments (a comment's words are not code: "with" in "// sum with weights"); strings kept as written. */
export function stripComments(src: string): string {
  let out = '', i = 0, q = '';
  while (i < src.length) {
    const c = src[i];
    if (q) { out += c; if (c === '\\') { out += src[i + 1] ?? ''; i += 2; continue; } if (c === q) q = ''; i++; continue; }
    if (c === '"' || c === "'") { q = c; out += c; i++; continue; }
    if (c === '/' && src[i + 1] === '/') { while (i < src.length && src[i] !== '\n') i++; continue; }
    if (c === '/' && src[i + 1] === '*') { const e = src.indexOf('*/', i + 2); i = e < 0 ? src.length : e + 2; out += ' '; continue; }
    out += c; i++;
  }
  return out;
}

/** The names a declaration list binds at its top level: "a = 1, b = f(2, 3), c" → a, b, c. */
function topNames(decl: string): string[] {
  const out: string[] = [];
  let depth = 0, start = 0;
  const parts: string[] = [];
  for (let i = 0; i < decl.length; i++) {
    const c = decl[i];
    if (c === '(' || c === '[' || c === '{') depth++;
    else if (c === ')' || c === ']' || c === '}') depth--;
    else if (c === ',' && depth === 0) { parts.push(decl.slice(start, i)); start = i + 1; }
  }
  parts.push(decl.slice(start));
  for (const p of parts) {
    const m = p.trim().match(/^([A-Za-z_$][\w$]*)/);
    if (m) out.push(m[1]);
  }
  return out;
}

/** A calc's exports, checked: numbers, short strings, booleans, and arrays / plain objects of them. */
export type CalcValue = number | string | boolean | CalcValue[] | { [k: string]: CalcValue };
export type CalcResult = { id: string; values: Record<string, CalcValue> };

export const MAX_LEAVES = 20000;
const MAX_DEPTH = 4;

/** Checks what a run returned (it crossed a structured clone; anything else is the program's mistake). */
export function checkValues(id: string, raw: unknown): Record<string, CalcValue> {
  if (!raw || typeof raw !== 'object') throw new CalcError(`calc ${id} returned nothing`);
  let leaves = 0;
  const walk = (v: unknown, path: string, d: number): CalcValue => {
    if (++leaves > MAX_LEAVES) throw new CalcError(`calc ${id} exports more than ${MAX_LEAVES} values`);
    if (typeof v === 'number') return v;
    if (typeof v === 'boolean') return v;
    if (typeof v === 'string') { if (v.length > 120) throw new CalcError(`calc ${id}: ${path} is a string over 120 characters`); return v; }
    if (d >= MAX_DEPTH) throw new CalcError(`calc ${id}: ${path} is nested too deep`);
    if (Array.isArray(v)) return v.map((x, i) => walk(x, `${path}[${i}]`, d + 1));
    if (v && typeof v === 'object') {
      const o: Record<string, CalcValue> = {};
      for (const [k, x] of Object.entries(v)) o[k] = walk(x, `${path}.${k}`, d + 1);
      return o;
    }
    throw new CalcError(`calc ${id}: ${path} is ${v === undefined ? 'undefined' : typeof v} (export numbers, arrays or objects of numbers)`);
  };
  const out: Record<string, CalcValue> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) out[k] = walk(v, k, 0);
  return out;
}

/**
 * A value by path: "out[3]", "out.3", "P[1][2]", "best.sum". Undefined when absent. Paths are what the
 * board and the narration write after the calc's id ({{val rod.I4}}, `{box.out[2]}`).
 */
export function pick(values: Record<string, CalcValue>, path: string): CalcValue | undefined {
  const keys = path.replace(/\[(\d+)\]/g, '.$1').split('.').filter(Boolean);
  let v: CalcValue | undefined = values;
  for (const k of keys) {
    if (v == null || typeof v !== 'object') return undefined;
    v = Array.isArray(v) ? v[Number(k)] : (v as Record<string, CalcValue>)[k];
  }
  return v;
}
