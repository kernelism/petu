// src/locate/unit.ts
import type { PageRect } from '../geometry/space';
import { textLines, type TextLine } from '../agent/context/textLines';
import { findQuote, quoteKey, rangeRects, type LocateOpts, type PageIndex, type TextRun } from './locateQuote';

/**
 * Highlights mark meaningful units (spec "Flow across the document"): a quote that is a fragment of
 * a sentence, line, bullet or equation grows to the unit that contains it; the quoted words keep an
 * inner emphasis. A symbol or a short term (≤ TERM_WORDS words) stays as quoted.
 */

/** Quotes of this many words or fewer are a symbol or a term: they stay as quoted. */
export const TERM_WORDS = 2;
/** A sentence longer than this (characters, or lines) is too much to mark: the hit's whole lines instead. */
const MAX_SENTENCE_CHARS = 280;
const MAX_SENTENCE_LINES = 3;
/** The quoted words get an inner emphasis while they are at most this share of the unit. */
const INNER_SHARE = 0.6;
/** A block (paragraph or bullet) never grows past this many lines. */
const MAX_BLOCK_LINES = 12;

export type UnitPiece = { quote: string; near: { x: number; y: number } };
/**
 * `pieces`: the unit, one quote per line (each resolves exactly on its own line); `inner`: the quoted
 * words, to emphasise inside it (null when they are most of the unit).
 */
export type Unit = { kind: 'sentence' | 'line' | 'equation'; text: string; pieces: UnitPiece[]; inner: UnitPiece | null };

const BULLET = /^\s*(?:[-–—•▪●◦‣∙·*►▸]|\(?\d{1,2}[.)]|\(?[a-z][.)]|\(?[ivx]{1,4}[.)])\s/i;
export const isBullet = (s: string) => BULLET.test(s);
const ABBREV = new Set(['e.g', 'i.e', 'eg', 'ie', 'etc', 'vs', 'fig', 'figs', 'eq', 'eqs', 'cf', 'al', 'approx', 'resp', 'no', 'sec', 'ch', 'pp', 'p', 'ref', 'thm', 'def', 'dr', 'mr', 'ms', 'st']);

const centre = (r: PageRect) => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 });
const words = (s: string) => (s.match(/[\p{L}\p{N}]+/gu) ?? []).length;

/** Each line's [start, end) in the page index (lines are contiguous there: the index is built in line order). */
function lineRanges(ix: PageIndex, lines: TextLine[]): ([number, number] | null)[] {
  const lineOf = new Map<TextRun, number>();
  lines.forEach((l, k) => l.runs.forEach((r) => lineOf.set(r, k)));
  const out: ([number, number] | null)[] = lines.map(() => null);
  ix.map.forEach((slot, i) => {
    if (slot.ch < 0) return;
    const k = lineOf.get(ix.runs[slot.run]);
    if (k == null) return;
    const r = out[k];
    out[k] = r ? [Math.min(r[0], i), Math.max(r[1], i + 1)] : [i, i + 1];
  });
  return out;
}

/** The paragraph or bullet around `seed` lines: neighbours of the same size, overlapping in x, close below/above. */
function block(lines: TextLine[], seed: number[]): number[] {
  const set = new Set(seed);
  const hs = seed.map((k) => lines[k].rect.h).sort((a, b) => a - b);
  const h = hs[Math.floor(hs.length / 2)];
  const span = () => {
    const ls = [...set].map((k) => lines[k].rect);
    return { x0: Math.min(...ls.map((r) => r.x)), x1: Math.max(...ls.map((r) => r.x + r.w)), y0: Math.min(...ls.map((r) => r.y)), y1: Math.max(...ls.map((r) => r.y + r.h)) };
  };
  const fits = (l: TextLine, s: ReturnType<typeof span>) =>
    !l.math && !l.runs[0]?.vertical && l.rect.h >= 0.8 * h && l.rect.h <= 1.25 * h && l.rect.x < s.x1 && l.rect.x + l.rect.w > s.x0;
  const top = () => [...set].reduce((a, k) => (lines[k].rect.y < lines[a].rect.y ? k : a));
  for (let guard = 0; set.size < MAX_BLOCK_LINES && guard < MAX_BLOCK_LINES; guard++) {
    const s = span();
    const below = lines.map((l, k) => ({ l, k })).filter(({ l, k }) => !set.has(k) && l.rect.y > s.y1 - 0.3 * h && l.rect.x < s.x1 && l.rect.x + l.rect.w > s.x0)
      .sort((a, b) => a.l.rect.y - b.l.rect.y)[0];
    if (!below || !fits(below.l, s) || below.l.rect.y - s.y1 > 0.9 * h || isBullet(below.l.text)) break;
    set.add(below.k);
  }
  for (let guard = 0; set.size < MAX_BLOCK_LINES && guard < MAX_BLOCK_LINES; guard++) {
    if (isBullet(lines[top()].text)) break;
    const s = span();
    const above = lines.map((l, k) => ({ l, k })).filter(({ l, k }) => !set.has(k) && l.rect.y + l.rect.h < s.y0 + 0.3 * h && l.rect.x < s.x1 && l.rect.x + l.rect.w > s.x0)
      .sort((a, b) => b.l.rect.y - a.l.rect.y)[0];
    if (!above || !fits(above.l, s) || s.y0 - (above.l.rect.y + above.l.rect.h) > 0.9 * h) break;
    set.add(above.k);
  }
  return [...set].sort((a, b) => lines[a].rect.y - lines[b].rect.y);
}

