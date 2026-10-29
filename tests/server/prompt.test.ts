// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';
import { systemPrompt, PROMPT_VERSION } from '../../server/prompt/system';
import { ScriptParser } from '../../src/script/parser';
import { ScriptFilter } from '../../server/scriptFilter';

/**
 * Words from the decks and pages the eval uses (and the spike's lec09 p40 material). None may
 * appear in the prompt: examples get copied, and a prompt that names eval content overfits to it.
 * Extend this list whenever a new deck term comes up in iteration (plan P2, overfit guard).
 */
export const EVAL_VOCAB = [
  /lec\d\d/i, /optical flow/i, /disparity/i, /baseline/i, /x-prime/i, /Harris/i, /eigen/i, /thin lens/i,
  /Szeliski/i, /COMPSCI/i, /407,600/, /CS ?670/i, /stereo/i, /\bdepth\b/i, /focal/i, /triangulat/i,
  /homograph/i, /convolution/i, /gradient/i, /\bSIFT\b/, /RANSAC/i, /midterm/i, /Lucas|Kanade/i,
  // the Eval v3 synthetic decks (public/fixtures/econ.pdf, mechanics.pdf)
  /elasticit/i, /deadweight/i, /supply and demand|demand curve|supply curve/i, /surplus/i, /projectile/i,
  /inclined plane/i, /friction/i, /pulley|Atwood/i, /centripetal/i,
  // the bio deck (public/fixtures/bio.pdf) and the follow-up set's requests
  /inhibit/i, /enzyme/i, /Michaelis/i, /substrate/i, /like I'm 5/i,
];

