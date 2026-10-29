// server/boardFirst.ts — EXPERIMENT (PETU_PROMPT_VARIANT=boardfirst; live-vs-demo-boards.md §8.3).
/**
 * A board-first script declares the whole board before it speaks:
 *
 *   <board>{{sketch id=s near=p4 fit}} {{let on=s …}} {{line on=s id=r from=A to=B}} {{point on=s id=P at=P}} …</board>
 *   Narration that only reveals and changes: {{emph id=r}} this ray, {{set id=… }} …
 *
 * The engine draws an element on the word after its tag, so "hidden until referenced" is done here, on
 * the stream, before the client: a declared element is held back and emitted immediately before the
 * first narration tag that names its id (so it is drawn on that tag's word); what it names is emitted
 * first (a link brings its ends). A narration `{{emph id=…}}` whose ids were all hidden until then is
 * the reveal itself and is dropped (no second accent). Sections, constants and lets take effect at once
 * (they draw nothing). An element the narration never names is never shown (`stats().hidden`).
 *
 * Elements are laid out when revealed, in reveal order, not in declaration order: the minimal mechanism
 * (no engine change). Without a `<board>` block the stream passes through unchanged.
 */

/** Tags in the block that take effect at once: they open sections and name numbers, drawing nothing. */
const IMMEDIATE = new Set(['sketch', 'scene', 'let', 'const']);
/** Tags that change or point at what exists: they stay in the narration even when they carry on=. */
const NARRATION = new Set(['merge', 'emph', 'fade', 'move', 'set', 'tween', 'connect', 'split', 'step', 'sweep', 'col', 'val', 'beforeafter', 'limit', 'contrast', 'band', 'dist', 'level', 'scroll', 'clear']);