type Ch = { c: string; pos: number; upper: boolean };

/**
 * The meaningful unit around `quote` on a page, or null when the quote should stay as it is (a
 * symbol, a short term, already a whole unit, or not found).
 */
export function meaningfulUnit(pageRuns: TextRun[], quote: string, near?: { x: number; y: number }, opts: LocateOpts = {}): Unit | null {
  if (words(quoteKey(quote)) <= TERM_WORDS) return null;
  const hit = findQuote(pageRuns, quote, near, opts);
  // A guess without a position is no hit (locateQuote): growing it would mark a sentence nobody quoted.
  if (!hit || (hit.fuzzy && !near)) return null;
  const ix = hit.index;
  const [hs, he] = hit.range;
  const lines = textLines(pageRuns, opts.aspect ?? 1);
  const ranges = lineRanges(ix, lines);
  const hitLines = lines.map((_, k) => k).filter((k) => { const r = ranges[k]; return !!r && r[0] < he && r[1] > hs; });
  if (!hitLines.length) return null;

  const piecesOf = (us: number, ue: number, ks: number[]): UnitPiece[] => ks.flatMap((k) => {
    const r = ranges[k]!;
    let s = Math.max(us, r[0]), e = Math.min(ue, r[1]);
    while (s < e && ix.text[s] === ' ') s++;
    while (e > s && ix.text[e - 1] === ' ') e--;
    if (e <= s) return [];
    const rects = rangeRects(ix, [s, e], opts);
    return rects.length ? [{ quote: ix.text.slice(s, e), near: centre(rects[0]) }] : [];
  });
  const finish = (kind: Unit['kind'], us: number, ue: number, ks: number[]): Unit | null => {
    if (us >= hs && ue <= he) return null; // the quote is the unit already
    const pieces = piecesOf(us, ue, ks);
    if (!pieces.length) return null;
    const text = pieces.map((p) => p.quote).join(' ');
    const inner = he - hs <= INNER_SHARE * text.length ? { quote, near: centre(hit.rects[0]) } : null;
    return { kind, text, pieces, inner };
  };
  const wholeLines = (kind: Unit['kind'], ks: number[]) =>
    finish(kind, Math.min(...ks.map((k) => ranges[k]![0])), Math.max(...ks.map((k) => ranges[k]![1])), ks);

  // An equation: the whole equation line(s).
  if (hitLines.some((k) => lines[k].math)) return wholeLines('equation', hitLines);

  // The paragraph or bullet, as one character stream (lines joined by a space), with each
  // character's case from the page (the index is lowercase).
  const ks = block(lines, hitLines);
  const chars: Ch[] = [];
  const glyphs = new Map<number, string[]>();
  for (const k of ks) {
    const r = ranges[k];
    if (!r) continue;
    if (chars.length) chars.push({ c: ' ', pos: -1, upper: false });
    for (let i = r[0]; i < r[1]; i++) {
      const slot = ix.map[i];
      let g = glyphs.get(slot.run);
      if (!g) glyphs.set(slot.run, (g = Array.from(ix.runs[slot.run].text)));
      const o = slot.ch >= 0 ? g[slot.ch] ?? '' : '';
      chars.push({ c: ix.text[i], pos: i, upper: /[\p{Lu}\p{N}]/u.test(o) });
    }
  }
  const bs = chars.findIndex((c) => c.pos >= hs);
  let be = -1;
  chars.forEach((c, j) => { if (c.pos >= 0 && c.pos < he) be = j + 1; });
  if (bs < 0 || be < 0) return wholeLines('line', hitLines);

  const wordBefore = (j: number) => { let s = j; while (s > 0 && /[\p{L}\p{N}.]/u.test(chars[s - 1].c)) s--; return chars.slice(s, j).map((c) => c.c).join(''); };
  /** A sentence starts at j: ". " before it, a capital or digit at it, and no abbreviation or initial before the stop. */
  const startsAt = (j: number) => {
    if (j < 2 || j >= chars.length || chars[j - 1].c !== ' ' || !/[.!?]/.test(chars[j - 2].c) || !chars[j].upper) return false;
    const w = wordBefore(j - 2).replace(/\.$/, '');
    return w.length > 1 && !ABBREV.has(w);
  };
  let start = 0;
  for (let j = bs; j > 0; j--) if (startsAt(j)) { start = j; break; }
  let end = chars.length;
  for (let j = Math.max(be - 1, start); j < chars.length; j++) {
    if (/[.!?]/.test(chars[j].c) && (j + 1 === chars.length || startsAt(j + 2))) { end = j + 1; break; }
  }
  const pos = chars.slice(start, end).filter((c) => c.pos >= 0);
  const us = pos[0].pos, ue = pos[pos.length - 1].pos + 1;
  const sentLines = ks.filter((k) => { const r = ranges[k]; return !!r && r[0] < ue && r[1] > us; });
  if (end - start > MAX_SENTENCE_CHARS || sentLines.length > MAX_SENTENCE_LINES) return wholeLines('line', hitLines);
  return finish('sentence', us, ue, sentLines);
}
