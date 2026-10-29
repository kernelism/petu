// src/gate/segment.ts — a streamed script → sentences (units) → beats, with character offsets.
//
// A beat is a group of whole sentences plus the tags that fire inside them: the unit the commit
// gate checks and releases (words and ink together). Tags fire with the word after them
// (scheduler), so a tag that sits between two sentences belongs to the sentence after it.
//
// The tag scanner mirrors ScriptParser's rules (src/script/parser.ts): a tag closes at `}}` outside
// quotes; a newline, a second `{{` or MAX_TAG_CHARS fails it and its text is narration.
import { MAX_TAG_CHARS } from '../script/parser';
import { parseTag } from '../script/parseTag';
import type { RawAction } from '../script/types';

export type Word = { kind: 'word'; text: string; start: number; end: number; /** index among the script's words */ i: number };
export type Tag = { kind: 'tag'; body: string; start: number; end: number; action: RawAction | null; /** the word it fires with (index), or -1 at the end */ at: number };
export type Tok = Word | Tag;

const QUOTE_CLOSE: Record<string, string> = { '"': '"', '“': '”' };

function scan(buf: string, open: number): { close: number } | { fail: number } {
  const limit = open + MAX_TAG_CHARS;
  let quote: string | null = null;
  for (let i = open + 2; i < buf.length; i++) {
    if (i >= limit) { const ws = Math.max(buf.lastIndexOf(' ', limit), buf.lastIndexOf('\t', limit)); return { fail: ws > open + 2 ? ws : limit }; }
    const c = buf[i];
    if (c === '\n' || c === '\r') return { fail: i };
    if (quote) { if (c === quote) quote = null; continue; }
    if (c in QUOTE_CLOSE) { quote = QUOTE_CLOSE[c]; continue; }
    if (c === '}' && buf[i + 1] === '}') return { close: i + 2 };
    if (c === '{' && buf[i + 1] === '{') return { fail: i };
  }
  return { fail: buf.length };
}

/** Words and tags with offsets. Malformed tags (parseTag → null) stay as tags with `action: null`. */
export function tokenize(script: string): Tok[] {
  const out: Tok[] = [];
  let wi = 0;
  const words = (from: number, to: number) => {
    for (const m of script.slice(from, to).matchAll(/\S+/g)) out.push({ kind: 'word', text: m[0], start: from + m.index!, end: from + m.index! + m[0].length, i: wi++ });
  };
  let pos = 0;
  const warn = console.warn;
  console.warn = () => {};
  try {
    for (;;) {
      const open = script.indexOf('{{', pos);
      if (open === -1) { words(pos, script.length); break; }
      words(pos, open);
      const s = scan(script, open);
      if ('fail' in s) { words(open, s.fail); pos = s.fail; continue; }
      const body = script.slice(open + 2, s.close - 2);
      out.push({ kind: 'tag', body, start: open, end: s.close, action: parseTag(body), at: -1 });
      pos = s.close;
    }
  } finally { console.warn = warn; }
  // A tag fires with the next word.
  let next = -1;
  for (let k = out.length - 1; k >= 0; k--) { const t = out[k]; if (t.kind === 'word') next = t.i; else t.at = next; }
  return out;
}

/** One sentence and the tags that fire within it. */
export type Unit = { words: Word[]; tags: Tag[]; start: number; end: number; text: string; paraBefore: boolean };

const ABBREV = /^(e\.g|i\.e|etc|vs|Fig|fig|Eq|eq|Dr|Mr|Ms|No|approx|cf)\.$/;
const endsSentence = (w: string) => /[.!?]["”’)\]]*$/.test(w) && !ABBREV.test(w.replace(/["”’)\]]+$/, ''));

