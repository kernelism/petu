import type { ScriptEvent } from './types';
import { parseTag } from './parseTag';

const words = (s: string): ScriptEvent[] =>
  s.split(/\s+/).filter(Boolean).map((text) => ({ type: 'word', text }));

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
      const close = this.buf.indexOf('}}');
      if (close === -1) {
        if (final) this.buf = '';
        return out;
      }
      const body = this.buf.slice(2, close);
      const action = parseTag(body);
      if (action) out.push({ type: 'action', action });
      else console.warn('[script] skipped malformed tag:', body);
      this.buf = this.buf.slice(close + 2);
    }
  }
}
