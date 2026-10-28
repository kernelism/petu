// server/lint.ts
/** Every tag name the parser knows (src/script/parseTag.ts). */
export const TAG_NAMES = new Set(['scroll', 'highlight', 'underline', 'circle', 'box', 'line', 'arrow', 'point', 'label', 'curve', 'shade', 'angle', 'brace', 'write', 'math', 'axes', 'plot', 'let', 'sketch', 'connect', 'emph', 'move', 'fade', 'clear']);

/**
 * Grammar checks on the stream, for the debug panel and the eval (`done.lint`). Lessons v3: no
 * style counts (no caps on drawings, accents or sketches); the prompt shapes the answer. Lint never
 * changes the stream: the parser skips a malformed tag and the director skips an unresolvable one,
 * each with its own reason. Lint only notes what it sees: an unknown tag name, an unclosed quote.
 */
export class Lint {
  private buf = ''; private inTag = false;
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
    const name = /^\{\{\s*([A-Za-z]+)/.exec(t)?.[1]?.toLowerCase();
    if (!name || !TAG_NAMES.has(name)) this.notes.push(`unknown tag ${JSON.stringify(t.slice(0, 40))}`);
    const quotes = (t.match(/"/g) ?? []).length;
    if (quotes % 2) this.notes.push(`unclosed quote in ${JSON.stringify(t.slice(0, 40))}`);
    return t;
  }
}
