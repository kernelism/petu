// @vitest-environment node
import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Ledger } from '../../server/ledger';
import { costUsd, worstCaseUsd } from '../../server/prices';

let path = '';
beforeEach(() => { path = join(mkdtempSync(join(tmpdir(), 'ledger-')), 'spend.json'); });
const day = (d: string) => () => new Date(`${d}T12:00:00Z`);

describe('Ledger', () => {
  it('refuses a request whose worst case would cross the total cap, counting prior spend and reservations', () => {
    const l = new Ledger(path, { totalUsd: 1 }, day('2026-10-28'), 0.5);
    expect(l.reserve('a', 'dev', 0.3)).toBeNull();
    const r = l.reserve('b', 'dev', 0.3);
    expect(r?.code).toBe('total');
    expect(r?.message).toMatch(/\$0\.80 of total budget \(\$1\.00\)/);
  });
  it('settles real cost, persists atomically, and survives a restart', () => {
    const l = new Ledger(path, { totalUsd: 40 }, day('2026-10-28'));
    l.reserve('a', 'dev', 0.05);
    l.settle({ id: 'a', phase: 'dev', kind: 'answer', model: 'gpt-6.1-terra', usd: 0.011 });
    const again = new Ledger(path, { totalUsd: 40 }, day('2026-10-28'));
    expect(again.spent()).toBeCloseTo(0.011);
    expect(JSON.parse(readFileSync(path, 'utf8')).entries).toHaveLength(1);
  });
  it('daily and phase caps', () => {
    const l = new Ledger(path, { totalUsd: 40, dailyUsd: 0.1, phaseUsd: { bakeoff: 0.05 } }, day('2026-10-28'));
    l.settle({ id: 'a', phase: 'dev', kind: 'answer', model: 'm', usd: 0.08 });
    expect(l.reserve('b', 'dev', 0.03)?.code).toBe('daily');
    const tomorrow = new Ledger(path, { totalUsd: 40, dailyUsd: 0.1, phaseUsd: { bakeoff: 0.05 } }, day('2026-10-29'));
    expect(tomorrow.reserve('c', 'dev', 0.03)).toBeNull();
    expect(tomorrow.reserve('d', 'bakeoff', 0.06)?.code).toBe('phase');
  });
  it('seeds the prior (spike) spend once: it counts toward the total only and survives a restart', () => {
    const l = new Ledger(path, { totalUsd: 40, dailyUsd: 3, phaseUsd: { dev: 1 } }, day('2026-10-28'), 0.0076);
    expect(l.spent()).toBeCloseTo(0.0076, 8);
    expect(l.summary()).toMatchObject({ totalUsd: 0.0076, capUsd: 40, todayUsd: 0, dailyCapUsd: 3, n: 0 });
    // a later process passes a different prior: the persisted one wins
    const again = new Ledger(path, { totalUsd: 40 }, day('2026-10-28'), 0);
    expect(again.spent()).toBeCloseTo(0.0076, 8);
    expect(JSON.parse(readFileSync(path, 'utf8')).priorUsd).toBe(0.0076);
    // the phase cap ignores the prior
    expect(again.reserve('a', 'dev', 0.999)).toBeNull();
  });
  it('reservations count toward the daily and phase caps until settled', () => {
    const l = new Ledger(path, { totalUsd: 40, dailyUsd: 3, phaseUsd: { founder: 2 } }, day('2026-10-28'));
    expect(l.reserve('a', 'founder', 1.5)).toBeNull();
    expect(l.reserve('b', 'founder', 1.0)?.code).toBe('phase');
    l.settle({ id: 'a', phase: 'founder', kind: 'answer', model: 'm', usd: 0.01 });
    expect(l.reserve('b', 'founder', 1.0)).toBeNull();
  });
  it('sees spend booked by another process on the same file before reserving', () => {
    const a = new Ledger(path, { totalUsd: 1 }, day('2026-10-28'));
    const b = new Ledger(path, { totalUsd: 1 }, day('2026-10-28'));
    a.settle({ id: 'x', phase: 'dev', kind: 'answer', model: 'm', usd: 0.9 });
    expect(b.reserve('y', 'dev', 0.2)?.code).toBe('total');
    b.settle({ id: 'z', phase: 'dev', kind: 'judge', model: 'm', usd: 0.05 });
    expect(JSON.parse(readFileSync(path, 'utf8')).entries.map((e: { id: string }) => e.id)).toEqual(['x', 'z']);
  });
  it('release frees a reservation', () => {
    const l = new Ledger(path, { totalUsd: 0.1 });
    l.reserve('a', 'dev', 0.09);
    expect(l.reserve('b', 'dev', 0.05)).not.toBeNull();
    l.release('a');
    expect(l.reserve('b', 'dev', 0.05)).toBeNull();
  });
});

describe('prices', () => {
  it('costs a terra answer with a cached system prompt and a written page context', () => {
    const usd = costUsd('gpt-6.1-terra', { input_tokens: 9000, output_tokens: 700, input_tokens_details: { cached_tokens: 4500, cache_write_tokens: 4000 } }, '30m');
    // 500 plain × 1.00 + 4500 × 0.05 + 4000 × 1.25 + 700 × 5.00, per 1M
    expect(usd).toBeCloseTo((500 + 225 + 5000 + 3500) / 1e6, 8);
  });
  it('worst case and unknown models', () => {
    expect(worstCaseUsd('gpt-6.1-terra', 10000, 1400)).toBeCloseTo((25000 + 7000) / 1e6);
    // The reported TTL split prices each part at its own rate (P0: 4092 at 12h, 3002 at 30m).
    const split = costUsd('gpt-6.1-terra', { input_tokens: 7265, output_tokens: 129, input_tokens_details: { cached_tokens: 0, cache_write_tokens: 7094, cache_write_tokens_details: { ttl_12h_tokens: 4092, ttl_30m_tokens: 3002 } } }, '12h');
    expect(split).toBeCloseTo((171 * 1 + 4092 * 2.5 + 3002 * 1.25 + 129 * 5) / 1e6, 10);
    expect(() => costUsd('gpt-9', { input_tokens: 1, output_tokens: 1 })).toThrow();
  });
});
