// server/scriptFilter.ts
import { tagLimit } from '../src/svgboard/wire';
/**
 * Streaming clean-up between the model and the client parser, applied identically by the dev
 * server and the eval runner:
 *  - `<plan>…</plan>` is the model's private sketch plan (written after its first sentence, while
 *    that sentence is being spoken): removed from the stream, kept for ?debug and the eval.
 *  - Markdown and TeX delimiters in narration (`**`, `__`, backticks, `\(` `\)`, `$`), headings and
 *    list bullets at line starts are removed. Inside {{tags}} nothing is touched (math tags carry TeX).
 * Holds back only what could be the start of a marker, so text flows with ≤ 7 chars of delay.
 */
export class ScriptFilter {
  private buf = '';
  private inPlan = false;
  private inTag = false;
  /** Characters of the current tag passed so far, `{{` included. */
  private tagLen = 0;
  /** The current tag's length limit (an svg group tag is long: src/svgboard/wire.ts). */
  private tagMax = MAX_TAG;
  plan = '';
  push(chunk: string): string { this.buf += chunk; return this.drain(false); }
  end(): string { return this.drain(true); }

  private drain(final: boolean): string {
    let out = '';
    for (;;) {
      if (this.inPlan) {
        // A plan ends at </plan>; an unclosed one at a blank line or the next tag, and never runs
        // past PLAN_MAX characters (so it cannot swallow the answer or leak into captions).
        const room = PLAN_MAX - this.plan.length;
        const ends = [[this.buf.indexOf('</plan>'), 7], [this.buf.indexOf('\n\n'), 2], [this.buf.indexOf('{{'), 0]].filter(([i]) => i >= 0).sort((a, b) => a[0] - b[0]);
        const [at, skip] = ends[0] ?? [-1, 0];
        if (at >= 0 && at <= room) { this.plan += this.buf.slice(0, at); this.buf = this.buf.slice(at + skip); this.inPlan = false; continue; }
        const avail = Math.max(0, this.buf.length - (final ? 0 : 6)); // "</plan" may be split
        if (at > room || avail >= room) { this.plan += this.buf.slice(0, room); this.buf = this.buf.slice(room); this.inPlan = false; continue; }
        this.plan += this.buf.slice(0, avail);
        this.buf = final ? '' : this.buf.slice(avail);
        return out;
      }
      if (!this.buf.length) return out;
      if (this.inTag) {
        // The same rule as Lint (and, within its tighter length, the parser): a tag ends at `}}`;
        // a newline or MAX_TAG characters without one means it was never a tag.
        const room = this.tagMax - this.tagLen;
        const close = this.buf.indexOf('}}'), nl = this.buf.indexOf('\n');
        if (close >= 0 && (nl < 0 || close < nl) && close + 2 <= room) {
          out += this.buf.slice(0, close + 2);
          this.buf = this.buf.slice(close + 2);
          this.inTag = false;
          continue;
        }
        const fail = nl >= 0 && nl < room ? nl : this.buf.length >= room ? room : -1;
        if (fail >= 0) { out += this.buf.slice(0, fail); this.buf = this.buf.slice(fail); this.inTag = false; continue; }
        if (final) { out += this.buf; this.buf = ''; return out; }
        const cut = this.buf.endsWith('}') ? this.buf.length - 1 : this.buf.length;
        out += this.buf.slice(0, cut);
        this.tagLen += cut;
        this.buf = this.buf.slice(cut);
        return out;
      }
      const tag = this.buf.indexOf('{{'), plan = this.buf.indexOf('<plan>');
      const next = [tag, plan].filter((i) => i >= 0).sort((a, b) => a - b)[0];
      if (next === undefined) {
        // Hold back a possible partial marker ("{", "<pla", "\", "*").
        const hold = final ? 0 : partialTail(this.buf);
        out += clean(this.buf.slice(0, this.buf.length - hold));
        this.buf = this.buf.slice(this.buf.length - hold);
        return out;
      }
      out += clean(this.buf.slice(0, next));
      if (next === tag) { this.inTag = true; this.tagLen = 2; out += '{{'; this.buf = this.buf.slice(next + 2); this.tagMax = tagLimit(this.buf, MAX_TAG); }
      else { this.inPlan = true; this.buf = this.buf.slice(next + 6); }
    }
  }
}

/** A `{{` with no `}}` within this many characters (`{{` included) is narration (Lint's rule). */
export const MAX_TAG = 801;
/** An unclosed plan stops here. */
export const PLAN_MAX = 1500;

function partialTail(s: string): number {
  for (let k = Math.min(6, s.length); k > 0; k--) if ('<plan>'.startsWith(s.slice(-k))) return k;
  const m = s.match(/[*_\\{]{1,2}$/); // "**", "__", "\(" and "{{" may be split across chunks
  return m ? m[0].length : 0;
}

/** Narration only (never inside tags). */
export function clean(s: string): string {
  return s
    .replace(/\\[()[\]]/g, '')
    .replace(/\*\*|__|`/g, '')
    .replace(/(\n)\s*(#{1,6}\s|[-*•]\s|\d+\.\s)/g, '$1')
    .replace(/\$/g, '');
}
