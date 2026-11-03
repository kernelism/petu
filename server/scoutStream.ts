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
// of markdown and TeX like the answer's. The pages arrive before the opener (SCOUT_SCHEMA's order):
// once they say the answer is spoken elsewhere (moment.ts homePage), the view will have travelled
// there before the first word, so the opener may point at nothing: the scout only listed the page the
// student was on, and a tag on it would fire on a page no longer in view (`anchor`).
//
// C7 (2026-10-31, "what it says and what it draws don't match"): the opener plays before any plan or
// board exists, from a scout that does not reason, so it may orient but must not claim what the worked
// case decides. Its numbers were the claims stage 2 later contradicted ("the 60-degree launch…", "30 and
// 60 degrees land at the same spot", eval D20). So a sentence whose narration holds a number (digits, or
// a cardinal in words) is not spoken. Decided per released piece, never by waiting (the first caption
// word must not get later): a sentence numeric from its first piece is dropped whole; one whose later
// clause turns numeric is cut there and closed with a full stop (a released clause holds back its
// trailing ", " until the next piece decides, so a cut never leaves a dangling comma). If every sentence
// was numeric, the first is spoken after all at the end: silence is worse, and stage 2 is told to
// correct the opener when its case disagrees (openerNote).
// A sentence that uses a dropped tag as a word ("The {{highlight p=7 "…"}} uses…", quoting a page the
// student is not on) is not spoken either: a tag is silent (src/script/quoteWords.ts), so without its mark
// the sentence lacks a noun, and the deictic the parser would say there ("This uses…") would point at
// nothing. It goes the numeric sentence's way (and is the fallback's first sentence, deictic and all).
import { clean } from './scriptFilter';
import { parseTag } from '../src/script/parseTag';
import { clauseAfter, deixisAt, isArticle, lookahead, markOf, replaceWord, sentenceTail } from '../src/script/quoteWords';

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
 * A number in spoken words: digits or a cardinal. Left out: "one" (a pronoun in orienting speech: "the
 * one on the right"), ordinals ("first"), "half" ("the second half of the proof"), "percent" (a concept's
 * name: "percent change") and a cardinal after a determiner ("the two values", "these three cases":
 * counting what the page shows, not a result).
 */
const NUMBER = /\d+(?:\.\d+)?|\b(?:zero|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundreds?|thousands?|millions?|billions?|twice|thrice)\b/giu;
/** What a number names rather than claims, by the words before it: "Section 3", "Eq. 4", "Lecture 5", "step 2", "the two values", "n minus 1". */
const NAME_BEFORE = /(?:\b(?:sections?|sec|chapters?|ch|figures?|fig|equations?|eqn?|tables?|theorems?|lemmas?|lectures?|slides?|pages?|pp?|steps?|parts?|problems?|exercises?|examples?|questions?|hw|homework|weeks?|lines?|rows?|columns?|layers?|stages?|phases?|cases?|appendix|algorithms?|definitions?|propositions?|corollary|rules?)\.?\s*|\b\p{L}\s*(?:minus|plus|times|over|[-+−×*/])\s*)$/iu;
/** …and by what follows it: "2D", "3D" (a name's letter), "1 minus p". */
const NAME_AFTER = /^(?:\p{Lu}|\s*(?:minus|plus|[-+−])\s*\p{L}(?!\p{L}))/u;
/** An era, not a quantity: "the 1990s", "the '80s" (not "5s", five seconds). */
const decade = (n: string, before: string, after: string) => /^'?s\b/.test(after) && (/^\d{3}0$/.test(n) || (/^\d0$/.test(n) && /'$/.test(before)));
const DETERMINER = /\b(?:the|these|those|its|their|all|both)\s+$/i;
/**
 * Whether spoken script (tags aside: a page number or a quoted phrase is pointing, not a claim) says a
 * number. Not one: digits inside a name ("CO2", "L1", "2D", "Section 3", "n minus 1", "the 1990s"), and
 * any number the student said themselves (`own`: the question): echoing their own words orients, and
 * a check reply's verdict ("Yes, 0.5 is right.") is about their number, not a result the case decides.
 */
