import { describe, it, expect, vi, afterEach } from 'vitest';
import { ScriptParser } from '../../src/script/parser';
import { DEMO_SCRIPT, DEMO_BOARD_SCRIPT, DEMO_QUESTION, DEMO_BOARD_QUESTION, pickDemo } from '../../src/demo/demoScript';
import type { Action } from '../../src/script/types';

afterEach(() => vi.restoreAllMocks());

describe('DEMO_SCRIPT', () => {
  it('stays on the PDF and builds in six beats, ending on the slide\'s own takeaway', () => {
    const actions = parseAll(DEMO_SCRIPT);
    expect(actions.map((a) => a.kind)).toEqual(['scroll', 'circle', 'line', 'highlight', 'line', 'label', 'highlight']);
    expect(actions.some((a) => 'page' in a && a.page === 0)).toBe(false);
    const last = actions[actions.length - 1];
    expect(last.kind === 'highlight' && last.quote).toContain('search becomes 1-D');
  });
  it('circles the point x as a dot and label together, not the label alone', () => {
    const c = parseAll(DEMO_SCRIPT).find((a) => a.kind === 'circle');
    expect(c && 'at' in c && c.at).toEqual({ x: 305, y: 459 });
  });
});

describe('DEMO_BOARD_SCRIPT', () => {
  it('parses with no warnings, mostly on the board', () => {
    const actions = parseAll(DEMO_BOARD_SCRIPT);
    expect(actions.some((a) => a.kind === 'board')).toBe(true);
    expect(actions.filter((a) => 'page' in a && a.page === 0).length).toBeGreaterThanOrEqual(15);
  });
  it('accents only the takeaway: the line l′ and where the sight lines land on it', () => {
    const em = parseAll(DEMO_BOARD_SCRIPT).filter((a) => 'em' in a && a.em);
    expect(em.map((a) => a.kind)).toEqual(['line', 'circle', 'circle', 'circle']);
  });
  it('ends on the written payoff', () => {
    const last = parseAll(DEMO_BOARD_SCRIPT).at(-1);
    expect(last?.kind === 'write' && last.text).toBe('x′ must be on l′');
  });
  it('opens the board early in the stream (the close-or-keep decision looks 160 chars ahead)', () => {
    expect(DEMO_BOARD_SCRIPT.indexOf('{{board}}')).toBeLessThan(160);
  });
});

describe('every demo script follows the beat rules', () => {
  it('never stacks two tags on one word', async () => {
    const { SCRIPTS } = await import('../../src/demo/scripts');
    for (const s of [DEMO_SCRIPT, DEMO_BOARD_SCRIPT, ...Object.values(SCRIPTS).map((x) => x.script)]) {
      expect(s).not.toMatch(/\}\}\s*\{\{/);
    }
  });
});

describe('pickDemo', () => {
  it('matches typed questions by word overlap, defaulting to the PDF demo', () => {
    expect(pickDemo(DEMO_BOARD_QUESTION).question).toBe(DEMO_BOARD_QUESTION);
    expect(pickDemo('can you sketch the SIDE view').question).toBe(DEMO_BOARD_QUESTION);
    expect(pickDemo('why only a line?').question).toBe(DEMO_QUESTION);
    expect(pickDemo('hello').question).toBe(DEMO_QUESTION);
  });
});

function parseAll(script: string): Action[] {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  const p = new ScriptParser();
  const events = [...p.push(script), ...p.end()];
  expect(warn).not.toHaveBeenCalled();
  return events.flatMap((e) => (e.type === 'action' ? [e.action] : []));
}

describe('dev SCRIPTS', () => {
  it('every named script parses with no warnings', async () => {
    const { SCRIPTS } = await import('../../src/demo/scripts');
    for (const s of Object.values(SCRIPTS)) expect(parseAll(s.script).length).toBeGreaterThan(5);
  });
  it('lec09 accents only the far point\'s smaller offsets and ends on the payoff', async () => {
    const { SCRIPTS } = await import('../../src/demo/scripts');
    const actions = parseAll(SCRIPTS.lec09.script);
    const em = actions.filter((a) => 'em' in a && a.em);
    expect(em.map((a) => a.kind)).toEqual(['arrow', 'arrow']);
    const last = actions.at(-1);
    expect(last?.kind === 'write' && last.text).toBe('farther → smaller x − x′');
  });
});