/** Sentences: a word ending in . ! ? (not an abbreviation) or a blank line ends one. */
export function units(script: string, toks = tokenize(script)): Unit[] {
  const out: Unit[] = [];
  let cur: Unit | null = null;
  let pendingTags: Tag[] = [];
  let lastEnd = 0;
  let para = true;
  const close = () => { if (cur) { cur.text = sentenceText(cur); out.push(cur); cur = null; } };
  for (const t of toks) {
    // Any line break is a paragraph break (the model writes blank lines; the opener → stage-2 seam is one newline).
    if (/\n/.test(script.slice(lastEnd, t.start))) { close(); para = true; }
    lastEnd = t.end;
    if (t.kind === 'tag') {
      if (cur) cur.tags.push(t); else pendingTags.push(t);
      continue;
    }
    if (!cur) { cur = { words: [], tags: pendingTags, start: pendingTags[0]?.start ?? t.start, end: t.end, text: '', paraBefore: para }; pendingTags = []; para = false; }
    cur.words.push(t);
    cur.end = t.end;
    if (endsSentence(t.text)) close();
  }
  close();
  if (pendingTags.length) {
    // Tags after the last word fire at the end: they belong to the last sentence.
    const last = out[out.length - 1] as Unit | undefined;
    if (last) { last.tags.push(...pendingTags); last.end = pendingTags[pendingTags.length - 1].end; }
    else out.push({ words: [], tags: pendingTags, start: pendingTags[0].start, end: pendingTags[pendingTags.length - 1].end, text: '', paraBefore: true });
  }
  return out;
}

const sentenceText = (u: Unit) => u.words.map((w) => w.text).join(' ');

/** Tags that put new ink on a page or the board (not scrolls, lets, consts or refs to earlier ink). */
export const NEW_INK = new Set(['highlight', 'underline', 'circle', 'box', 'line', 'arrow', 'curve', 'point', 'label', 'write', 'math', 'shade', 'angle', 'brace', 'axes', 'plot', 'grid', 'bars', 'scatter', 'table', 'calc', 'fit', 'connect']);
/** Tags that draw on the board (sketch sections). */
export const isBoardInk = (a: RawAction | null): boolean => !!a && NEW_INK.has(a.kind) && 'region' in a && (a as { region?: string }).region != null;
export const isPageInk = (a: RawAction | null): boolean => !!a && NEW_INK.has(a.kind) && 'page' in a && (a as { page?: number }).page != null && !('region' in a && (a as { region?: string }).region != null);

export type Beat = {
  /** 0-based within the segmented text. */
  k: number;
  units: Unit[];
  words: Word[];
  tags: Tag[];
  start: number;
  end: number;
  text: string;
};

export type BeatRule = 'para' | 'sentence' | 'ink' | 'hybrid';
export type BeatOpts = { rule?: BeatRule; minWords?: number; maxWords?: number };
/** The proposed rule's defaults (see the report): a beat opens at a paragraph or at a sentence that starts new board ink, once the beat has ≥ 12 words; a beat longer than 45 words closes at the next sentence end. */
export const BEAT_DEFAULTS: Required<BeatOpts> = { rule: 'hybrid', minWords: 12, maxWords: 45 };

const leadsWithInk = (u: Unit) => u.tags.some((t) => (t.at === (u.words[0]?.i ?? -2) || t.start < (u.words[0]?.start ?? Infinity)) && (isBoardInk(t.action) || t.action?.kind === 'sketch'));

/** Groups sentences into beats. */
export function beats(script: string, opts: BeatOpts = {}): Beat[] {
  const o = { ...BEAT_DEFAULTS, ...opts };
  const us = units(script);
  const groups: Unit[][] = [];
  let cur: Unit[] = [];
  const nWords = (g: Unit[]) => g.reduce((s, u) => s + u.words.length, 0);
  for (const u of us) {
    let split = false;
    if (cur.length) {
      if (o.rule === 'sentence') split = true;
      else if (o.rule === 'para') split = u.paraBefore;
      else if (o.rule === 'ink') split = leadsWithInk(u) || u.paraBefore;
      else split = (u.paraBefore || leadsWithInk(u)) && nWords(cur) >= o.minWords || nWords(cur) >= o.maxWords;
    }
    if (split) { groups.push(cur); cur = []; }
    cur.push(u);
  }
  if (cur.length) groups.push(cur);
  // Hybrid: a short tail joins the beat before it.
  if (o.rule === 'hybrid' && groups.length > 1 && nWords(groups[groups.length - 1]) < o.minWords / 2) { const t = groups.pop()!; groups[groups.length - 1].push(...t); }
  return groups.map((g, k) => ({
    k, units: g, words: g.flatMap((u) => u.words), tags: g.flatMap((u) => u.tags),
    start: g[0].start, end: g[g.length - 1].end, text: g.map((u) => u.text).join(' '),
  }));
}
