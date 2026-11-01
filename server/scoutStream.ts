// server/scoutStream.ts — reads the scout's strict JSON ({"opener": "…", "pages": […], "plan": "…"}) as it
// streams, so the opener can be spoken before the rest of the object exists.
//
// `ScoutJson` is a small incremental parser for one flat JSON object: it reports each string field's
// decoded characters as they arrive (`onString(key, delta)`), and every field once it is complete
// (`onField(key, value)`). Nested values (the pages array) are collected raw and parsed when they close.
// It never throws: malformed input simply stops producing fields, and the caller falls back to
// parsing the whole text at the end.
//
// `OpenerGate` turns the opener's characters into spoken script: whole sentences only (the first one
// plays as soon as it is complete), tags restricted to pointing at the visible page, narration cleaned
// of markdown and TeX like the answer's.
import { clean } from './scriptFilter';
import { parseTag } from '../src/script/parseTag';
import { clauseAfter, lookahead, markQuote, sentenceTail, spokenAt } from '../src/script/quoteWords';

type State = 'start' | 'key' | 'colon' | 'value' | 'string' | 'raw' | 'after' | 'done';

export class ScoutJson {
  private st: State = 'start';
  private key = '';
  private esc = false;
  private uni = '';
  private hi = 0; // a pending high surrogate
  private str = '';
  private raw = '';
  private depth = 0;
  private inRawStr = false;
  private rawEsc = false;
  readonly fields: Record<string, unknown> = {};
  constructor(private h: { onString?(key: string, delta: string): void; onField?(key: string, value: unknown): void } = {}) {}

  push(text: string): void {
    let delta = '';
    const flush = () => { if (delta && this.st === 'string' && this.key) this.h.onString?.(this.key, delta); delta = ''; };
    for (const c of text) {
      switch (this.st) {
        case 'start':
          if (c === '{') this.st = 'key';
          break;
        case 'key':
          if (c === '"') { this.st = 'string'; this.str = ''; this.key = ''; this.inKey = true; }
          else if (c === '}') this.st = 'done';
          break;
        case 'colon':
          if (c === ':') this.st = 'value';
          break;
        case 'value':
          if (/\s/.test(c)) break;
          if (c === '"') { this.st = 'string'; this.str = ''; this.inKey = false; }
          else { this.st = 'raw'; this.raw = c; this.depth = c === '[' || c === '{' ? 1 : 0; this.inRawStr = false; this.rawEsc = false; if (this.depth === 0) this.rawScalar = true; else this.rawScalar = false; }
          break;
        case 'raw':
          if (this.rawScalar) {
            if (c === ',' || c === '}') { this.finishRaw(); this.st = c === '}' ? 'done' : 'key'; }
            else this.raw += c;
            break;
          }
          this.raw += c;
          if (this.inRawStr) { if (this.rawEsc) this.rawEsc = false; else if (c === '\\') this.rawEsc = true; else if (c === '"') this.inRawStr = false; break; }
          if (c === '"') this.inRawStr = true;
          else if (c === '[' || c === '{') this.depth++;
          else if (c === ']' || c === '}') { if (--this.depth === 0) { this.finishRaw(); this.st = 'after'; } }
          break;
        case 'after':
          if (c === ',') this.st = 'key';
          else if (c === '}') this.st = 'done';
          break;
        case 'string': {
          const out = this.stringChar(c);
          if (out === null) {
            // The string closed.
            if (this.inKey) { this.key = this.str; this.st = 'colon'; }
            else { flush(); this.fields[this.key] = this.str; this.h.onField?.(this.key, this.str); this.st = 'after'; }
          } else if (out && !this.inKey) { delta += out; }
          break;
        }
        case 'done':
          break;
      }
    }
    flush();
  }

  private inKey = false;
  private rawScalar = false;

  /** One character of a string body: the decoded text it adds ('' for none), or null at the closing quote. */
  private stringChar(c: string): string | null {
    if (this.uni) {
      this.uni += c;
      if (this.uni.length < 5) return '';
      const code = parseInt(this.uni.slice(1), 16);
      this.uni = '';
      if (!Number.isFinite(code)) return '';
      if (code >= 0xd800 && code <= 0xdbff) { this.hi = code; return ''; }
      const s = code >= 0xdc00 && code <= 0xdfff && this.hi ? String.fromCharCode(this.hi, code) : String.fromCharCode(code);
      this.hi = 0;
      this.str += s;
      return s;
    }
    if (this.esc) {
      this.esc = false;
      if (c === 'u') { this.uni = 'u'; return ''; }
      const s = ({ n: '\n', t: '\t', r: '\r', b: '\b', f: '\f' } as Record<string, string>)[c] ?? c;
      this.str += s;
      return s;
    }
    if (c === '\\') { this.esc = true; return ''; }
    if (c === '"') return null;
    this.str += c;
    return c;
  }

