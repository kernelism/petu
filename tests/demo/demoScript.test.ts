import { describe, it, expect, vi, afterEach } from 'vitest';
import { ScriptParser } from '../../src/script/parser';
import { DEMO_SCRIPT, DEMO_BOARD_SCRIPT, DEMO_QUESTION, DEMO_BOARD_QUESTION, pickDemo } from '../../src/demo/demoScript';
import type { Action } from '../../src/script/types';

afterEach(() => vi.restoreAllMocks());

describe('DEMO_SCRIPT', () => {
  it('parses into exactly 11 actions with no warnings', () => {
    const actions = parseAll(DEMO_SCRIPT);
    expect(actions).toHaveLength(11);
    expect(actions.filter((a) => a.kind === 'underline')).toHaveLength(1);
    expect(actions.filter((a) => a.kind === 'highlight')).toHaveLength(2);
  });
});

describe('DEMO_BOARD_SCRIPT', () => {
  it('parses with no warnings into ≥10 actions, mostly on the board', () => {
    const actions = parseAll(DEMO_BOARD_SCRIPT);
    expect(actions.length).toBeGreaterThanOrEqual(10);
    expect(actions.some((a) => a.kind === 'board')).toBe(true);
    expect(actions.filter((a) => 'page' in a && a.page === 0).length).toBeGreaterThanOrEqual(10);
    expect(actions.filter((a) => a.kind === 'write')).toHaveLength(5);
  });
  it('opens the board early in the stream (the close-or-keep decision looks 160 chars ahead)', () => {
    expect(DEMO_BOARD_SCRIPT.indexOf('{{board}}')).toBeLessThan(160);
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
});
