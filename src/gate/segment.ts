// src/gate/segment.ts — a streamed script → sentences (units) → beats, with character offsets.
//
// A beat is a group of whole sentences plus the tags that fire inside them: the unit the commit
// gate checks and releases (words and ink together). Tags fire with the word after them
// (scheduler), so a tag that sits between two sentences belongs to the sentence after it.
//
// The tag scanner mirrors ScriptParser's rules (src/script/parser.ts): a tag closes at `}}` outside
// quotes; a newline, a second `{{` or MAX_TAG_CHARS fails it and its text is narration.
import { MAX_TAG_CHARS } from '../script/parser';
import { isSvgTagBody, SVG_TAG_MAX } from '../svgboard/wire';
import { parseTag } from '../script/parseTag';
import type { RawAction } from '../script/types';

export type Word = { kind: 'word'; text: string; start: number; end: number; /** index among the script's words */ i: number };
export type Tag = { kind: 'tag'; body: string; start: number; end: number; action: RawAction | null; /** the word it fires with (index), or -1 at the end */ at: number };
export type Tok = Word | Tag;

const QUOTE_CLOSE: Record<string, string> = { '"': '"', '“': '”' };

function scan(buf: string, open: number): { close: number } | { fail: number } {
  const svg = isSvgTagBody(buf.slice(open + 2, open + 8));
  const limit = open + (svg ? SVG_TAG_MAX : MAX_TAG_CHARS);
  let quote: string | null = null;
  for (let i = open + 2; i < buf.length; i++) {
    if (i >= limit) { const ws = Math.max(buf.lastIndexOf(' ', limit), buf.lastIndexOf('\t', limit)); return { fail: ws > open + 2 ? ws : limit }; }
    const c = buf[i];
    if (c === '\n' || c === '\r') return { fail: i };
    if (quote) { if (c === quote) quote = null; continue; }
    if (c in QUOTE_CLOSE && !svg) { quote = QUOTE_CLOSE[c]; continue; }
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
      if (cur) cur.tags.push(t);
      // The svg board's group follows its beat's sentences: it belongs to the sentence before it.
      else if (t.action?.kind === 'svg' && !pendingTags.length && out.length) { const last = out[out.length - 1]; last.tags.push(t); last.end = t.end; }
      // A group with no sentence before it in this text (its words went out already): a unit of its own.
      else if (t.action?.kind === 'svg' && !pendingTags.length) out.push({ words: [], tags: [t], start: t.start, end: t.end, text: '', paraBefore: para });
      else pendingTags.push(t);
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
export type BeatOpts = { rule?: BeatRule; minWords?: number; maxWords?: number; /** Hybrid: a short tail joins the beat before it (default on; off = what the incremental splitter produces). */ tail?: boolean };
/** The proposed rule's defaults (see the report): a beat opens at a paragraph or at a sentence that starts new board ink, once the beat has ≥ 12 words; a beat longer than 45 words closes at the next sentence end. */
export const BEAT_DEFAULTS: Required<BeatOpts> = { rule: 'hybrid', minWords: 12, maxWords: 45, tail: true };

export const leadsWithInk = (u: Unit) => u.tags.some((t) => (t.at === (u.words[0]?.i ?? -2) || t.start < (u.words[0]?.start ?? Infinity)) && (isBoardInk(t.action) || t.action?.kind === 'sketch'));

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
  if (o.rule === 'hybrid' && o.tail && groups.length > 1 && nWords(groups[groups.length - 1]) < o.minWords / 2) { const t = groups.pop()!; groups[groups.length - 1].push(...t); }
  return groups.map((g, k) => ({
    k, units: g, words: g.flatMap((u) => u.words), tags: g.flatMap((u) => u.tags),
    start: g[0].start, end: g[g.length - 1].end, text: g.map((u) => u.text).join(' '),
  }));
}

// ------------------------------------------------------------------------------------------------
// Incremental: the live gate's splitter.

/** A closed unit of the stream: its raw text (exactly as streamed, leading whitespace included). */
export type SplitUnit = { text: string; words: number; sentences: number; kind: 'sentence' | 'beat' };
type Sent = { raw: string; u: Unit; para: boolean };

/**
 * Splits a streamed script into units as it arrives: sentences in `sentence` mode, hybrid beats in
 * `beat` mode (BEAT_DEFAULTS; a beat closes at a sentence that opens a new one, at maxWords, or at
 * the end). Concatenating every unit's text gives the stream back exactly. With the mode fixed, the
 * beats equal `beats(text, { tail: false })` (sentences: `units(text)`) at any chunk boundaries.
 * A sentence closes once its last word is followed by whitespace (or a line break ends it); a
 * partial word or an unclosed tag waits for more text.
 */
export class BeatSplitter {
  private buf = '';
  private cur: Sent[] = [];
  private first = true;
  private o: Required<BeatOpts>;
  constructor(private m: 'sentence' | 'beat' = 'beat', opts: BeatOpts = {}) { this.o = { ...BEAT_DEFAULTS, ...opts }; }

  get mode(): 'sentence' | 'beat' { return this.m; }
  /** Switches mode; a beat in progress closes as it stands. */
  setMode(m: 'sentence' | 'beat'): SplitUnit[] {
    if (m === this.m) return [];
    this.m = m;
    return this.flush();
  }

  /** Text not yet closed into a unit (the gate's look-ahead: later ids it names). */
  pending(): string { return this.cur.map((s) => s.raw).join('') + this.buf; }

  push(chunk: string): SplitUnit[] { this.buf += chunk; return this.take(false); }
  /** The stream ended: the rest is one or more units. */
  end(): SplitUnit[] { const out = this.take(true); out.push(...this.flush()); return out; }
  /** Everything buffered as units now, whole sentences or not (the opener's text is complete as sent). */
  close(): SplitUnit[] { return this.end(); }

  private flush(): SplitUnit[] {
    if (!this.cur.length) return [];
    const g = this.cur;
    this.cur = [];
    return [this.unitOf(g, 'beat')];
  }

  private unitOf(g: Sent[], kind: 'sentence' | 'beat'): SplitUnit {
    return { text: g.map((s) => s.raw).join(''), words: g.reduce((n, s) => n + s.u.words.length, 0), sentences: g.length, kind };
  }

  private cut(final: boolean): number {
    const buf = this.buf;
    if (final) return buf.length;
    let cut = buf.search(/\S*$/);
    let pos = 0;
    for (;;) {
      const open = buf.indexOf('{{', pos);
      if (open === -1 || open >= buf.length) break;
      const s = scan(buf, open);
      if ('close' in s) {
        if (open < cut && s.close > cut) cut = s.close; // whitespace inside a closed tag is not a word boundary
        pos = s.close;
        continue;
      }
      if (s.fail >= buf.length && buf.length < open + (isSvgTagBody(buf.slice(open + 2, open + 8)) ? SVG_TAG_MAX : MAX_TAG_CHARS)) { if (open < cut) cut = open; break; }
      pos = s.fail;
    }
    return cut;
  }

  private take(final: boolean): SplitUnit[] {
    const cut = this.cut(final);
    if (cut <= 0 && !final) return [];
    const prefix = this.buf.slice(0, cut);
    const us = units(prefix);
    let consumed = 0;
    const sents: Sent[] = [];
    for (let i = 0; i < us.length; i++) {
      const u = us[i];
      let end = u.end;
      if (i === us.length - 1 && !final) {
        const lw = u.words[u.words.length - 1];
        // A beat's svg group that arrives after its sentences went out is a unit of its own (its words
        // are already playing; the scheduler draws it on the word that named it, if still to come).
        if (!lw && u.tags.length && u.tags.every((t) => t.action?.kind === 'svg')) {
          sents.push({ raw: this.buf.slice(consumed, u.end), u, para: false });
          consumed = u.end;
          continue;
        }
        if (!lw) break;
        const done = endsSentence(lw.text) || /\n/.test(prefix.slice(lw.end));
        if (!done) break;
        // Tags after the last word fire with the next sentence's first word: they stay buffered —
        // except the svg board's groups right after it, which close its beat (units()).
        end = lw.end;
        for (const t of u.tags) if (t.start >= end && t.action?.kind === 'svg' && !/\S/.test(this.buf.slice(end, t.start))) end = t.end;
        if (u.tags.some((t) => t.start >= end)) u.tags = u.tags.filter((t) => t.start < end);
        u.end = end;
      }
      const para = this.first || (i === 0 ? /\n/.test(prefix.slice(0, u.words[0]?.start ?? u.end)) : u.paraBefore);
      this.first = false;
      sents.push({ raw: this.buf.slice(consumed, end), u, para });
      consumed = end;
    }
    this.buf = this.buf.slice(consumed);
    if (final && this.buf.length) {
      // Only whitespace (or nothing) after the last unit: it rides with the last sentence.
      if (sents.length) { sents[sents.length - 1].raw += this.buf; this.buf = ''; }
      else if (this.cur.length) { this.cur[this.cur.length - 1].raw += this.buf; this.buf = ''; }
      else { const ws = this.buf; this.buf = ''; return [{ text: ws, words: 0, sentences: 0, kind: this.m }]; }
    }
    const out: SplitUnit[] = [];
    for (const s of sents) {
      if (this.m === 'sentence') { out.push(this.unitOf([s], 'sentence')); continue; }
      const n = this.cur.reduce((k, x) => k + x.u.words.length, 0);
      if (this.cur.length && this.split(s, n)) out.push(...this.flush());
      this.cur.push(s);
      if (this.cur.reduce((k, x) => k + x.u.words.length, 0) >= this.o.maxWords || s.u.tags.some((t) => t.action?.kind === 'svg')) out.push(...this.flush());
    }
    return out;
  }

  private split(s: Sent, n: number): boolean {
    const o = this.o;
    if (!s.u.words.length && s.u.tags.every((t) => t.action?.kind === 'svg')) return false; // a group closes its beat, never opens one
    if (o.rule === 'sentence') return true;
    if (o.rule === 'para') return s.para;
    if (o.rule === 'ink') return leadsWithInk(s.u) || s.para;
    return ((s.para || leadsWithInk(s.u)) && n >= o.minWords) || n >= o.maxWords;
  }
}
