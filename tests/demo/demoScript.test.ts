// tests/demo/demoScript.test.ts
import { describe, it, expect, vi, afterEach } from 'vitest';
import { ScriptParser } from '../../src/script/parser';
import {
  DEMO_SCRIPT, DEMO_SIDE_SCRIPT, DEMO_PLANE_SCRIPT, DEMO_QUESTION, DEMO_SIDE_QUESTION, DEMO_PLANE_QUESTION, pickDemo,
} from '../../src/demo/demoScript';
import { SCRIPTS } from '../../src/demo/scripts';
import type { Action } from '../../src/script/types';

afterEach(() => vi.restoreAllMocks());

function parseAll(script: string): Action[] {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  const p = new ScriptParser();
  const events = [...p.push(script), ...p.end()];
  expect(warn).not.toHaveBeenCalled();
  return events.flatMap((e) => (e.type === 'action' ? [e.action] : []));
}
const em = (as: Action[]) => as.filter((a) => 'em' in a && a.em).map((a) => a.kind);
const ALL = [DEMO_SCRIPT, DEMO_SIDE_SCRIPT, DEMO_PLANE_SCRIPT, ...Object.values(SCRIPTS).map((x) => x.script)];

describe('DEMO_SCRIPT (PDF only)', () => {
  it('stays on the page and builds in six beats, ending on the slide\'s takeaway', () => {
    const as = parseAll(DEMO_SCRIPT);
    expect(as.map((a) => a.kind)).toEqual(['scroll', 'circle', 'line', 'highlight', 'line', 'label', 'highlight', 'emph']);
    expect(as.some((a) => a.kind === 'sketch' || ('region' in a && a.region))).toBe(false);
    const payoff = as.at(-2);
    expect(payoff?.kind === 'highlight' && payoff.quote).toContain('search becomes 1-D');
  });
  it('labels and re-traces l′ by id', () => {
    const as = parseAll(DEMO_SCRIPT);
    expect(as.find((a) => a.kind === 'label')).toMatchObject({ ref: 'lp' });
    expect(as.at(-1)).toEqual({ kind: 'emph', ref: 'lp' });
  });
});

describe('DEMO_SIDE_SCRIPT (C)', () => {
  it('sketches beside page 3 in a medium region, early in the stream', () => {
    const as = parseAll(DEMO_SIDE_SCRIPT);
    expect(as.find((a) => a.kind === 'sketch')).toEqual({ kind: 'sketch', id: 'side', page: 3, size: 'm', place: 'auto' });
    expect(DEMO_SIDE_SCRIPT.indexOf('{{sketch')).toBeLessThan(160);
  });
  it('connects the slide\'s x to the sketch\'s x', () => {
    expect(parseAll(DEMO_SIDE_SCRIPT).find((a) => a.kind === 'connect')).toEqual({
      kind: 'connect', from: { page: 3, at: { x: 305, y: 459 } }, to: { region: 'side', ref: 'x' },
    });
  });
  it('accents only the takeaway: l′, its label, and where the sight lines land', () => {
    expect(em(parseAll(DEMO_SIDE_SCRIPT))).toEqual(['line', 'label', 'point', 'point', 'point']);
  });
  it('ends on the written payoff', () => {
    const last = parseAll(DEMO_SIDE_SCRIPT).at(-1);
    expect(last?.kind === 'write' && last.text).toBe('x′ must be on l′');
  });
});

describe('DEMO_PLANE_SCRIPT (B)', () => {
  it('takes the stage with a large region and shades the plane', () => {
    const as = parseAll(DEMO_PLANE_SCRIPT);
    expect(as.find((a) => a.kind === 'sketch')).toMatchObject({ size: 'l' });
    expect(as.filter((a) => a.kind === 'shade')).toHaveLength(3);
    expect(em(as)).toEqual(['line', 'label']);
  });
});

describe('lec09 (C, brace + math)', () => {
  it('braces B and f, accents only the far offsets and the formula, ends on the formula', () => {
    const as = parseAll(SCRIPTS.lec09.script);
    expect(as.filter((a) => a.kind === 'brace').map((a) => a.kind === 'brace' && a.text)).toEqual(['B', 'f']);
    expect(em(as)).toEqual(['arrow', 'arrow', 'math']);
    const last = as.at(-1);
    expect(last?.kind === 'math' && last.tex).toBe("x - x' = \\frac{B\\,f}{z}");
  });
});

describe('every script', () => {
  it('parses with no warnings', () => {
    for (const s of ALL) expect(parseAll(s).length).toBeGreaterThan(5);
  });
  it('never stacks two tags on one word', () => {
    for (const s of ALL) expect(s).not.toMatch(/\}\}\s*\{\{/);
  });
  it('declares at most 2 regions and only draws into declared ones', () => {
    for (const s of ALL) {
      const as = parseAll(s);
      const ids = as.flatMap((a) => (a.kind === 'sketch' ? [a.id] : []));
      expect(ids.length).toBeLessThanOrEqual(2);
      for (const a of as) if ('region' in a && a.region) expect(ids).toContain(a.region);
    }
  });
  it('defines every id before referencing it', () => {
    for (const s of ALL) {
      const seen = new Set<string>();
      for (const a of parseAll(s)) {
        if ('ref' in a) expect(seen, `${a.kind} ${a.ref}`).toContain(a.ref);
        if (a.kind === 'connect') for (const e of [a.from, a.to]) if ('ref' in e) expect(seen).toContain(e.ref);
        if ('id' in a && a.id && a.kind !== 'sketch') seen.add(a.id);
      }
    }
  });
});

describe('pickDemo', () => {
  it('matches typed questions by word overlap, defaulting to the PDF demo', () => {
    expect(pickDemo(DEMO_SIDE_QUESTION).question).toBe(DEMO_SIDE_QUESTION);
    expect(pickDemo('can you sketch the SIDE view').question).toBe(DEMO_SIDE_QUESTION);
    expect(pickDemo('show the epipolar plane').question).toBe(DEMO_PLANE_QUESTION);
    expect(pickDemo('why only a line?').question).toBe(DEMO_QUESTION);
    expect(pickDemo('hello').question).toBe(DEMO_QUESTION);
  });
});