const kindOf = (tag: string) => /^\{\{\s*([A-Za-z]+)/.exec(tag)?.[1]?.toLowerCase() ?? '';
const idOf = (tag: string) => /(?:^|\s)id=([^\s}]+)/.exec(tag.slice(2, -2))?.[1];

/** Is this tag a board element (declared in the block, hidden until named)? */
export function isBoardElement(tag: string): boolean {
  const k = kindOf(tag);
  if (IMMEDIATE.has(k) || NARRATION.has(k)) return false;
  if (k === 'find' || k === 'zoom') return true;
  return /(?:^|\s)on=/.test(tag.slice(2, -2));
}

/** Identifier tokens a tag names (quoted text, key names and #marks excluded). */
export function namesIn(tag: string): string[] {
  const body = tag.slice(2, -2).replace(/"[^"]*"|“[^”]*”/g, ' ').replace(/^\s*[A-Za-z]+/, ' ');
  const out: string[] = [];
  for (const m of body.matchAll(/(?<![#\w′'.])([A-Za-z_][\w′']*)(=?)/g)) if (!m[2]) out.push(m[1]);
  return out;
}

const TAG = /\{\{[\s\S]*?\}\}/g;
type Decl = { id: string | undefined; text: string; deps: string[] };
export type BoardFirstStats = { declared: number; revealed: number; hidden: string[]; immediate: number; noId: number };

export class BoardFirst {
  private buf = '';
  private state: 'pre' | 'board' | 'narr' = 'pre';
  private block = '';
  private decls = new Map<string, Decl>();
  private shown = new Set<string>();
  private noId = 0;
  private immediate = 0;

  push(s: string): string { this.buf += s; return this.drain(false); }
  end(): string { return this.drain(true); }
  stats(): BoardFirstStats {
    return { declared: this.decls.size + this.noId, revealed: this.shown.size, hidden: [...this.decls.keys()].filter((k) => !this.shown.has(k)), immediate: this.immediate, noId: this.noId };
  }

  private drain(final: boolean): string {
    let out = '';
    for (;;) {
      if (this.state === 'pre') {
        const i = this.buf.indexOf('<board>');
        if (i >= 0) { out += this.buf.slice(0, i); this.buf = this.buf.slice(i + 7); this.state = 'board'; continue; }
        const hold = final ? 0 : partial(this.buf, '<board>');
        out += this.narrate(this.buf.slice(0, this.buf.length - hold), final);
        this.buf = this.buf.slice(this.buf.length - hold);
        return out;
      }
      if (this.state === 'board') {
        const i = this.buf.indexOf('</board>');
        if (i < 0 && !final) { const hold = partial(this.buf, '</board>'); this.block += this.buf.slice(0, this.buf.length - hold); this.buf = this.buf.slice(this.buf.length - hold); return out; }
        this.block += i < 0 ? this.buf : this.buf.slice(0, i);
        this.buf = i < 0 ? '' : this.buf.slice(i + 8);
        out += this.close();
        this.state = 'narr';
        continue;
      }
      out += this.narrate(this.buf, final);
      this.buf = '';
      return out;
    }
  }

  /** The block is complete: immediate tags go out now (in order), elements wait. */
  private close(): string {
    const tags = this.block.match(TAG) ?? [];
    let out = '';
    const els: string[] = [];
    for (const t of tags) {
      if (isBoardElement(t)) els.push(t);
      else { out += t + ' '; this.immediate++; } // a stray narration-kind tag in the block takes effect at once too
    }
    for (const t of els) {
      const id = idOf(t);
      if (!id || this.decls.has(id)) { this.noId++; continue; }
      this.decls.set(id, { id, text: t, deps: [] });
    }
    for (const d of this.decls.values()) d.deps = namesIn(d.text).filter((n) => n !== d.id && this.decls.has(n));
    return out;
  }

  private pending = '';
  /** Narration: each tag first brings in the hidden elements it names. */
  private narrate(s: string, final: boolean): string {
    this.pending += s;
    let out = '';
    for (;;) {
      const i = this.pending.indexOf('{{');
      if (i < 0) {
        const hold = final ? 0 : (this.pending.endsWith('{') ? 1 : 0);
        out += this.pending.slice(0, this.pending.length - hold);
        this.pending = this.pending.slice(this.pending.length - hold);
        return out;
      }
      const j = this.pending.indexOf('}}', i);
      if (j < 0) { if (final) { out += this.pending; this.pending = ''; } else { out += this.pending.slice(0, i); this.pending = this.pending.slice(i); } return out; }
      out += this.pending.slice(0, i);
      const tag = this.pending.slice(i, j + 2);
      this.pending = this.pending.slice(j + 2);
      out += this.reference(tag);
    }
  }

  private reference(tag: string): string {
    if (this.state !== 'narr') return tag;
    const named = namesIn(tag).filter((n) => this.decls.has(n) && !this.shown.has(n));
    if (!named.length) return tag;
    let out = '';
    const reveal = (id: string) => {
      if (this.shown.has(id)) return;
      this.shown.add(id);
      const d = this.decls.get(id)!;
      for (const dep of d.deps) reveal(dep);
      out += d.text + ' ';
    };
    named.forEach(reveal);
    if (kindOf(tag) === 'emph') {
      const ids = (idOf(tag) ?? '').split(',').map((x) => x.replace(/[[.].*$/, ''));
      if (ids.every((x) => named.includes(x))) return out.trimEnd();
    }
    return out + tag;
  }
}

/** How many trailing characters of s could start `marker`. */
function partial(s: string, marker: string): number {
  for (let k = Math.min(marker.length - 1, s.length); k > 0; k--) if (marker.startsWith(s.slice(-k))) return k;
  return 0;
}

/**
 * An interleaved script in board-first form (for the variant's examples): every board element moves,
 * in order, into a leading <board> block (given an id when it has none) and is replaced in the
 * narration by {{emph id=…}}; sections, lets and constants move into the block too.
 */
export function toBoardFirst(script: string): string {
  const block: string[] = [];
  const plans = script.match(/<plan>[\s\S]*?<\/plan>/g) ?? [];
  script = script.replace(/<plan>[\s\S]*?<\/plan>/g, ' ');
  let n = 0;
  const taken = new Set((script.match(TAG) ?? []).map(idOf).filter(Boolean) as string[]);
  const fresh = () => { let id; do id = `e${++n}`; while (taken.has(id)); taken.add(id); return id; };
  const narr = script.replace(TAG, (t) => {
    const k = kindOf(t);
    if (IMMEDIATE.has(k)) { block.push(t); return ''; }
    if (!isBoardElement(t)) return t;
    let id = idOf(t);
    if (!id) { id = fresh(); t = t.replace(/^\{\{\s*[A-Za-z]+/, (h) => `${h} id=${id}`); }
    block.push(t);
    return `{{emph id=${id}}}`;
  }).replace(/ {2,}/g, ' ').trim();
  return block.length ? `<board>${plans.join('')}${block.join(' ')}</board>\n${narr}` : narr;
}
