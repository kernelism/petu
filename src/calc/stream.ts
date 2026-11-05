// src/calc/stream.ts — <calc> programs in a narration stream become the numbers they compute.
/**
 * A script (the model's, or a dev script) may carry calc programs between its sentences:
 *
 *   With four slices the sum is {{val rod.I4}} ...      ← said from the calc's export
 *   <calc id="rod"> const M = 1 ... export const I4 = slices(4); </calc>
 *
 * `withCalcs` runs each program as it closes (sandbox.ts, ~30 ms) and puts in its place one tag,
 * `{{computed id=rod I4=0.078125 out=10,40,40}}`, that carries every number it exported: arrays as
 * comma lists, matrices with `;` between rows, objects as dotted keys (`best.sum=3`). Strings and
 * booleans are not numbers anyone says or draws and are left out. The tag is self-contained, so the
 * parser, the gate and the board all read the same values without running anything again. A program
 * that fails becomes `{{computed id=rod failed="…"}}`: its vals stay unbound (a dash, recorded as a
 * skip), never a guessed number.
 */
import { CalcError, prepareCalc, type CalcResult, type CalcValue } from './prepare';
import { runCalc } from './sandbox';
import { unescapeCalc } from '../svgboard/wire';

/** One exported number list: a scalar, a row, or rows. */
export type CalcNums = number | number[] | number[][];
/** A calc's numbers by dotted name ("I4", "out", "best.sum"). */
export type CalcTable = Record<string, CalcNums>;

const fmtNum = (x: number) => (Number.isFinite(x) ? String(x) : 'NaN');

/** A result's numbers, flattened to dotted names. */
export function calcNumbers(values: Record<string, CalcValue>): CalcTable {
  const out: CalcTable = {};
  const isRow = (v: CalcValue): v is number[] => Array.isArray(v) && v.every((x) => typeof x === 'number');
  const walk = (v: CalcValue, name: string) => {
    if (typeof v === 'number') { out[name] = v; return; }
    if (isRow(v)) { out[name] = v; return; }
    if (Array.isArray(v) && v.length && v.every(isRow)) { out[name] = v as number[][]; return; }
    if (Array.isArray(v)) { v.forEach((x, i) => walk(x, `${name}[${i}]`)); return; }
    if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) walk(x, `${name}.${k}`);
  };
  for (const [k, v] of Object.entries(values)) walk(v, k);
  return out;
}

/** The tag that stands for a run calc. */
/** A computed tag carries at most this many numbers (it must stay one wire tag, under SVG_TAG_MAX). */
export const MAX_TAG_NUMBERS = 2000;

export function computedTag(r: CalcResult): string {
  let left = MAX_TAG_NUMBERS;
  const entries = Object.entries(calcNumbers(r.values)).flatMap(([k, v]): [string, CalcNums][] => {
    const n = typeof v === 'number' ? 1 : (v as (number | number[])[]).flat().length;
    if (n > left) { console.warn(`[calc] ${r.id}.${k} left out: over ${MAX_TAG_NUMBERS} numbers in one calc`); return []; }
    left -= n;
    return [[k, v]];
  });
  const parts = entries.map(([k, v]) => {
    const s = typeof v === 'number' ? fmtNum(v) : Array.isArray(v[0]) ? (v as number[][]).map((row) => row.map(fmtNum).join(',')).join(';') : (v as number[]).map(fmtNum).join(',');
    return `${k}=${s}`;
  });
  return `{{computed id=${r.id} ${parts.join(' ')}}}`;
}

/** A computed tag's body (`computed id=rod I4=0.078125 out=1,2`) back to numbers. Null when malformed. */
export function readComputed(body: string): { id: string; values: CalcTable; failed?: string } | null {
  const m = /^\s*computed\s+id=([A-Za-z][A-Za-z0-9_]{0,23})(?:\s+(.*))?$/s.exec(body);
  if (!m) return null;
  const id = m[1], rest = (m[2] ?? '').trim();
  const failed = /^failed="([^"]*)"$/.exec(rest);
  if (failed) return { id, values: {}, failed: failed[1] };
  const values: CalcTable = {};
  for (const pair of rest ? rest.split(/\s+/) : []) {
    const eq = pair.indexOf('=');
    if (eq <= 0) return null;
    const k = pair.slice(0, eq), s = pair.slice(eq + 1);
    if (!/^[A-Za-z_][\w.[\]]{0,60}$/.test(k) || !/^[-+0-9.eNa,;]+$/.test(s)) return null;
    const rows = s.split(';').map((row) => row.split(',').map(Number));
    values[k] = s.includes(';') ? rows : s.includes(',') ? rows[0] : rows[0][0];
  }
  return { id, values };
}

