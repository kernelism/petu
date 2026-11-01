// src/svgboard/prose.ts — sentences written on the board are removed before a group is checked or drawn.
/**
 * The board holds labels (a name on a drawn thing, a number on what it measures, a title); the voice
 * holds the reasoning. A model that writes its conclusion on the board as a sentence, or as lines of
 * words stacked under each other, leaves prose beside the figure (founder, 2026-10-31: "random lines
 * of text that I don't even know why they're there"). The prompt forbids it (p6.8); this removes what
 * slips through, in the gate and the renderer alike (polish.ts prepareText), so the geometry checked
 * is the geometry drawn.
 *  - a one-line text of WORDS_LINE words or more is a sentence, unless it is the group's title (its
 *    largest text, above every other text of the group);
 *  - a stack of STACK_LINES lines or more (texts at one x and anchor, a line's pitch apart, or one
 *    text's positioned tspans) with that many lines of WORDS_STACK words or more is prose: the whole
 *    stack goes. Short stacked labels (a legend, a list of times, a card's figures) stay.
 * Words are runs of two or more letters: numbers, units and symbols never count.
 */
import { I, mul, parseTransform, type M } from './check';

/** A single line with this many words is a sentence. */
export const WORDS_LINE = 7;
/** In a stack, a line with this many words is a line of prose. */
export const WORDS_STACK = 3;
/** A stack is this many lines or more. */
export const STACK_LINES = 3;
/** Lines closer than this many font sizes apart are one stack. */
const PITCH = 1.8;

const num = (v: string | null | undefined, d = 0): number => { const n = v == null ? NaN : parseFloat(v); return Number.isFinite(n) ? n : d; };
const tag = (e: Element) => e.nodeName.toLowerCase().replace(/^svg:/, '');
const inherit = (el: Element, a: string): string | null => { for (let e: Element | null = el; e; e = e.parentElement) { const v = e.getAttribute(a); if (v != null) return v; } return null; };
const matOf = (el: Element, root: Element): M => { const chain: Element[] = []; for (let e: Element | null = el; e && e !== root.parentElement; e = e.parentElement) chain.unshift(e); return chain.reduce((m, e) => mul(m, parseTransform(e.getAttribute('transform'))), I); };

/** Words in a label: runs of two or more letters. */
export const wordCount = (s: string): number => (s.match(/\p{L}{2,}/gu) ?? []).length;

type Line = { el: Element; x: number; y: number; fs: number; anchor: string; words: number };

const positioned = (s: Element) => s.hasAttribute('x') || s.hasAttribute('y') || s.hasAttribute('dy');

/** The lines a text sets: itself, or each tspan placed on its own line. */
function linesOf(el: Element, root: Element): Line[] {
  const m = matOf(el, root);
  const fs = num(inherit(el, 'font-size'), 16);
  const anchor = inherit(el, 'text-anchor') ?? 'start';
  let x = num(el.getAttribute('x')) + num(el.getAttribute('dx')) + m[4];
  let y = num(el.getAttribute('y')) + num(el.getAttribute('dy')) + m[5];
  const spans = Array.from(el.children).filter((c) => tag(c) === 'tspan');
  if (!spans.some(positioned)) return [{ el, x, y, fs, anchor, words: wordCount(el.textContent ?? '') }];
  const out: Line[] = [];
  let head = '';
  for (const node of Array.from(el.childNodes)) {
    if (node.nodeType === 3) { head += node.textContent ?? ''; continue; }
    const s = node as Element;
    if (tag(s) !== 'tspan') continue;
    if (!positioned(s)) { head += s.textContent ?? ''; continue; }
    if (head.trim()) out.push({ el, x, y, fs, anchor, words: wordCount(head) });
    head = '';
    x = s.hasAttribute('x') ? num(s.getAttribute('x')) + m[4] : x;
    y = (s.hasAttribute('y') ? num(s.getAttribute('y')) + m[5] : y) + num(s.getAttribute('dy'));
    out.push({ el, x, y, fs: num(inherit(s, 'font-size'), fs), anchor, words: wordCount(s.textContent ?? '') });
  }
  if (head.trim()) out.push({ el, x, y, fs, anchor, words: wordCount(head) });
  return out;
}

const label = (el: Element) => (el.textContent ?? '').replace(/\s+/g, ' ').trim();

/** Removes the group's prose texts; returns what was removed (for the notes). */
export function stripProse(g: Element): string[] {
  const texts = Array.from(g.querySelectorAll('text')).filter((e) => !e.closest('defs,marker,symbol,clipPath,pattern'));
  if (!texts.length) return [];
  const lines = texts.flatMap((t) => linesOf(t, g));
  const gone = new Set<Element>();
  // Sentences: a one-line text of WORDS_LINE words, unless it is the title.
  const maxFs = Math.max(...lines.map((l) => l.fs)), topY = Math.min(...lines.map((l) => l.y));
  for (const t of texts) {
    const ls = lines.filter((l) => l.el === t);
    if (ls.length !== 1 || ls[0].words < WORDS_LINE) continue;
    const title = ls[0].fs >= maxFs - 1e-6 && ls[0].y <= topY + 1e-6;
    if (!title) gone.add(t);
  }
  // Stacks: lines at one x and anchor, in y order, each a line's pitch from the last.
  const byX = lines.slice().sort((a, b) => (a.anchor < b.anchor ? -1 : a.anchor > b.anchor ? 1 : a.x - b.x));
  const columns: Line[][] = [];
  for (const l of byX) {
    const c = columns[columns.length - 1];
    if (c && c[0].anchor === l.anchor && Math.abs(l.x - c[0].x) <= 2) c.push(l); else columns.push([l]);
  }
  for (const c of columns) {
    c.sort((a, b) => a.y - b.y);
    let run: Line[] = [];
    const flush = () => {
      if (run.length >= STACK_LINES && run.filter((l) => l.words >= WORDS_STACK).length >= STACK_LINES) for (const l of run) gone.add(l.el);
      run = [];
    };
    for (const l of c) {
      const last = run[run.length - 1];
      if (last && l.y - last.y > PITCH * Math.max(l.fs, last.fs)) flush();
      run.push(l);
    }
    flush();
  }
  const out: string[] = [];
  for (const t of texts) if (gone.has(t)) { out.push(label(t)); t.remove(); }
  return out;
}
