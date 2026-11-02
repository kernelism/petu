// server/lint.ts
import { parseTag } from '../src/script/parseTag';
import { isSvgTagBody, tagLimit } from '../src/svgboard/wire';
/** Every tag name the parser knows (src/script/parseTag.ts). */
export const TAG_NAMES = new Set(['beat', 'scroll', 'highlight', 'underline', 'circle', 'box', 'line', 'arrow', 'point', 'label', 'curve', 'shade', 'angle', 'brace', 'write', 'math', 'axes', 'plot', 'let', 'sketch', 'connect', 'emph', 'move', 'fade', 'clear',
  // the visual kit (src/script/parseKit.ts)
  'grid', 'bars', 'scatter', 'table', 'calc', 'fit', 'step', 'sweep', 'set', 'band', 'dist', 'col', 'level', 'const',
  // Board v2 (src/script/parseScene.ts)
  'scene', 'node', 'flow', 'link', 'note', 'shares', 'blend', 'group', 'pair', 'merge', 'split',
  // amounts, counts and distributions (a count as marks)
  'tokens',
  // a magnifier inset on the board (src/desk/zoom.ts)
  'zoom',
  // bound numbers, readouts, demonstration moves (src/script/parseValues.ts)
  'val', 'find', 'contrast', 'limit', 'beforeafter', 'tween',
  // the slide as canvas: a page region onto the board
  'lift',
  // slips the parser reads as another tag ({{arc center= from= to=}} is an angle's arc when exact)
  'arc',
  // the svg board (src/svgboard/wire.ts)
  'svgboard', 'svg']);
/**
 * Grammar checks on the stream, for the debug panel and the eval (`done.lint`). Lessons v3: no
 * style counts (no caps on drawings, accents or sketches); the prompt shapes the answer. Lint never
 * changes the stream: the parser skips a malformed tag and the director skips an unresolvable one,
 * each with its own reason. Lint only notes what it sees: an unknown tag name, an unclosed quote, a
 * malformed tag. (svg groups bypass it; the tag-board notes it once had went with the tag prompt.)
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
      else if (this.buf.length > tagLimit(this.buf.slice(2, 8), 800) || c === '\n') { // not a tag (parser rule)
        if (this.buf.length > 800) this.notes.push(`tag over 800 characters (spoken as words, not drawn): ${this.buf.slice(0, 60)} — ${/^\{\{\s*curve\b/i.test(this.buf) ? 'draw a curve from its formula with {{plot fn=}}' : 'split it into several tags'}`);
        out += this.buf; this.buf = ''; this.inTag = false;
      }
    }
    return out;
  }
  end(): string { const b = this.buf; this.buf = ''; this.inTag = false; return b; }
  private tag(t: string): string {
    // An svg group: the gate checks it (src/svgboard/check.ts); its quotes and numbers are SVG's.
    if (isSvgTagBody(t.slice(2))) return t;
    const name = /^\{\{\s*([A-Za-z]+)/.exec(t)?.[1]?.toLowerCase();
    if (!name || !TAG_NAMES.has(name)) this.notes.push(`unknown tag ${JSON.stringify(t.slice(0, 40))}`);
    const quotes = (t.match(/"/g) ?? []).length;
    if (quotes % 2) this.notes.push(`unclosed quote in ${JSON.stringify(t.slice(0, 40))}`);
    // The same parser the client runs: a malformed tag is dropped there, so note it here with its raw text.
    if (name && TAG_NAMES.has(name) && !parseTag(t.slice(2, -2))) this.notes.push(`malformed (dropped): ${t.slice(0, 300)}`);
    return t;
  }
}