/** A value by path in a calc table: "I4", "out[2]", "P[1][2]", "best.sum". Undefined when absent. */
export function pickNumber(t: CalcTable, path: string): number | undefined {
  if (!(path in t)) {
    // Names are matched without case: a tag's bare words reach the parser lowercased ({{val rod.I4}}).
    const low = path.toLowerCase();
    const k = Object.keys(t).find((n) => low === n.toLowerCase() || low.startsWith(`${n.toLowerCase()}[`));
    if (k) path = k + path.slice(k.length);
  }
  if (path in t) { const v = t[path]; return typeof v === 'number' ? v : undefined; }
  // The longest name the path starts with, then its indexes.
  const names = Object.keys(t).filter((k) => path.startsWith(k) && path[k.length] === '[').sort((a, b) => b.length - a.length);
  for (const k of names) {
    const idx = [...path.slice(k.length).matchAll(/\[(\d+)\]/g)].map((m) => Number(m[1]));
    if (path.slice(k.length).replace(/\[\d+\]/g, '') !== '') continue;
    let v: CalcNums | undefined = t[k];
    for (const i of idx) v = Array.isArray(v) ? (v as (number | number[])[])[i] as CalcNums : undefined;
    if (typeof v === 'number') return v;
  }
  return undefined;
}

const OPEN = /<calc\s+id\s*=\s*["']?([A-Za-z][A-Za-z0-9_]{0,23})["']?\s*>/;
const CLOSE = '</calc>';

/**
 * The stream with each closed <calc>…</calc> replaced by its computed tag (or a failed one). Text
 * before a calc passes through at once; the stream holds only while a calc is open or running.
 */
export async function* withCalcs(src: AsyncIterable<string>, run: (id: string, code: string) => Promise<CalcResult> = (id, code) => runCalc(prepareCalc(id, code))): AsyncIterable<string> {
  let buf = '';
  const runOne = async (id: string, code: string): Promise<string> => {
    try { return ` ${computedTag(await run(id, code))} `; }
    catch (e) {
      const why = (e instanceof CalcError ? e.message : String(e)).replace(/["\n]/g, ' ').slice(0, 160);
      console.warn('[calc]', why);
      return ` {{computed id=${id} failed="${why}"}} `;
    }
  };
  const step = async function* (final: boolean): AsyncGenerator<string> {
    for (;;) {
      // A calc as written (<calc id="rod">…</calc>, a dev script) or as the server filter sends it ({{calcsrc id=rod …}}).
      // "<calc" then a space or ">": not the narration's "<calculus".
      const raw = buf.search(/<calc[\s>]/), wire = buf.indexOf('{{calcsrc');
      const at = raw < 0 ? wire : wire < 0 ? raw : Math.min(raw, wire);
      if (at < 0) {
        // Keep a tail that may be the start of either, split across chunks.
        let keep = 0;
        if (!final) for (let n = Math.min(8, buf.length); n > 0; n--) { const t = buf.slice(-n); if ('<calc '.startsWith(t) || '{{calcsrc'.startsWith(t)) { keep = n; break; } }
        const out = buf.slice(0, buf.length - keep);
        buf = buf.slice(buf.length - keep);
        if (out) yield out;
        return;
      }
      if (at > 0) { yield buf.slice(0, at); buf = buf.slice(at); }
      if (buf.startsWith('{{calcsrc')) {
        const end = buf.indexOf('}}');
        if (end < 0) { if (final) { console.warn('[calc] dropped a calc the stream cut off'); buf = ''; } return; }
        const body = buf.slice('{{calcsrc'.length, end);
        buf = buf.slice(end + 2);
        const m = /^\s+id=([A-Za-z][A-Za-z0-9_]{0,23})\s([\s\S]*)$/.exec(body);
        if (!m) { console.warn('[calc] a calc with no id:', body.slice(0, 40)); continue; }
        yield await runOne(m[1], unescapeCalc(m[2]));
        continue;
      }
      const end = buf.indexOf(CLOSE);
      if (end < 0) {
        if (final) { console.warn('[calc] dropped a calc the stream cut off'); buf = ''; }
        return;
      }
      const whole = buf.slice(0, end);
      buf = buf.slice(end + CLOSE.length);
      const m = OPEN.exec(whole);
      if (!m || m.index !== 0) { console.warn('[calc] a calc with no id:', whole.slice(0, 40)); continue; }
      yield await runOne(m[1], whole.slice(m[0].length));
    }
  };
  for await (const chunk of src) { buf += chunk; yield* step(false); }
  yield* step(true);
}
