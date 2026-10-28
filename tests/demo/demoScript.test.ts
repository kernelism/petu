import { describe, it, expect, vi, afterEach } from 'vitest';
import { ScriptParser } from '../../src/script/parser';
import { DEMO_SCRIPT } from '../../src/demo/demoScript';

afterEach(() => vi.restoreAllMocks());

describe('DEMO_SCRIPT', () => {
  it('parses into exactly 12 actions with no warnings', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const p = new ScriptParser();
    const events = [...p.push(DEMO_SCRIPT), ...p.end()];
    const actions = events.flatMap((e) => (e.type === 'action' ? [e.action] : []));
    expect(actions).toHaveLength(12);
    expect(warn).not.toHaveBeenCalled();
  });
});
