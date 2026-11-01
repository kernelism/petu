// server/svgBeats.ts — the svg answer mode's stream filter (the default stage-2 format, p6).
/**
 * The model streams (p6.1): a first sentence or two with no drawing, a short hidden `<plan>` ending with its BOARD layout (`BOARD viewBox="0 0 1000 H"`,
 * regions, groups in teaching order), then beats — that beat's `<g id="…">…</g>`, then 1–3 sentences
 * of narration — repeated. This filter sits in front of the ScriptFilter (it IS one, so the plan,
 * markdown clean-up and readUpstream stay the same) and rewrites only what is SVG:
 *  - the beat wire (2026-10-31): it writes the beat boundaries, `{{beat}}` (src/svgboard/beat.ts, THE RULE): the moment a
 *    group opens in lead order (the default), before the first word after a group in trailing order
 *    (sentences before the first group), and right after the plan's `{{svgboard}}`. Downstream a beat is
 *    the text from one `{{beat}}` to the next, whatever order the model wrote;
 *  - the plan is lifted out whole (kept in `plan`, as the ScriptFilter keeps its own), and the BOARD
 *    line becomes `{{svgboard h=H}}` at once, so the client opens the board while beat 1 is written;
 *  - every top-level SVG element (a `<g>`, a `<defs>`, a stray `<rect …/>`) is held until it closes,
 *    then goes out as one wire tag `{{svg …}}` (src/svgboard/wire.ts); a stray element is wrapped in
 *    an id-less group;
 *  - wrappers the model may add around groups (`<svg …>`, `</svg>`, ``` fences, `{{svg}}`/`{{/svg}}`)
 *    are dropped.
 *  - p6.2: the optional hidden check question after the last beat, `<check>…</check>`, is lifted out
 *    (kept in `check`, sent with the `done` event): it is never spoken; the student may open it after
 *    the answer ("Test yourself").
 * Narration passes through as it streams (only a possible marker start, `<…`, is held), so the student
 * hears beat 1 while its group is still being written: no silence waiting for the whole board.
 */
import { ScriptFilter } from './scriptFilter.ts';
import { BEAT_TAG, BOARD_W, completeSvg, escapeSvg } from '../src/svgboard/wire.ts';

/** A group longer than this is dropped (the client sanitizer caps it again). */
export const GROUP_MAX = 20000;
/** A plan never runs past this (an unclosed one ends at the first group). */
export const SVG_PLAN_MAX = 4000;
/** A check question is cut to this (it is never spoken, however long; an unclosed one runs to the end). */
export const CHECK_MAX = 400;

