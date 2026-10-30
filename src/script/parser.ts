import type { RawAction, ScriptEvent, ValAction } from './types';
import { parseTag } from './parseTag';
import { GateState, UNBOUND_TEXT } from '../gate/engine';
import { cutTagBody, isSvgTagBody, SVG_TAG_MAX } from '../svgboard/wire';

const words = (s: string): ScriptEvent[] =>
  s.split(/\s+/).filter(Boolean).map((text) => ({ type: 'word', text }));

/** A `{{` with no `}}` within this many chars is not a tag. */
/** Long enough for a figure's whole {{let}} (a fitted figure with ~20 named points runs ~400). */
export const MAX_TAG_CHARS = 800;
const QUOTE_CLOSE: Record<string, string> = { '"': '"', '“': '”' };

/** Warned when the stream ends inside a tag and nothing of it is kept (the eval counts these as unclosed). */
export const CUT_TAG = '[script] dropped a tag the stream cut off:';

type Scan = { kind: 'close'; end: number } | { kind: 'fail'; cut: number } | { kind: 'wait' } | { kind: 'cut' };

/**
 * Looks for the `}}` closing the tag opened at `open`, skipping quoted spans ("…" and “…”), so a
 * `}}` inside a quote doesn't close it. The tag fails (its text is narration after all) on a
 * newline, another `{{`, or MAX_TAG_CHARS without a close. Decisions depend only on the text, never
 * on where chunks were split.
 */
function scanTag(buf: string, open: number, final: boolean): Scan {
  // An svg group tag (src/svgboard/wire.ts) is long and its quotes are SVG's: only `}}` closes it.
  const svg = isSvgTagBody(buf.slice(open + 2, open + 8));
  const limit = open + (svg ? SVG_TAG_MAX : MAX_TAG_CHARS);
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
    if (c in QUOTE_CLOSE && !svg) { quote = QUOTE_CLOSE[c]; continue; }
    if (c === '}' && buf[i + 1] === '}') return { kind: 'close', end: i + 2 };
    if (c === '{' && buf[i + 1] === '{') return { kind: 'fail', cut: i };
  }
  // The stream ended inside the tag (a cut-off): half a tag is never narration.
  return final ? { kind: 'cut' } : { kind: 'wait' };
}

/**
 * Incremental parser for `narration {{tag ...}} narration`. Chunk boundaries can fall anywhere.
 *
 * Every parsed tag is applied to a value model (the engine's numbers, headless: src/gate/engine.ts),
 * in stream order, so a `{{val id=…}}` becomes a narration word with the engine's value — glued to
 * the text touching it ("${{val id=c}}." → "$4.5.") — and a `{{contrast}}` becomes the copy it
 * draws. The val action is emitted too (with `said`/`spoken`, or neither when unresolved: the word
 * is then UNBOUND_TEXT and the director records the skip).
 */
export class ScriptParser {
  private buf = '';
  /** A val's word, waiting to see whether text touches it on the right. */
  private held: string | null = null;
  readonly values: GateState;
  private n = 0;

  constructor(values?: GateState) { this.values = values ?? new GateState(); }

  push(chunk: string): ScriptEvent[] {
    this.buf += chunk;
    return this.drain(false);
  }

  end(): ScriptEvent[] {
    const out = this.drain(true);
    out.push({ type: 'end' });
    return out;
  }

