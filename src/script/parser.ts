import type { ScriptEvent } from './types';
import { parseTag } from './parseTag';

const words = (s: string): ScriptEvent[] =>
  s.split(/\s+/).filter(Boolean).map((text) => ({ type: 'word', text }));

/** A `{{` with no `}}` within this many chars is not a tag. */
export const MAX_TAG_CHARS = 300;
const QUOTE_CLOSE: Record<string, string> = { '"': '"', '“': '”' };

type Scan = { kind: 'close'; end: number } | { kind: 'fail'; cut: number } | { kind: 'wait' };

/**
 * Looks for the `}}` closing the tag opened at `open`, skipping quoted spans ("…" and “…”), so a
 * `}}` inside a quote doesn't close it. The tag fails (its text is narration after all) on a
 * newline, another `{{`, or MAX_TAG_CHARS without a close. Decisions depend only on the text, never
 * on where chunks were split.
 */
function scanTag(buf: string, open: number, final: boolean): Scan {
  const limit = open + MAX_TAG_CHARS;
  const overflow = (): Scan => {
    const ws = Math.max(buf.lastIndexOf(' ', limit), buf.lastIndexOf('\t', limit));
    return { kind: 'fail', cut: ws > open + 2 ? ws : limit };
  };
  let quote: string | null = null;
  for (let i = open + 2; i < buf.length; i++) {
    if (i >= limit) return overflow();
    const c = buf[i];
    if (c === '\n' || c === '\r') return { kind: 'fail', cut: i };
    if (quote) { if (c === quote) quote = null; continue; }
    if (c in QUOTE_CLOSE) { quote = QUOTE_CLOSE[c]; continue; }
    if (c === '}' && buf[i + 1] === '}') return { kind: 'close', end: i + 2 };
    if (c === '{' && buf[i + 1] === '{') return { kind: 'fail', cut: i };
  }
  return final ? { kind: 'fail', cut: buf.length } : { kind: 'wait' };
}

/** Incremental parser for `narration {{tag ...}} narration`. Chunk boundaries can fall anywhere. */
export class ScriptParser {
  private buf = '';

  push(chunk: string): ScriptEvent[] {
    this.buf += chunk;
    return this.drain(false);
  }

  end(): ScriptEvent[] {
    const out = this.drain(true);
    out.push({ type: 'end' });
    return out;
  }

  private drain(final: boolean): ScriptEvent[] {
    const out: ScriptEvent[] = [];
    for (;;) {
      const open = this.buf.indexOf('{{');
      if (open === -1) {
        // Hold back a trailing partial word (it may also be a lone '{' starting a tag).
        const cut = final ? this.buf.length : this.buf.search(/\S*$/);
        out.push(...words(this.buf.slice(0, cut)));
        this.buf = this.buf.slice(cut);
        return out;
      }
      out.push(...words(this.buf.slice(0, open)));
      this.buf = this.buf.slice(open);
      const s = scanTag(this.buf, 0, final);
      if (s.kind === 'wait') return out;
      if (s.kind === 'fail') {
        // Not a tag: its text is narration.
        out.push(...words(this.buf.slice(0, s.cut)));
        this.buf = this.buf.slice(s.cut);
        continue;
      }
      const body = this.buf.slice(2, s.end - 2);
      const action = parseTag(body);
      if (action) out.push({ type: 'action', action });
      else console.warn('[script] skipped malformed tag:', body);
      this.buf = this.buf.slice(s.end);
    }
  }
}