export const saysNumber = (s: string, own = ''): boolean => {
  const said = s.replace(/\{\{[^}]*\}\}?/g, ' ');
  const theirs = new Set([...own.matchAll(NUMBER)].map((m) => m[0].toLowerCase()));
  for (const m of said.matchAll(NUMBER)) {
    const before = said.slice(0, m.index), after = said.slice(m.index + m[0].length);
    const digits = /\d/.test(m[0]);
    if (digits && /[\p{L}_]$/u.test(before)) continue; // CO2, L1, x2
    if (digits && /\d[.,]$/.test(before)) continue; // the tail of a number already seen
    if (NAME_BEFORE.test(before) || (!digits && DETERMINER.test(before))) continue;
    if (digits && (NAME_AFTER.test(after) || decade(m[0], before, after))) continue;
    if (theirs.has(m[0].toLowerCase())) continue;
    return true;
  }
  return false;
};

/**
 * Splits the opener into whole sentences or clauses as its characters arrive (`push` returns what
 * this delta completed, `end` the rest). Inside a sentence, a tag that does not point at the
 * visible page (another page, the board, a scroll) is dropped and noted; narration is cleaned; a
 * sentence that says a number is dropped or cut (see the header).
 */
export class OpenerGate {
  private buf = '';
  /** Everything emitted so far: exactly what the student will hear and see. */
  said = '';
  notes: string[] = [];
  /** A released clause's trailing separator (", "), sent with the next piece of its sentence. */
  private pend = '';
  /** Part of the current sentence has been released. */
  private started = false;
  /** The rest of the current sentence is being dropped. */
  private skip = false;
  /** The first dropped sentence (raw), spoken at the end only if nothing else was. */
  private first = '';
  private firstOpen = false;
  /** The last emitted piece used a dropped tag as a word (emit). */
  private lacks = false;
  /** The one page the opener's tags may point at: the visible page, or none once the answer is spoken elsewhere. */
  private page: number | null;
  /** `own`: the student's question (the numbers in it are theirs to hear back). */
  constructor(private visible: number, private own = '') { this.page = visible; }

  /**
   * Where the answer is spoken (moment.ts homePage), known before the opener: the visible page keeps its
   * tags; any other home allows none. Ignored once something was said (an opener written before its
   * pages keeps today's rule: what played pointed at the page in view).
   */
  anchor(home: number): void {
    if (this.said || this.buf) return;
    this.page = home === this.visible ? this.visible : null;
  }

  push(d: string): string {
    this.buf += d;
    let out = '';
    for (let b = this.boundary(); b.cut > 0; b = this.boundary()) {
      out += this.piece(this.buf.slice(0, b.cut), b.end);
      this.buf = this.buf.slice(b.cut);
    }
    return out;
  }

  end(): string {
    const rest = this.buf;
    this.buf = '';
    let out = rest.trim() ? this.piece(rest, true) : '';
    // An opener that stopped at a clause: its separator goes out as written (its space closes the last word).
    if (this.pend) { out += this.pend; this.said += this.pend; this.pend = ''; }
    if (!this.said.trim() && this.first) {
      const s = this.emit(this.first);
      this.first = '';
      this.notes.push('opener: every sentence said a number; the first is spoken anyway');
      this.said += s;
      out += s;
    }
    return out;
  }