  /** Applies a parsed tag to the value model; returns what to emit. */
  private take(a: RawAction, out: ScriptEvent[], touchesLeft: boolean): void {
    const k = this.n++;
    if (a.kind === 'contrast') {
      const e = this.values.expand(a);
      // Not expandable (no such plot, block or constant): the director skips it with its reason.
      if (typeof e === 'string') { out.push({ type: 'action', action: a }); return; }
      this.values.note(e);
      this.values.apply(e, k);
      out.push({ type: 'action', action: e });
      return;
    }
    if (a.kind === 'val' && a.x != null) {
      // {{val id=p.y x=0}}: the readout {{find id=… of=p x=0}} would name, said here.
      const [plot, field] = a.ref.split('.');
      let id = `${plot}_at`;
      for (let i = 2; this.values.ids.has(id) || this.values.finds.has(id); i++) id = `${plot}_at${i}`;
      const find: RawAction = { kind: 'find', id, of: [plot], mode: 'at', x: a.x };
      this.take(find, out, false);
      const { x: _x, ...rest } = a;
      a = { ...rest, ref: `${id}.${field ?? 'y'}` };
    }
    if (a.kind === 'val') {
      const s = this.values.say(a);
      const v: ValAction = s ? { ...a, ...s } : a;
      // The word: glued to a word touching the tag on its left ("$"); the right side is settled once seen.
      let text = s?.said ?? UNBOUND_TEXT;
      const last = out[out.length - 1];
      if (touchesLeft && last?.type === 'word') { out.pop(); text = last.text + text; }
      out.push({ type: 'action', action: v });
      this.held = text;
      return;
    }
    if (a.kind === 'plot' && a.axes && !a.domainSrc && !a.domain && !a.t && !a.onChart) a = this.hostDomain(a);
    this.values.note(a);
    try { this.values.apply(a, k); } catch (e) { console.warn('[script] value model:', e); }
    out.push({ type: 'action', action: a });
  }

  /** A plot drawn onto another plot's axes without its own domain= takes the host's (its x axis). */
  private hostDomain(a: Extract<RawAction, { kind: 'plot' }>): RawAction {
    const host = this.values.plotSrc.get(a.axes!)?.a;
    if (!host || host.t) return a; // unknown or parametric host: no x domain to share; the board says why
    return { ...a, ...(host.domainSrc ? { domainSrc: host.domainSrc } : {}), ...(host.domain ? { domain: host.domain } : {}) };
  }

  /** Emits a held val word, glued to a word touching it on the right. False: wait for more text. */
  private release(out: ScriptEvent[], final: boolean): boolean {
    if (this.held == null) return true;
    const m = /^[^\s{]+/.exec(this.buf);
    if (!m && !this.buf.length && !final) return false;
    if (m && m[0].length === this.buf.length && !final) return false; // the touching word may go on
    out.push({ type: 'word', text: this.held + (m ? m[0] : '') });
    if (m) this.buf = this.buf.slice(m[0].length);
    this.held = null;
    return true;
  }

  private drain(final: boolean): ScriptEvent[] {
    const out: ScriptEvent[] = [];
    for (;;) {
      if (!this.release(out, final)) return out;
      const open = this.buf.indexOf('{{');
      if (open === -1) {
        // Hold back a trailing partial word (it may also be a lone '{' starting a tag).
        const cut = final ? this.buf.length : this.buf.search(/\S*$/);
        out.push(...words(this.buf.slice(0, cut)));
        this.buf = this.buf.slice(cut);
        return out;
      }
      const before = this.buf.slice(0, open);
      out.push(...words(before));
      this.buf = this.buf.slice(open);
      const s = scanTag(this.buf, 0, final);
      if (s.kind === 'wait') return out;
      if (s.kind === 'cut') {
        // An svg group keeps its whole children (completeSvg); any other half tag is dropped.
        const body = cutTagBody(this.buf.slice(2));
        const action = body ? parseTag(body) : null;
        if (action) this.take(action, out, open > 0 && /\S/.test(before.slice(-1)));
        else console.warn(CUT_TAG, this.buf.slice(0, 60));
        this.buf = '';
        continue;
      }
      if (s.kind === 'fail') {
        // Not a tag: its text is narration.
        out.push(...words(this.buf.slice(0, s.cut)));
        this.buf = this.buf.slice(s.cut);
        continue;
      }
      const body = this.buf.slice(2, s.end - 2);
      const action = parseTag(body, { isConst: (n) => n.toLowerCase() in this.values.consts });
      if (action) this.take(action, out, open > 0 && /\S/.test(before.slice(-1)));
      else console.warn('[script] skipped malformed tag:', body);
      this.buf = this.buf.slice(s.end);
    }
  }
}
