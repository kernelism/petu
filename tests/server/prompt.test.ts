// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { systemPrompt, PROMPT_VERSION } from '../../server/prompt/system';
import { SVG_EXAMPLES } from '../../server/prompt/svgExamples';
import { parseTag } from '../../src/script/parseTag';
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

// The tag-DSL prompt (p5.7, PETU_PROMPT_VARIANT=tags). Founder decision 2026-10-29: these tag-DSL
// prompt rules (grammar card executable, every grammar piece taught, the 8300-token bound) apply to the
// tag prompt only, not to the svg prompt (the default since p6.0), which has its own suite below.
describe('system prompt (tags)', () => {
  const s = systemPrompt('tags');

  it('is stable (one cacheable prefix) and within budget', () => {
    expect(systemPrompt('tags')).toBe(s);
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
    let s = systemPrompt('tags');
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

// ------------------------------------------------------------------------------------------------
// The svg prompt (the default, p6.0): the board drawn by the model in SVG, streamed beat by beat.
// Founder decision 2026-10-29: the tag-DSL rules above don't apply here; these do.

/** The BOARD height a script's plan declares. */
const boardH = (script: string) => Number(/BOARD (?:extend )?viewBox="0 0 1000 (\d+)"/.exec(script)?.[1]);
/** A script's beats (p6.1): its top-level <g id> group first, then the narration up to the next group (the group draws across it). */
function beatsOf(script: string): { narration: string; id: string; svg: string }[] {
  const body = script.slice(script.indexOf('</plan>') + 7);
  const out: { narration: string; id: string; svg: string }[] = [];
  let pos = 0;
  for (;;) {
    const open = body.indexOf('<g id="', pos);
    if (open < 0) break;
    let depth = 0, end = -1;
    for (const m of body.slice(open).matchAll(/<g\b[^>]*?(\/?)>|<\/g>/g)) {
      if (m[1] === '/') continue; // a self-closing frame (<g data-axes … />)
      depth += m[0] === '</g>' ? -1 : 1;
      if (depth === 0) { end = open + m.index! + 4; break; }
    }
    expect(end, 'unbalanced <g>').toBeGreaterThan(open);
    if (out.length) out[out.length - 1].narration = body.slice(pos, open);
    else expect(body.slice(0, open).trim(), 'a beat starts with its group').toBe('');
    out.push({ narration: '', id: /<g id="([^"]+)"/.exec(body.slice(open))![1], svg: body.slice(open, end) });
    pos = end;
  }
  if (out.length) out[out.length - 1].narration = body.slice(pos);
  return out;
}

describe('system prompt (svg, default)', () => {
  const s = systemPrompt();

  it('is stable, versioned and within budget', () => {
    expect(systemPrompt()).toBe(s);
    expect(PROMPT_VERSION).toBe('p6.1');
    expect(s.length / 3.6).toBeGreaterThan(1100); // above the 1,024-token cache minimum
    expect(s.length / 3.6).toBeLessThan(7000); // short and ambitious: ~4,900 with its two examples
  });

  it('has nothing dynamic and never leaks eval material', () => {
    expect(s).not.toMatch(/\b20\d\d-\d\d-\d\d\b/);
    expect(s).not.toMatch(/\.pdf\b/i);
    for (const banned of EVAL_VOCAB) expect(s).not.toMatch(banned);
    // nor the experiment's bench topics (the examples must not teach the bench's answers)
    for (const banned of [/skater/i, /tunnel/i, /\brent\b/i, /sin x|sine/i, /satellite/i]) expect(s).not.toMatch(banned);
  });

  it('has no tag-DSL card: only page pointing tags', () => {
    expect(s).not.toMatch(/\bTAGS \(|KIT \(|SCENE \(|\{\{(sketch|scene|let|const|plot|grid|bars|node|val|show|svgboard)\b/);
    const kinds = new Set([...s.matchAll(/\{\{(\w+)/g)].map((m) => m[1]));
    for (const k of kinds) expect(['scroll', 'highlight', 'underline', 'circle', 'box', 'tween'], k).toContain(k); // tween: the svg engine's motion (data.ts)
  });

  it('every pointing tag it shows parses', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const tags = [...s.matchAll(/\{\{([^}]*)\}\}/g)].map((m) => m[1]);
    expect(tags.length).toBeGreaterThan(6);
    for (const t of tags) expect(parseTag(t), t).not.toBeNull();
    warn.mockRestore();
  });

  it('is a brief, not a rulebook: no modes or recipes; length only as the scope-relative beat budget', () => {
    let t = s;
    const budget = /Say less and let the board carry it\. The PLAN's beats are your budget[^\n]*?a broad one may take longer\./;
    expect(t).toMatch(budget);
    expect(t.match(budget)![0]).toMatch(/narrow question lands in 30–60 seconds/);
    t = t.replace(budget, '');
    expect(t).not.toMatch(/ANSWER SHAPE|BY QUESTION TYPE|hard rules/i);
    expect(t).not.toMatch(/\b(point-at|what-if|derive|compare|navigation)\s*[:(]/i);
    expect(t).not.toMatch(/\bat most \d|\bat least \d|\d+\s*[–-]\s*\d+ (words|elements|drawn|groups|beats)|\bexactly one\b|\bmax(imum)? \d/i);
    expect(t).not.toMatch(/\b(quick|lesson) mode\b|\bmode\b/i);
  });

  it('states the teacher-at-a-whiteboard brief and the streamed beat format', () => {
    for (const p of [/great teacher at a whiteboard/, /Draw the mechanism, not names/, /ONE concrete case/, /real numbers you compute/, /reads on its own/, /beats are your budget/,
      /Never invent page content/, /<plan>/, /BOARD viewBox="0 0 1000 H"/, /regions:/, /groups:/, /<g id=/, /drawing first/, /draws across its sentences/, /draws on the word that names it/, /Start speaking at once/, /data-fn=/, /data-val=/, /data-at=/, /data-const=/, /\{\{tween /, /data-ghost/, /data-trace/, /BUDGET line/, /Never write on the board what you say/,
      /No scripts, foreignObject/, /font-size 16/, /one accent colour/, /Nothing overlaps/, /inside the viewBox/, /BOARD extend/, /ghost/]) expect(s).toMatch(p);
  });

  it('covers the answer situations beyond a single question', () => {
    for (const p of [/STUDENT INK/, /MEMORY/, /RELATION/, /doesn't cover/, /Off-topic/, /no extractable text/, /listing only, no image/, /digest/i, /scroll p=7/]) expect(s).toMatch(p);
  });

  // (Needs DOMParser: tests/server/storyboard.test.ts imports EVAL_VOCAB from here under the node environment.)
  describe.skipIf(typeof DOMParser === 'undefined').each(SVG_EXAMPLES.map((e) => [e.title, e] as const))('example: %s', (_t, ex) => {
    it('has a plan ending with the BOARD layout: viewBox, regions, groups in teaching order', () => {
      const plan = /<plan>([\s\S]*?)<\/plan>/.exec(ex.script)?.[1] ?? '';
      // p6.1: one or two spoken sentences with no drawing come first; they play while the plan is written.
      const lead = ex.script.slice(0, ex.script.indexOf('<plan>'));
      expect(lead.replace(/\{\{[^}]*\}\}/g, '').trim().split(/\s+/).length).toBeGreaterThan(8);
      expect(lead).not.toMatch(/<g\b/);
      expect(boardH(plan)).toBeGreaterThan(0);
      expect(plan).toMatch(/\nregions: /);
      const listed = /\ngroups: (.*)/.exec(plan)![1].split(';').map((g) => g.trim().split(/\s/)[0]);
      expect(listed).toEqual(beatsOf(ex.script).map((b) => b.id));
    });

    it('groups: each well-formed, followed by its words; ids unique; every coordinate inside the viewBox; text ≥ 16', () => {
      const H = boardH(ex.script), bs = beatsOf(ex.script);
      expect(bs.length).toBeGreaterThanOrEqual(4);
      expect(new Set(bs.map((b) => b.id)).size).toBe(bs.length);
      for (const b of bs) {
        expect(b.id).toMatch(/^[a-z][a-z0-9-]*$/);
        expect(b.narration.trim().split(/\s+/).length, b.id).toBeGreaterThan(8); // the sentences it draws across
        const doc = new DOMParser().parseFromString(`<svg xmlns="http://www.w3.org/2000/svg">${b.svg}</svg>`, 'image/svg+xml');
        expect(doc.querySelector('parsererror'), b.id).toBeNull();
        expect(b.svg).not.toMatch(/<(script|foreignObject|image|animate|a)\b|\bon\w+=|href=/i);
        for (const el of Array.from(doc.querySelectorAll('*'))) {
          for (const a of ['x', 'cx', 'x1', 'x2']) { const v = el.getAttribute(a); if (v != null) { expect(Number(v), `${b.id} ${a}`).toBeGreaterThanOrEqual(0); expect(Number(v)).toBeLessThanOrEqual(1000); } }
          for (const a of ['y', 'cy', 'y1', 'y2']) { const v = el.getAttribute(a); if (v != null) { expect(Number(v), `${b.id} ${a}`).toBeGreaterThanOrEqual(0); expect(Number(v)).toBeLessThanOrEqual(H); } }
          const pts = el.getAttribute('points');
          if (pts) for (const [x, y] of pts.trim().split(/\s+/).map((p) => p.split(',').map(Number))) { expect(x).toBeGreaterThanOrEqual(0); expect(x).toBeLessThanOrEqual(1000); expect(y).toBeGreaterThanOrEqual(0); expect(y).toBeLessThanOrEqual(H); }
          const fs = el.getAttribute('font-size');
          if (fs) expect(Number(fs), b.id).toBeGreaterThanOrEqual(16);
        }
        expect(doc.querySelectorAll('text').length + doc.querySelectorAll('[font-size] text').length, b.id).toBeGreaterThan(0); // every group is labelled
      }
    });

    it('each group id is a word its beat says (the engine draws it on that word)', () => {
      for (const b of beatsOf(ex.script)) expect(b.narration.toLowerCase().split(/[^a-z0-9-]+/), b.id).toContain(b.id);
    });

    it('numbers that follow from a formula are formulas (the engine computes them)', () => {
      expect(ex.script).toMatch(/data-const="/);
      expect(ex.script).toMatch(/data-val="/);
    });

    it('the board never writes out the narration: no derivation lines, short labels only', () => {
      for (const b of beatsOf(ex.script)) {
        for (const m of b.svg.matchAll(/<text[^>]*>([^<]*)<\/text>/g)) {
          expect(m[1].split(/\s+/).length, `${b.id}: ${m[1]}`).toBeLessThanOrEqual(6);
          expect(m[1], b.id).not.toMatch(/=.*=|[×÷].*=/); // a worked step is spoken, not written
        }
      }
    });

    it('points at the page with tags that parse and quote listed text, and ends on a question to the student', () => {
      const tags = [...ex.script.matchAll(/\{\{([^}]*)\}\}/g)].map((m) => m[1]);
      expect(tags.length).toBeGreaterThan(0);
      for (const t of tags) {
        expect(parseTag(t), t).not.toBeNull();
        const q = /"([^"]+)"/.exec(t)?.[1];
        if (q) expect(ex.listing, q).toContain(q);
      }
      expect(ex.script.trim()).toMatch(/\?$/);
      expect(ex.script.slice(ex.script.lastIndexOf('</g>'))).not.toMatch(/<g/);
    });
  });
});
