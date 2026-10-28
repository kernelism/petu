// server/scriptFilter.ts
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
  plan = '';
  push(chunk: string): string { this.buf += chunk; return this.drain(false); }
  end(): string { return this.drain(true); }

  private drain(final: boolean): string {
    let out = '';
    for (;;) {
      if (this.inPlan) {
        const close = this.buf.indexOf('</plan>');
        if (close < 0) { const keep = final ? 0 : 6; this.plan += this.buf.slice(0, Math.max(0, this.buf.length - keep)); this.buf = this.buf.slice(Math.max(0, this.buf.length - keep)); if (final) this.buf = ''; return out; }
        this.plan += this.buf.slice(0, close);
        this.buf = this.buf.slice(close + 7);
        this.inPlan = false;
        continue;
      }
      if (!this.buf.length) return out;
      if (this.inTag) {
        const close = this.buf.indexOf('}}');
        if (close < 0) { if (final) { out += this.buf; this.buf = ''; return out; } const cut = this.buf.endsWith('}') ? this.buf.length - 1 : this.buf.length; out += this.buf.slice(0, cut); this.buf = this.buf.slice(cut); return out; }
        out += this.buf.slice(0, close + 2);
        this.buf = this.buf.slice(close + 2);
        this.inTag = false;
        continue;
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
      if (next === tag) { this.inTag = true; out += '{{'; this.buf = this.buf.slice(next + 2); }
      else { this.inPlan = true; this.buf = this.buf.slice(next + 6); }
    }
  }
}

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
