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
/** A curve through this many hand-placed points or more is probably something that follows from a formula. */
const HAND_CURVE_PTS = 4;
/** Kit tags whose values come from the engine: a literal result in them (`result=`, `=…` after an op) is the model computing by hand. */
const KIT_COMPUTED = /^\{\{\s*(grid|bars|calc)\b[^}]*\b(result|value|answer|out)=/i;

/**
 * Grammar checks on the stream, for the debug panel and the eval (`done.lint`). Lessons v3: no
 * style counts (no caps on drawings, accents or sketches); the prompt shapes the answer. Lint never
 * changes the stream: the parser skips a malformed tag and the director skips an unresolvable one,
 * each with its own reason. Lint only notes what it sees: an unknown tag name, an unclosed quote.
 */
export class Lint {
  private buf = ''; private inTag = false;
  private seen = new Map<string, string>();
  /** Constants declared so far, and names used (in a formula or a {{val}}) before any constant had that name. */
  private consts = new Set<string>();
  private early = new Map<string, string>();
  private sections = new Set<string>();
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
    if (KIT_COMPUTED.test(t)) this.notes.push(`hand-computed result in ${JSON.stringify(t.slice(0, 40))}`);
    // The same parser the client runs: a malformed tag is dropped there, so note it here with its raw text.
    const a = name && TAG_NAMES.has(name) ? parseTag(t.slice(2, -2)) : null;
    if (name && TAG_NAMES.has(name) && !a) { const h = hint(t.slice(2, -2)); this.notes.push(`malformed (dropped): ${t.slice(0, 300)}${h ? ` — ${h}` : ''}`); }
    if (a?.kind === 'sketch') this.sections.add(a.id);
    // A section is not an element: emph flashes its frame, but fade has no one meaning (which of its elements?).
    if (a?.kind === 'fade' && this.sections.has(a.ref.toLowerCase())) this.notes.push(`fade id=${a.ref} names a section: fade the elements inside it by their ids`);
    if (a) {
      const x = a as unknown as Record<string, unknown>;
      // Constants before statements: a name a formula or a {{val}} used before its {{const}}.
      if (a.kind === 'const') {
        for (const [k] of a.defs) {
          const n = k.toLowerCase(), first = this.early.get(n);
          if (first && !this.consts.has(n)) this.notes.push(`constant ${k} used before it is declared: ${first.slice(0, 120)}`);
          this.consts.add(n);
        }
      } else for (const n of usedNames(a)) if (!this.consts.has(n) && !this.early.has(n)) this.early.set(n, t);
      // Notes, not skips: hand-placed geometry where a formula would do, and a drawing made twice.
      if (a.kind === 'curve' && Array.isArray(x.pts) && x.pts.length >= HAND_CURVE_PTS) this.notes.push(`hand-placed curve (${x.pts.length} points): draw it from its formula with {{plot}}: ${t.slice(0, 120)}`);
      if (['line', 'arrow', 'curve', 'circle', 'box', 'shade', 'brace'].includes(a.kind) && 'region' in a) {
        const { id: _id, em: _em, ...geo } = x;
        void _id; void _em;
        const key = JSON.stringify(geo);
        const prev = this.seen.get(key);
        if (prev) this.notes.push(`duplicate drawing (same as ${prev.slice(0, 80)}): reuse it by id: ${t.slice(0, 120)}`);
        else this.seen.set(key, t);
      }
    }
    return t;
  }
}

/** For a malformed tag the engine cannot read in one way only: what to write instead (or undefined). */
function hint(body: string): string | undefined {
  const two = /\bvals=([A-Za-z][\w]*\.[^\s,;]+),([A-Za-z][\w]*\.[^\s,;]+)/.exec(body);
  if (two) return `vals= takes one column: use map=${two[1]} fn="x" for one, or two blocks`;
  if (/^\s*plot\b/i.test(body) && !/\bdomain=/.test(body) && !/\bt=/.test(body)) return 'a plot needs domain=a,b (or axes= another plot, to share its domain)';
  if (/^\s*arc\b/i.test(body)) return 'arc is an angle\'s arc in a section: arc on=s center=P from=A to=B (A and B equally far from P)';
  return undefined;
}

/** Names a tag reads as numbers: identifiers in its formulas, and a {{val}}'s base name. */
function usedNames(a: NonNullable<ReturnType<typeof parseTag>>): string[] {
  const x = a as unknown as Record<string, unknown>;
  const srcs: string[] = [];
  if (a.kind === 'val') return [a.ref.replace(/[[.].*$/, '').toLowerCase()];
  for (const k of ['fn', 'x', 'y', 'level', 'from', 'to'] as const) if (typeof x[k] === 'string') srcs.push(x[k] as string);
  for (const k of ['t', 'domainSrc', 'set'] as const) if (Array.isArray(x[k])) srcs.push(...(x[k] as unknown[]).filter((v): v is string => typeof v === 'string'));
  const src = x.src as { fn?: string } | undefined;
  if (src?.fn) srcs.push(src.fn);
  return srcs.flatMap((s) => s.match(/[A-Za-z_][A-Za-z0-9_]*/g) ?? []).map((n) => n.toLowerCase());
}