  private finishRaw(): void {
    let v: unknown;
    try { v = JSON.parse(this.raw.trim()); } catch { v = undefined; }
    if (v !== undefined) { this.fields[this.key] = v; this.h.onField?.(this.key, v); }
    this.raw = '';
  }

  /** The object closed. */
  get complete(): boolean { return this.st === 'done'; }
}

/** The tags an opener may use: pointing at the visible page, nothing that scrolls or draws on the board. */
export const OPENER_TAGS = new Set(['highlight', 'underline', 'circle', 'box', 'arrow', 'line']);
/** A clause shorter than this waits for more ("So," alone is not worth a release). */
const MIN_CLAUSE = 16;

/**
 * Splits the opener into whole sentences or clauses as its characters arrive (`push` returns what
 * this delta completed, `end` the rest). Inside a sentence, a tag that does not point at the
 * visible page (another page, the board, a scroll) is dropped and noted; narration is cleaned.
 */
export class OpenerGate {
  private buf = '';
  /** Everything emitted so far: exactly what the student will hear and see. */
  said = '';
  notes: string[] = [];
  constructor(private visible: number) {}

  push(d: string): string {
    this.buf += d;
    let out = '';
    for (let cut = this.boundary(); cut > 0; cut = this.boundary()) {
      out += this.emit(this.buf.slice(0, cut));
      this.buf = this.buf.slice(cut);
    }
    return out;
  }

  end(): string {
    const rest = this.buf;
    this.buf = '';
    return rest.trim() ? this.emit(rest) : '';
  }

  /**
   * The end of the first complete sentence or clause in the buffer (outside tags), or 0. A clause
   * (after , ; : and a space, at least MIN_CLAUSE characters) is let through too: the model writes
   * far faster than the narration is spoken, so the rest of the sentence is in long before it is due.
   */
  private boundary(): number {
    let inTag = false;
    for (let i = 0; i < this.buf.length; i++) {
      if (!inTag && this.buf.startsWith('{{', i)) { inTag = true; i++; continue; }
      if (inTag) { if (this.buf.startsWith('}}', i)) { inTag = false; i++; } continue; }
      const c = this.buf[i];
      const next = this.buf[i + 1];
      if (next === undefined) break; // the next character decides
      if (!/\s/.test(next)) continue;
      if ('.!?'.includes(c) && !/\b(e\.g|i\.e|cf|vs|etc|Fig|Eq)\.$/i.test(this.buf.slice(Math.max(0, i - 4), i + 1))) return i + 2;
      if (',;:'.includes(c) && i + 1 >= MIN_CLAUSE) return i + 2;
    }
    return 0;
  }

  private emit(sentence: string): string {
    let out = '';
    let i = 0;
    while (i < sentence.length) {
      const a = sentence.indexOf('{{', i);
      if (a < 0) { out += clean(sentence.slice(i)); break; }
      out += clean(sentence.slice(i, a));
      const b = sentence.indexOf('}}', a + 2);
      if (b < 0) { break; } // an unclosed tag at the very end: drop it
      const tag = sentence.slice(a, b + 2);
      i = b + 2;
      if (this.allowed(tag)) out += tag;
      else {
        this.notes.push(`opener: dropped ${JSON.stringify(tag.slice(0, 40))}`);
        // A dropped mark the sentence used as a word ("The {{highlight p=4 "kernel"}} slides…"): its words stay.
        const w = this.quoteWords(tag, out, sentence.slice(b + 2));
        if (w) out += (out && !/\s$/.test(out) ? ' ' : '') + w;
        // A dropped pointer between two spaces leaves one ("the  viewing ray" was sent as written).
        else if (/\s$/.test(this.said + out)) while (sentence[i] === ' ' || sentence[i] === '\t') i++;
      }
    }
    this.said += out;
    return out;
  }

  /** The words a dropped quote tag stood for in its sentence (src/script/quoteWords.ts), or ''. */
  private quoteWords(tag: string, out: string, rest: string): string {
    const q = markQuote(parseTag(tag.slice(2, -2)));
    if (!q) return '';
    const before = sentenceTail((this.said + out).replace(/\{\{[^}]*\}\}/g, ' ').split(/\s+/).filter(Boolean));
    const clause = clauseAfter(rest, true, lookahead(q)) ?? rest;
    return spokenAt(before, q, clause) ?? '';
  }

  private allowed(tag: string): boolean {
    const name = /^\{\{\s*([A-Za-z]+)/.exec(tag)?.[1]?.toLowerCase();
    if (!name || !OPENER_TAGS.has(name)) return false;
    if (/\son=/.test(tag)) return false;
    const p = /\sp=(\d+)/.exec(tag);
    return !!p && Number(p[1]) === this.visible;
  }
}
