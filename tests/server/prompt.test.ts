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
];

describe('system prompt', () => {
  const s = systemPrompt();

  it('is stable (one cacheable prefix) and within budget', () => {
    expect(systemPrompt()).toBe(s);
    expect(PROMPT_VERSION).toMatch(/^p\d+\.\d+$/);
    expect(s.length / 3.6).toBeLessThan(5000); // ~tokens
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
    const order = ['You are petu', 'HOW YOU TEACH', 'THE BOARD NEVER DUPLICATES', 'TIMING', 'WHAT YOU GET', 'POINTING ON THE PAGE', 'THE BOARD (', 'TAGS', 'SITUATIONS', 'EXAMPLE 1', 'EXAMPLE 2', 'EXAMPLE 3'];
    const at = order.map((h) => s.indexOf(h));
    expect(at.every((i) => i >= 0), JSON.stringify(Object.fromEntries(order.map((h, i) => [h, at[i]])))).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
  });

  it('is a brief, not a rulebook: no modes, no per-question-type recipes, no length or element caps', () => {
    expect(s).not.toMatch(/ANSWER SHAPE|BY QUESTION TYPE|hard rules/i);
    expect(s).not.toMatch(/\b(point-at|what-if|derive|compare|navigation)\s*[:(]/i); // no playbook entries
    expect(s).not.toMatch(/\bat most \d|\bat least \d|\d+\s*[–-]\s*\d+ (words|elements|drawn)|\bexactly one\b|\bmax(imum)? \d/i);
    expect(s).not.toMatch(/\b(quick|lesson) mode\b|\bmode\b/i);
    expect(s).not.toMatch(/stay on the visible page/i);
  });

  it('states the craft principles and the no-duplication rule', () => {
    for (const p of [/understands/, /walk them/, /mechanism/, /One central illustration that grows/, /whatever understanding takes/, /Never invent page content/,
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
