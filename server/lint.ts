// server/lint.ts
const DRAW = /^\{\{\s*(circle|box|highlight|underline|line|arrow|point|curve|shade|angle|brace|axes|plot|math|write|label|connect)\b/i;
export const MAX_DRAW = 10, MAX_EM = 3, MAX_SKETCH = 2;

/**
 * Streaming guard against runaway answers; the prompt does the real work. Over-limit tags are
 * dropped (their tag text only — the narration stays) or lose their `em` flag. Text outside tags
 * passes through untouched. Notes go to `done.lint`.
 */
export class Lint {
  private buf = ''; private inTag = false;
  private draws = 0; private ems = 0; private sketches = 0;
  notes: string[] = [];
  push(s: string): string {
    let out = '';
    for (const c of s) {
      if (!this.inTag) {
        if (c === '{' && this.buf === '{') { this.inTag = true; this.buf = '{{'; continue; }
        if (c === '{') { out += this.buf; this.buf = '{'; continue; }
        out += this.buf + c; this.buf = '';
        continue;
      }
      this.buf += c;
      if (this.buf.endsWith('}}')) { out += this.tag(this.buf); this.buf = ''; this.inTag = false; }
      else if (this.buf.length > 400 || c === '\n') { out += this.buf; this.buf = ''; this.inTag = false; } // not a tag (parser rule)
    }
    return out;
  }
  end(): string { const b = this.buf; this.buf = ''; this.inTag = false; return b; }
  private tag(t: string): string {
    if (/^\{\{\s*sketch\b/i.test(t) && ++this.sketches > MAX_SKETCH) { this.notes.push('dropped extra sketch'); return ''; }
    if (DRAW.test(t) && ++this.draws > MAX_DRAW) { this.notes.push(`dropped drawing #${this.draws}`); return ''; }
    if (/\sem(\s|\}\})/.test(t) && ++this.ems > MAX_EM) { this.notes.push('removed extra em'); return t.replace(/\sem(?=\s|\}\})/, ''); }
    return t;
  }
}
