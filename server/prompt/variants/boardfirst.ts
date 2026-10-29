// server/prompt/variants/boardfirst.ts — E3 (live-vs-demo-boards.md §8.3): the output format only.
/**
 * Stage 2 writes the whole board first, in a <board> block (every element with an id), then narration
 * that only reveals and changes it (server/boardFirst.ts holds each element back until the narration
 * first names it). The p5.7 examples are the same scripts converted mechanically (toBoardFirst), so
 * they play back as before. The TIMING section and the output sentence change; nothing else does.
 */
import { toBoardFirst } from '../../boardFirst.ts';
import { edit, type Parts } from './index.ts';

const TIMING_P57 = `TIMING
A tag fires on the word right after it, and the student hears about three words a second. Put each tag immediately before the words that name what it draws, so the ink arrives with its words. Never describe something first and draw it a sentence later. Add things one at a time as you name them, so the picture builds instead of appearing finished.`;

const TIMING_BOARD_FIRST = `BOARD FIRST, THEN NARRATION
Write the whole board before you speak: one <board>…</board> block first, holding every board tag of the answer (sections, let, const, and every drawing on the board or on a slide's chart), in the order they should appear, each drawing with its own id=. Nothing in the block is shown yet: sketch, scene, let and const take effect at once; each drawing waits, hidden, until the narration first names its id, and is drawn on the word right after that tag. A drawing the narration never names is never shown. When nothing goes on the board, write no block.
Then the narration, with tags inline. Its tags reveal and change what the block declared: {{emph id=X}} draws X (or draws attention to it once shown); move, set, tween, fade, split, merge, label, connect, val, step, sweep, beforeafter, limit and contrast change and tie it; a tag that names a hidden drawing draws it first (a link brings its ends). Page tags (scroll, highlight, circle, box, underline, note p=) stay in the narration as usual.
A tag fires on the word right after it, and the student hears about three words a second. Put each reveal immediately before the words that name what it shows, so the ink arrives with its words. Never describe something first and reveal it a sentence later. Reveal things one at a time as you name them, so the picture builds instead of appearing finished.`;

export function boardfirst(base: Parts): Parts {
  let s = base.sections;
  s = edit(s, 'Output ONE script: spoken narration with tags inline, nothing before or after it.', 'Output ONE script: the board block, then spoken narration with tags inline (see BOARD FIRST), nothing before or after it.');
  s = edit(s, TIMING_P57, TIMING_BOARD_FIRST);
  return { ...base, sections: s, examples: base.examples.map((e) => ({ ...e, script: toBoardFirst(e.script) })) };
}
