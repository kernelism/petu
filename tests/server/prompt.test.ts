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

  it('keeps the stable section order: identity → timing → shape → page → pointing → sketches → tags → playbook → examples', () => {
    const order = ['You are petu', 'TIMING', 'ANSWER SHAPE', 'THE PAGE YOU GET', 'POINTING ON THE PAGE', 'SKETCHES', 'TAGS', 'BY QUESTION TYPE', 'EXAMPLE 1', 'EXAMPLE 2', 'EXAMPLE 3'];
    const at = order.map((h) => s.indexOf(h));
    expect(at.every((i) => i >= 0), JSON.stringify(Object.fromEntries(order.map((h, i) => [h, at[i]])))).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
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
    for (const w of ['mark=#', 'through=', 'near=', ' fit', 'mid(', 'along(', 'meet(', 'foot(', '<plan>']) expect(s, w).toContain(w);
  });

  it('covers the answer situations beyond a single question', () => {
    expect(s).toMatch(/STUDENT INK/);
    expect(s).toMatch(/earlier (question|answer)/i); // follow-ups
    expect(s).toMatch(/doesn't cover/i); // out of scope
    expect(s).toMatch(/off-topic/i);
    expect(s).toMatch(/no extractable text/i);
  });
});