/** Elements that may stand at the top level of the board. */
const ELEMENTS = 'g|defs|path|line|polyline|polygon|rect|circle|ellipse|text|marker|use';
const OPEN = new RegExp(`<(${ELEMENTS})(?=[\\s/>])`, 'i');
/** Things dropped outside groups. */
const WRAPPERS = /^(?:<svg\b[^>]*>|<\/svg\s*>|```[a-z]*|\{\{\s*\/?svg\s*\}\}|<\?xml[^>]*>|<!--[\s\S]*?-->)/i;

export type SvgBoardSpec = { w: number; h: number; extend: boolean };

/** The BOARD line of a plan: its canvas (1000 wide unless it says otherwise) and whether it extends the last board. */
export function boardOf(plan: string): SvgBoardSpec | null {
  const m = /BOARD\b[^\n]*?\b(extend\b)?[^\n]*?viewBox\s*=?\s*["']?\s*-?[\d.]+[\s,]+-?[\d.]+[\s,]+([\d.]+)[\s,]+([\d.]+)/i.exec(plan);
  if (!m) return null;
  const w = Number(m[2]), h = Number(m[3]);
  if (!(w > 0 && h > 0)) return null;
  return { w, h, extend: !!m[1] || /BOARD\s+extend/i.test(plan) };
}

export const svgboardTag = (b: SvgBoardSpec): string => `{{svgboard${b.w !== 1000 ? ` w=${Math.round(b.w)}` : ''} h=${Math.round(b.h)}${b.extend ? ' extend' : ''}}}`;

type St = 'text' | 'plan' | 'el' | 'check';

export class SvgBeatFilter extends ScriptFilter {
  private sbuf = '';
  private st: St = 'text';
  private planBuf = '';
  private el = { name: '', depth: 0, text: '' };
  private opened = false;
  private checkBuf = '';
  /** The hidden check question (p6.2 `<check>…</check>`), if the model wrote one: never spoken. */
  check: string | undefined;
  /** The board this answer opened (null until its plan or first group). */
  board: SvgBoardSpec | null = null;
  /** Ids of the groups sent, in order. */
  readonly groups: string[] = [];
  /** What was dropped and why (answers.jsonl, ?debug). */
  readonly notes: string[] = [];
  /** Timings (ms, the caller's clock) of the first group and the board's opening. */
  firstGroupMs = NaN;
  private now: () => number;
  /** `opened`: the board is already open (a gate repair's stream redraws one beat of it): no BOARD tag is sent. */
  constructor(now: () => number = () => performance.now(), o: { opened?: boolean } = {}) { super(); this.now = now; this.opened = !!o.opened; }

  /** The last character this filter let through (a plan after narration owes that narration a boundary). */
  private lastCh = '';
  /** That boundary was added: the narration's own leading space after the plan is dropped once. */
  private owedWs = false;
  /**
   * The beat order (src/svgboard/beat.ts): `lead` (a group opens its beat) or `trail` (a group closes it),
   * decided at the first group by the sentences since the board opened; null until then.
   */
  order: 'lead' | 'trail' | null = null;
  /** Narration since the last `{{beat}}` (words: the next group opens a beat), and since the board opened (until the order is known). */
  private beatWords = false;
  private beats = 0;
  private sinceBoard = '';
  /** Trailing order: a group closed its beat; the next word opens one. */
  private owedBeat = false;
  private beat(): string { this.beats++; this.beatWords = false; return `${BEAT_TAG} `; }
  /** Narration going out: its boundary first when one is owed, then its words and sentence ends counted. */
  private say(s: string): string {
    if (!s) return s;
    let pre = '';
    if (this.owedBeat && /\S/.test(s)) { this.owedBeat = false; const i = s.search(/\S/); pre = s.slice(0, i) + this.beat(); s = s.slice(i); }
    if (this.order == null && this.sinceBoard.length < 4000) this.sinceBoard += s;
    if (/[\p{L}\p{N}]/u.test(s.replace(/\{\{[^}]*\}\}/g, ' '))) this.beatWords = true;
    return pre + s;
  }
  override push(chunk: string): string { this.sbuf += chunk; const s = this.lift(false); if (s) this.lastCh = s.slice(-1); return super.push(s); }
  override end(): string { const s = this.lift(true); return super.push(s) + super.end(); }

  private lift(final: boolean): string {
    let out = '';
    for (;;) {
      if (this.st === 'plan') {
        const close = this.sbuf.search(/<\/plan\s*>/i);
        const group = this.sbuf.search(OPEN);
        const end = close >= 0 ? close : group >= 0 ? group : -1;
        if (end < 0 && !final && this.planBuf.length + this.sbuf.length < SVG_PLAN_MAX) {
          const keep = Math.min(this.sbuf.length, 8); // "</plan>" may be split
          this.planBuf += this.sbuf.slice(0, this.sbuf.length - keep);
          this.sbuf = this.sbuf.slice(this.sbuf.length - keep);
          return out;
        }
        const at = end < 0 ? Math.min(this.sbuf.length, Math.max(0, SVG_PLAN_MAX - this.planBuf.length)) : end;
        this.planBuf += this.sbuf.slice(0, at);
        this.sbuf = this.sbuf.slice(at).replace(/^<\/plan\s*>/i, '');
        this.plan = (this.plan ? `${this.plan}\n` : '') + this.planBuf.trim();
        const b = boardOf(this.planBuf);
        this.planBuf = '';
        this.st = 'text';
        // The opener ends with the plan: the board's first beat starts here (its sentences are counted from here).
        if (b && !this.opened) { this.board = b; this.opened = true; out += svgboardTag(b) + ' ' + this.beat(); }
        this.sinceBoard = '';
        continue;
      }
      if (this.st === 'check') {
        const close = this.sbuf.search(/<\/check\s*>/i);
        if (close < 0 && !final) {
          const keep = Math.min(this.sbuf.length, 9); // "</check>" may be split
          this.checkBuf = (this.checkBuf + this.sbuf.slice(0, this.sbuf.length - keep)).slice(0, CHECK_MAX + 16); // never spoken, however long
          this.sbuf = this.sbuf.slice(this.sbuf.length - keep);
          return out;
        }
        this.checkBuf += close < 0 ? this.sbuf : this.sbuf.slice(0, close);
        this.sbuf = close < 0 ? '' : this.sbuf.slice(close).replace(/^<\/check\s*>/i, '');
        const q = this.checkBuf.replace(/\s+/g, ' ').trim().slice(0, CHECK_MAX);
        if (q) this.check = q;
        this.checkBuf = '';
        this.st = 'text';
        continue;
      }
      if (this.st === 'el') {
        const r = this.scanEl(final);
        if (r === 'wait') return out;
        out += r;
        continue;
      }
      // Narration: pass through up to the next marker.
      if (this.owedWs && this.sbuf) { if (/^ /.test(this.sbuf)) this.sbuf = this.sbuf.slice(1); if (this.sbuf) this.owedWs = false; }
      const lt = this.sbuf.search(/<|```|\{\{\s*\/?svg\s*\}\}/i);
      if (lt < 0) { out += this.say(this.sbuf); this.sbuf = ''; return out; }
      out += this.say(this.sbuf.slice(0, lt));
      this.sbuf = this.sbuf.slice(lt);
      if (/^<plan\s*>/i.test(this.sbuf)) {
        this.sbuf = this.sbuf.replace(/^<plan\s*>/i, '');
        this.st = 'plan';
        // p6.1: the first sentence comes before the plan. Its last word goes out with a boundary now, so
        // it is spoken while the plan is written (a word is released only once whitespace follows it).
        const last = out ? out.slice(-1) : this.lastCh;
        if (last && !/\s/.test(last)) { out += ' '; this.owedWs = true; }
        continue;
      }
      if (/^<check\s*>/i.test(this.sbuf)) { this.sbuf = this.sbuf.replace(/^<check\s*>/i, ''); this.st = 'check'; continue; }
      const w = WRAPPERS.exec(this.sbuf);
      if (w) { this.sbuf = this.sbuf.slice(w[0].length); continue; }
      const m = OPEN.exec(this.sbuf);
      if (m && m.index === 0) {
        this.st = 'el'; this.el = { name: m[1].toLowerCase(), depth: 0, text: '' };
        if (this.el.name === 'g') {
          // The first group fixes the order: sentences before it since the board opened → trailing, unless it
          // is one sentence that marks the page (the old pointing order: that sentence is page talk).
          if (this.order == null) {
            const bare = this.sinceBoard.replace(/\{\{[^}]*\}\}/g, ' ');
            const n = (bare.match(/[.!?]["”’)\]]*(?=\s|$)/g) ?? []).length || (/[\p{L}\p{N}]/u.test(bare) ? 1 : 0);
            const marks = /\{\{\s*(?:highlight|underline|circle|box|scroll)\b[^}]*\bp=/.test(this.sinceBoard);
            this.order = n >= 2 || (n === 1 && !marks) ? 'trail' : 'lead';
            // A whole answer read one way on the evidence of its first group: seen in answers.jsonl and ?debug.
            if (this.order === 'trail') this.notes.push(`beat order: trailing (${n} sentence${n === 1 ? '' : 's'} before the first group): each group closes the sentences before it`);
            this.sinceBoard = '';
          }
          // Lead: the group opens its beat now (the gate may close the beat before while this one is written);
          // groups in a row share one beat.
          if (this.order === 'lead' && (this.beatWords || !this.beats)) out += this.beat();
        }
        continue;
      }
      // Could it still become a marker? Wait for more text (bounded); else it is narration ("x < 3").
      if (!final && this.sbuf.length < 16 && !/[\s>]/.test(this.sbuf.slice(1)) ) return out;
      if (!final && /^<(svg|plan|check|!--|\?xml|\/svg)/i.test(this.sbuf) && this.sbuf.length < 400) return out;
      if (!final && /^```/.test(this.sbuf) && this.sbuf.length < 12 && !/\n/.test(this.sbuf)) return out;
      if (!final && /^\{\{\s*\/?s?v?g?\s*\}?$/i.test(this.sbuf)) return out;
      out += this.say(this.sbuf[0]);
      this.sbuf = this.sbuf.slice(1);
    }
  }

  /** Inside a top-level element: collect until it closes (same-name nesting counted). */
  private scanEl(final: boolean): string | 'wait' {
    const name = this.el.name;
    const re = new RegExp(`<(/?)(${name})(?=[\\s/>])[^>]*?(/?)>`, 'gi');
    let m: RegExpExecArray | null;
    let endAt = -1;
    let depth = this.el.depth;
    re.lastIndex = 0;
    let scanned = 0;
    while ((m = re.exec(this.sbuf))) {
      scanned = re.lastIndex;
      if (m[1]) depth--;
      else if (!m[3]) depth++;
      if (depth <= 0) { endAt = re.lastIndex; break; }
    }
    if (endAt < 0) {
      if (this.el.text.length + this.sbuf.length > GROUP_MAX) {
        this.notes.push(`group over ${GROUP_MAX} characters dropped: ${(this.el.text + this.sbuf).slice(0, 60)}`);
        this.sbuf = ''; this.st = 'text'; this.el = { name: '', depth: 0, text: '' };
        // The rest of an oversized group arrives as narration-looking SVG; stop reading SVG from it.
        return '';
      }
      if (!final) {
        // Keep the unclosed tail (it may hold half an open/close tag); commit whole tags seen so far.
        this.el.text += this.sbuf.slice(0, scanned);
        this.sbuf = this.sbuf.slice(scanned);
        this.el.depth = depth;
        return 'wait';
      }
      // The stream ended inside a group: its whole children are kept and it is closed (completeSvg);
      // with none whole, it is dropped (half an element would fail to parse and lose the group).
      this.el.text += this.sbuf;
      this.sbuf = '';
      const whole = completeSvg(name === 'g' || name === 'defs' ? this.el.text : `<g>${this.el.text}`);
      if (!whole) { this.notes.push(`group cut off before a whole element: ${this.el.text.slice(0, 60)}`); this.st = 'text'; this.el = { name: '', depth: 0, text: '' }; return ''; }
      return this.emit(whole);
    }
    const text = this.el.text + this.sbuf.slice(0, endAt);
    this.sbuf = this.sbuf.slice(endAt);
    return this.emit(text);
  }

  private emit(svg: string): string {
    this.st = 'text';
    const name = this.el.name;
    this.el = { name: '', depth: 0, text: '' };
    if (svg.length > GROUP_MAX) { this.notes.push(`group over ${GROUP_MAX} characters dropped: ${svg.slice(0, 60)}`); return ''; }
    const body = name === 'g' || name === 'defs' ? svg : `<g>${svg}</g>`;
    const id = /^<g\b[^>]*?\bid\s*=\s*["']([^"']+)["']/i.exec(body)?.[1];
    if (id) this.groups.push(id);
    if (name === 'g' && this.order === 'trail') this.owedBeat = true;
    if (Number.isNaN(this.firstGroupMs)) this.firstGroupMs = this.now();
    let head = '';
    if (!this.opened) { this.opened = true; this.board = { w: BOARD_W, h: Math.round(BOARD_W * 0.7), extend: false }; head = svgboardTag(this.board) + ' '; }
    return `${head}{{svg ${escapeSvg(body)}}} `;
  }
}
