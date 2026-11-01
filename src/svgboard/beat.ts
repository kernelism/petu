// src/svgboard/beat.ts — the svg answer's beat: one drawing and the sentences said over it, as one unit
// from the wire to playback. Shared by the server filter (server/svgBeats.ts, which writes the
// boundaries), the gate (src/gate/segment.ts: a gate unit is one beat), the scheduler (a group's anchor
// is searched in its own beat only), MEMORY (src/agent/context/memory.ts: a group means its own
// sentences) and the repair note (server/prompt/repair.ts: the same order the prompt teaches).
/**
 * THE RULE. The model may write a beat three ways: its group first, then its sentences (what the prompt
 * teaches, p6.1+); its first sentence (a page mark) and then its group (the old SVG_POINTING exception);
 * or its sentences and then its group (p6.0, and the old repair note). Only the filter sees the raw order,
 * so it normalises it by where it writes the boundary tag `{{beat}}` (zero words, no ink):
 *  - lead order (the default): `{{beat}}` goes out the moment a top-level `<g` opens, before the group:
 *    the beat is the group and every sentence after it, up to the next `{{beat}}`. A sentence pointing at
 *    the page just before a group stays in the beat before it: it is about the page, not the board, so
 *    no drawing is ever separated from its words, and the group still waits for the look (scheduler).
 *  - trailing order: when sentences come between the board's opening (the plan's end, or a repair
 *    stream's start) and the first group (two or more, or one that marks no page), the answer writes its
 *    words first: `{{beat}}` goes out before the first word after each group (page pointing before that
 *    word included), so the beat is the sentences and the group that closes them.
 *  - groups in a row (no word between them) share one beat: no `{{beat}}` between them.
 *  - the opener (everything before the first `{{beat}}`) has no group: at the plan's end the filter writes
 *    `{{beat}}` right after the board's `{{svgboard}}`, so the board opens with the opener's last sentence.
 * Downstream, one rule only: a beat is the text from one `{{beat}}` to the next (or the end); its groups
 * are the svg tags in it, its sentences its words. A beat with no words (groups the stream ended on)
 * joins the beat after it (the one before it, at the end).
 * LEGACY: a text with no `{{beat}}` (recorded before the beat wire, 2026-10-31, or written by hand) is read the old way: each
 * run of groups closes a beat, after the sentences before it.
 */
import { tokenize, type Tag, type Word } from '../gate/segment';
import { BEAT_TAG, hasBeatTags, isBeatTagBody } from './wire';

export { BEAT_TAG, hasBeatTags, isBeatTagBody };

/** One beat: its text span in the script, its svg groups (wire tag bodies) and its words. */
export type Beat = { start: number; end: number; text: string; groups: Tag[]; words: Word[] };

const isSvg = (t: Tag) => /^\s*svg\s*</.test(t.body);
/** A group's id (from its wire tag body). */
export const groupIdOf = (body: string): string | undefined => /<g\b[^>]*?\bid\s*=\s*["']([^"']+)["']/i.exec(body)?.[1];

/**
 * The script's beats, in order (THE RULE above). The text before the first beat with a group (the opener,
 * when it has words) is beat 0 with no groups. Concatenated, the beats' texts are the script.
 */
export function beatsOf(script: string, end = true): Beat[] {
  const toks = tokenize(script, { end });
  const cuts: number[] = [0];
  if (hasBeatTags(script)) {
    for (const t of toks) if (t.kind === 'tag' && isBeatTagBody(t.body) && t.start > 0) cuts.push(t.start);
  } else {
    // Legacy: the opener ends at the board's opening; a run of groups closes its beat, the next starts after it.
    const board = /\{\{svgboard\b[^}]*\}\}/.exec(script);
    if (board) cuts.push(board.index + board[0].length);
    for (let i = 0; i < toks.length; i++) {
      const t = toks[i];
      if (t.kind !== 'tag' || !isSvg(t)) continue;
      const nx = toks[i + 1];
      if (nx && !(nx.kind === 'tag' && isSvg(nx))) cuts.push(t.end);
    }
  }
  const spans = [...new Set(cuts)].sort((a, b) => a - b).map((s, i, a) => ({ s, e: a[i + 1] ?? script.length }));
  const beats: Beat[] = spans.map(({ s, e }) => {
    const in_ = toks.filter((t) => t.start >= s && t.start < e);
    return { start: s, end: e, text: script.slice(s, e), groups: in_.filter((t): t is Tag => t.kind === 'tag' && isSvg(t)), words: in_.filter((t): t is Word => t.kind === 'word') };
  }).filter((b) => b.text.length);
  // A beat with no words joins the next one (the last one joins the one before).
  const out: Beat[] = [];
  let carry: Beat | null = null;
  for (const b of beats) {
    const m: Beat = carry ? { start: carry.start, end: b.end, text: carry.text + b.text, groups: [...carry.groups, ...b.groups], words: [...carry.words, ...b.words] } : b;
    carry = null;
    if (!m.words.length) { carry = m; continue; }
    out.push(m);
  }
  if (carry) {
    const last = out[out.length - 1];
    if (last) out[out.length - 1] = { start: last.start, end: carry.end, text: last.text + carry.text, groups: [...last.groups, ...carry.groups], words: [...last.words, ...carry.words] };
    else out.push(carry);
  }
  return out;
}

/** The beat a group (by id) is drawn in, and the sentences said over it (the words of its beat). */
export function beatOfGroup(script: string, id: string): Beat | undefined {
  return beatsOf(script).find((b) => b.groups.some((g) => groupIdOf(g.body) === id));
}