describe('system prompt', () => {
  const s = systemPrompt();

  it('is stable (one cacheable prefix) and within budget', () => {
    expect(systemPrompt()).toBe(s);
    expect(PROMPT_VERSION).toMatch(/^p\d+\.\d+$/);
    expect(s.length / 3.6).toBeLessThan(8300); // ~tokens (the slide as canvas — charts, lifts, page notes — ~250 more; the visual kit's card added ~1,000; views, plots and FORMULAS ~400; Board v2's scene ~700; bound numbers, readouts, moves and a fifth example ~650; p5.6: four examples, chart-first and beats in TEACH, amounts/counts/histograms in the card, wave-1 helpers — 8,208; p5.7: live geometry in the card and TEACH, a moving example, the scope-relative length budget — 8,274)
    expect(s.length / 3.6).toBeGreaterThan(1100); // above the 1,024-token cache minimum
  });

  it('has nothing dynamic in it (no dates, no document names)', () => {
    expect(s).not.toMatch(/\b20\d\d-\d\d-\d\d\b/);
    expect(s).not.toMatch(/\.pdf\b/i);
  });

  it('never leaks eval material (anti-overfit)', () => {
    for (const banned of EVAL_VOCAB) expect(s).not.toMatch(banned);
  });

  it('keeps the stable section order: identity → teach → no-dup → timing → context → pointing → board → tags → situations → examples', () => {
    const order = ['You are petu', 'HOW YOU TEACH', 'THE BOARD NEVER DUPLICATES', 'TIMING', 'WHAT YOU GET', 'POINTING ON THE PAGE', 'THE BOARD (', 'TAGS', 'SITUATIONS', 'EXAMPLE 1', 'EXAMPLE 2', 'EXAMPLE 3', 'EXAMPLE 4'];
    const at = order.map((h) => s.indexOf(h));
    expect(at.every((i) => i >= 0), JSON.stringify(Object.fromEntries(order.map((h, i) => [h, at[i]])))).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
  });

  it('is a brief, not a rulebook: no modes, no per-question-type recipes, no element caps; length only as the scope-relative beat budget', () => {
    let s = systemPrompt();
    expect(s).not.toMatch(/ANSWER SHAPE|BY QUESTION TYPE|hard rules/i);
    // Founder 2026-10-29: live answers ran 94–160 s on narrow questions; "cap answer length by the
    // question's scope (narrow question → 30–60 s, not minutes)". So ONE length budget is allowed, and only
    // relative to the plan's beats and scope (narrow vs broad); it is no per-question-type recipe or mode,
    // and no other fixed count or cap may appear. The budget's own sentences are checked here, then
    // removed before the cap checks below.
    const budget = /Say less and let the board carry it\. The PLAN's beats are your budget[^\n]*?a broad one may take longer\./;
    expect(s).toMatch(budget);
    expect(s.match(budget)![0]).toMatch(/narrow question lands in 30–60 seconds/);
    s = s.replace(budget, '');
    expect(s).not.toMatch(/\b(point-at|what-if|derive|compare|navigation)\s*[:(]/i); // no playbook entries
    expect(s).not.toMatch(/\bat most \d|\bat least \d|\d+\s*[–-]\s*\d+ (words|elements|drawn)|\bexactly one\b|\bmax(imum)? \d/i);
    expect(s).not.toMatch(/\b(quick|lesson) mode\b|\bmode\b/i);
    expect(s).not.toMatch(/stay on the visible page/i);
  });

  it('states the craft principles and the no-duplication rule', () => {
    for (const p of [/understands/, /walk them/, /mechanism/, /One central illustration that grows/, /beats are your budget/, /Never invent page content/,
      /Never copy onto the board a formula, sentence or list that a page already shows/, /Never write on the board what your narration is saying/, /labels on drawn things/, /never written out as sentences/]) expect(s).toMatch(p);
  });

  it('every tag it shows the model parses (the grammar card is executable)', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    // The real parser over the whole prompt, line by line (tags never span lines): no tag is malformed.
    const f = new ScriptFilter();
    const text = f.push(s) + f.end();
    const actions = text.split('\n').flatMap((l) => { const p = new ScriptParser(); return [...p.push(l), ...p.end()]; }).filter((e) => e.type === 'action');
    expect(warn.mock.calls).toEqual([]);
    expect(actions.length).toBe((text.match(/\{\{/g) ?? []).length);
    expect(actions.length).toBeGreaterThan(40);
    warn.mockRestore();
  });

  it('teaches every grammar piece the engine has', () => {
    const kinds = new Set([...s.matchAll(/\{\{(\w+)/g)].map((m) => m[1]));
    for (const k of ['scroll', 'highlight', 'underline', 'circle', 'box', 'line', 'arrow', 'point', 'label', 'curve', 'shade', 'angle', 'brace', 'write', 'math', 'axes', 'plot', 'let', 'sketch', 'connect', 'emph', 'fade']) expect(kinds, k).toContain(k);
    for (const w of ['mark=#', 'from=p4:#', 'through=', 'near=', ' fit', 'mid(', 'along(', 'meet(', 'foot(', '<plan>']) expect(s, w).toContain(w);
    for (const k of ['grid', 'bars', 'table', 'scatter', 'calc', 'col', 'fit', 'band', 'dist', 'step', 'sweep', 'set', 'level']) expect(kinds, k).toContain(k);
    for (const w of ['slide=', 'win=', 'reduce=', 'map=', 'zip=', 'right=', 'below=', 'op=', 'where=', 'center=']) expect(s, w).toContain(w);
    // Board v2: one connected scene
    for (const k of ['scene', 'node', 'flow', 'link', 'note', 'shares', 'blend', 'move', 'group', 'pair', 'split', 'merge']) expect(kinds, k).toContain(k);
    for (const w of ['beside=', 'near=', 'annotate=', 'strength=', 'op=softmax', 'matmul', 'reduce=wavg', 'Transform rather than redraw', 'Connect everything']) expect(s, w).toContain(w);
    // Gated beats, step 2: bound numbers, readouts, demonstration moves
    for (const k of ['val', 'find', 'contrast', 'limit', 'beforeafter']) expect(kinds, k).toContain(k);
    for (const w of ['level=', 'slope', 'area', 'inside=', 'residual', 'as=percent', 'show=', 'NUMBERS YOU SAY', 'TEACHING MOVES', 'Each paragraph is a beat']) expect(s, w).toContain(w);
    // The slide as canvas: calibrated charts, lifts, page notes
    expect(kinds, 'lift').toContain('lift');
    for (const w of ['on=#c1', '#c1 chart', 'annotate=#', 'box=x,y,w,h', 'WORK ON THE SLIDE AND FROM IT']) expect(s, w).toContain(w);
    // Amounts, counts and distributions; readouts and moves on a slide's chart; wave-1 helpers
    expect(kinds, 'tokens').toContain('tokens');
    for (const w of [' stack}}', 'parts=', 'split id=b[2] vals=', 'state=', 'hist=', 'on=#c1 at=E', 'if(c,a,b)', 'integral(', 'quantile', 'clear side']) expect(s, w).toContain(w);
  });

  it('states the kit principles: the engine computes, visible values, page values, input-operation-output, step then sweep', () => {
    for (const p of [/Never write a computed number yourself/, /make the effect visible/, /use the page's/, /input, the operation and the output/, /step through the first case/, /sweep the rest/]) expect(s).toMatch(p);
  });

  it('covers the answer situations beyond a single question', () => {
    expect(s).toMatch(/STUDENT INK/);
    expect(s).toMatch(/earlier (question|answer)/i); // follow-ups
    expect(s).toMatch(/doesn't cover/i); // out of scope
    expect(s).toMatch(/off-topic/i);
    expect(s).toMatch(/no extractable text/i);
    expect(s).toMatch(/PLAN/); // the scout's plan
    expect(s).toMatch(/listing only, no image/); // other pages
    expect(s).toMatch(/digest/i);
  });
});