  /** One released piece: a whole sentence (`end`) or a clause of one. */
  private piece(text: string, end: boolean): string {
    if (this.skip) {
      if (this.firstOpen) this.first += text;
      if (end) { this.skip = false; this.firstOpen = false; }
      return '';
    }
    const sep = end ? null : /[,;:]\s+$/.exec(text);
    const body = sep ? text.slice(0, sep.index) : text;
    const said = this.emit(body);
    if (this.lacks || saysNumber(said, this.own)) {
      this.notes.push(`opener: dropped ${this.lacks ? 'a sentence that needs a dropped tag' : 'a number'} ${JSON.stringify(text.trim().slice(0, 60))}`);
      this.skip = !end;
      this.pend = '';
      if (this.started) { this.started = false; this.said += '. '; return '. '; }
      if (!this.said.trim() && !this.first) { this.first = text; this.firstOpen = !end; }
      return '';
    }
    const out = this.pend + said;
    this.pend = sep ? sep[0] : '';
    this.started = !end;
    this.said += out;
    return out;
  }

  /**
   * The first complete sentence or clause in the buffer (outside tags): its end and whether it ends a
   * sentence, or cut 0. A clause (after , ; : and a space, at least MIN_CLAUSE characters) is let
   * through too: the model writes far faster than the narration is spoken, so the rest of the sentence
   * is in long before it is due.
   */
  private boundary(): { cut: number; end: boolean } {
    let inTag = false;
    for (let i = 0; i < this.buf.length; i++) {
      if (!inTag && this.buf.startsWith('{{', i)) { inTag = true; i++; continue; }
      if (inTag) { if (this.buf.startsWith('}}', i)) { inTag = false; i++; } continue; }
      const c = this.buf[i];
      const next = this.buf[i + 1];
      if (next === undefined) break; // the next character decides
      if (!/\s/.test(next)) continue;
      if ('.!?'.includes(c) && !/\b(e\.g|i\.e|cf|vs|etc|Fig|Eq)\.$/i.test(this.buf.slice(Math.max(0, i - 4), i + 1))) return { cut: i + 2, end: true };
      if (',;:'.includes(c) && i + 1 >= MIN_CLAUSE) return { cut: i + 2, end: false };
    }
    return { cut: 0, end: false };
  }

  private emit(sentence: string): string {
    this.lacks = false;
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
        // A dropped mark the sentence used as a word ("The {{highlight p=4 "kernel"}} slides…"): the sentence
        // is not spoken (piece); should it be after all, it says the parser's deictic there ("This slides…").
        const w = this.deixis(tag, out, sentence.slice(b + 2));
        if (w) { out = w.out; this.lacks = true; }
        if (w?.say) out += (out && !/\s$/.test(out) ? ' ' : '') + w.say;
        // A dropped pointer between two spaces leaves one ("the  viewing ray" was sent as written).
        else if (/\s$/.test(this.said + out)) while (sentence[i] === ' ' || sentence[i] === '\t') i++;
      }
    }
    return out;
  }

  /**
   * A dropped mark its sentence uses as a word (quoteRole `slot`, src/script/quoteWords.ts): the text so
   * far (its article replaced, when the deictic takes its place) and the deictic still to say. Null: the
   * mark only pointed.
   */
  private deixis(tag: string, out: string, rest: string): { out: string; say: string } | null {
    const m = markOf(parseTag(tag.slice(2, -2)));
    if (!m) return null;
    const before = sentenceTail((this.said + out).replace(/\{\{[^}]*\}\}/g, ' ').split(/\s+/).filter(Boolean));
    const clause = clauseAfter(rest, true, lookahead(m.quote)) ?? rest;
    const d = deixisAt(before, m, clause);
    if (!d) return null;
    const w = /(\S+)(\s*)$/.exec(out);
    if (d.replacesPrev && w && isArticle(w[1])) return { out: out.slice(0, w.index) + replaceWord(w[1], d.words) + w[2], say: '' };
    return { out, say: d.words };
  }

  private allowed(tag: string): boolean {
    const name = /^\{\{\s*([A-Za-z]+)/.exec(tag)?.[1]?.toLowerCase();
    if (!name || !OPENER_TAGS.has(name)) return false;
    if (/\son=/.test(tag)) return false;
    const p = /\sp=(\d+)/.exec(tag);
    return !!p && this.page != null && Number(p[1]) === this.page;
  }
}
