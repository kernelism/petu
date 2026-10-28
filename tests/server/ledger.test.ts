// @vitest-environment node
import { describe, it, expect, beforeEach } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
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
    l.settle({ id: 'a', phase: 'founder', kind: 'answer', model: 'm', usd: 0.08 });
    expect(l.reserve('b', 'founder', 0.03)?.code).toBe('daily');
    const tomorrow = new Ledger(path, { totalUsd: 40, dailyUsd: 0.1, phaseUsd: { bakeoff: 0.05 } }, day('2026-10-29'));
    expect(tomorrow.reserve('c', 'founder', 0.03)).toBeNull();
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
  it('a reservation left open by a dead process is booked as an estimate on restart, never dropped', () => {
    const l = new Ledger(path, { totalUsd: 40 }, day('2026-10-28'));
    l.reserve('crash', 'founder', 0.03, { kind: 'answer', model: 'gpt-6.1-terra', estUsd: 0.008 });
    l.reserve('crash2', 'founder', 0.02, { kind: 'prewarm', model: 'gpt-6.1-terra' });
    // Simulate the crash: the file still holds both, under a pid that is gone.
    const f = JSON.parse(readFileSync(path, 'utf8'));
    for (const o of Object.values(f.open) as { pid: number }[]) o.pid = 999999;
    writeFileSync(path, JSON.stringify(f));
    const again = new Ledger(path, { totalUsd: 40 }, day('2026-10-28'), 0, { alive: () => false });
    const after = JSON.parse(readFileSync(path, 'utf8'));
    expect(after.open).toEqual({});
    expect(after.entries).toEqual([
      expect.objectContaining({ id: 'crash', usd: 0.008, estimated: true, recovered: true, kind: 'answer', phase: 'founder' }),
      expect.objectContaining({ id: 'crash2', usd: 0.02, estimated: true, recovered: true, kind: 'prewarm' }),
    ]);
    expect(again.spent()).toBeCloseTo(0.028, 10);
  });
  it('a live process\'s open reservation counts toward the caps of another process on the file', () => {
    const a = new Ledger(path, { totalUsd: 1 }, day('2026-10-28'), 0, { alive: () => true });
    expect(a.reserve('x', 'dev', 0.8)).toBeNull();
    const f = JSON.parse(readFileSync(path, 'utf8'));
    f.open.x.pid = 424242;
    writeFileSync(path, JSON.stringify(f));
    const b = new Ledger(path, { totalUsd: 1 }, day('2026-10-28'), 0, { alive: () => true });
    expect(b.reserve('y', 'dev', 0.3)?.code).toBe('total');
    expect(JSON.parse(readFileSync(path, 'utf8')).entries).toHaveLength(0);
  });
  it('refusal lines show small amounts with two significant digits', () => {
    const l = new Ledger(path, { totalUsd: 40, dailyUsd: 0.02 }, day('2026-10-28'));
    l.settle({ id: 'a', phase: 'founder', kind: 'answer', model: 'm', usd: 0.014 });
    expect(l.reserve('b', 'founder', 0.01)?.message).toBe("Spending stopped: $0.014 of today's cap ($0.020) is used.");
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

describe('Ledger across processes', () => {
  it('concurrent writers in separate processes lose no entries (lockfile around every read-modify-write)', async () => {
    const { buildSync } = await import('esbuild');
    const { spawn } = await import('node:child_process');
    const dir = mkdtempSync(join(tmpdir(), 'ledger-mp-'));
    const bundle = join(dir, 'ledger.mjs');
    buildSync({ entryPoints: [join(__dirname, '../../server/ledger.ts')], bundle: true, platform: 'node', format: 'esm', outfile: bundle, logLevel: 'silent' });
    const worker = join(dir, 'worker.mjs');
    writeFileSync(worker, `import { Ledger } from ${JSON.stringify(bundle)};
const [path, tag, n] = process.argv.slice(2);
const l = new Ledger(path, { totalUsd: 1000 });
for (let i = 0; i < Number(n); i++) {
  const id = tag + '-' + i;
  if (l.reserve(id, 'dev', 0.01)) throw new Error('refused');
  l.settle({ id, phase: 'dev', kind: 'answer', model: 'm', usd: 0.001 });
}
`);
    const P = 6, N = 40;
    await Promise.all(Array.from({ length: P }, (_, k) => new Promise<void>((ok, bad) => {
      const c = spawn(process.execPath, [worker, path, `w${k}`, String(N)], { stdio: ['ignore', 'ignore', 'pipe'] });
      let err = '';
      c.stderr.on('data', (d) => { err += d; });
      c.on('exit', (code) => (code === 0 ? ok() : bad(new Error(`worker ${k} exited ${code}: ${err}`))));
    })));
    const f = JSON.parse(readFileSync(path, 'utf8'));
    expect(f.entries).toHaveLength(P * N);
    expect(new Set(f.entries.map((e: { id: string }) => e.id)).size).toBe(P * N);
    expect(f.open ?? {}).toEqual({});
    expect(existsSync(`${path}.lock`)).toBe(false);
  }, 60_000);

  it('takes over a lock left by a dead process, and one older than the stale limit', () => {
    const l = new Ledger(path, { totalUsd: 40 }, day('2026-10-28'));
    writeFileSync(`${path}.lock`, '999999 0');
    l.settle({ id: 'a', phase: 'dev', kind: 'answer', model: 'm', usd: 0.01 });
    writeFileSync(`${path}.lock`, `${process.pid} ${Date.now() - 60_000}`);
    l.settle({ id: 'b', phase: 'dev', kind: 'answer', model: 'm', usd: 0.01 });
    expect(JSON.parse(readFileSync(path, 'utf8')).entries.map((e: { id: string }) => e.id)).toEqual(['a', 'b']);
    expect(existsSync(`${path}.lock`)).toBe(false);
  });

  it('keeps an existing file exactly: entries, prior and total are unchanged on open', () => {
    const entries = Array.from({ length: 50 }, (_, i) => ({ id: `e${i}`, at: '2026-10-27T10:00:00.000Z', phase: 'iterate', kind: 'answer', model: 'gpt-6.1-terra', usd: 0.0123456789 * (i + 1) }));
    writeFileSync(path, JSON.stringify({ version: 1, priorUsd: 0.0076, entries }));
    const before = entries.reduce((s, e) => s + e.usd, 0.0076);
    const l = new Ledger(path, { totalUsd: 40 }, day('2026-10-28'), 0);
    expect(l.spent()).toBe(before);
    expect(JSON.parse(readFileSync(path, 'utf8')).entries).toEqual(entries);
  });
});

describe('Ledger daily cap', () => {
  it('counts "today" in local time, not UTC', () => {
    const tz = process.env.TZ;
    process.env.TZ = 'America/New_York';
    try {
      // 22:00 New York on the 28th is 02:00 UTC on the 29th.
      const l = new Ledger(path, { totalUsd: 40, dailyUsd: 0.1 }, () => new Date('2026-10-29T02:00:00Z'));
      l.settle({ id: 'a', phase: 'founder', kind: 'answer', model: 'm', usd: 0.05 });
      const f = JSON.parse(readFileSync(path, 'utf8'));
      f.entries.push({ id: 'b', at: '2026-10-28T14:00:00.000Z', phase: 'founder', kind: 'answer', model: 'm', usd: 0.04 }); // 10:00 NY, same local day
      f.entries.push({ id: 'c', at: '2026-10-28T03:00:00.000Z', phase: 'founder', kind: 'answer', model: 'm', usd: 0.5 }); // 23:00 NY the 27th
      writeFileSync(path, JSON.stringify(f));
      expect(l.summary().todayUsd).toBeCloseTo(0.09, 10);
      expect(l.reserve('d', 'founder', 0.02)?.code).toBe('daily');
    } finally {
      if (tz === undefined) delete process.env.TZ; else process.env.TZ = tz;
    }
  });
});

describe('Ledger daily cap is founder-only', () => {
  it('ignores dev/eval spend, counts founder spend, keeps total and phase caps on everything', () => {
    const caps = { totalUsd: 10, dailyUsd: 3, phaseUsd: { dev: 9 } };
    const l = new Ledger(path, caps, day('2026-10-28'));
    l.settle({ id: 'a', phase: 'dev', kind: 'answer', model: 'm', usd: 4 });
    l.settle({ id: 'b', phase: 'bakeoff', kind: 'answer', model: 'm', usd: 3.95 });
    expect(l.summary()).toMatchObject({ totalUsd: 7.95, todayUsd: 0, todayAllUsd: 7.95 });
    expect(l.check('founder', 0.5)).toBeNull();
    expect(l.check('dev', 0.5)).toBeNull(); // daily cap does not apply to dev
    l.settle({ id: 'c', phase: 'founder', kind: 'answer', model: 'm', usd: 2.8 });
    expect(l.summary()).toMatchObject({ todayUsd: 2.8, todayAllUsd: 10.75 });
    expect(l.check('founder', 0.1)?.code).toBe('total');
    const fresh = new Ledger(path, { totalUsd: 40, dailyUsd: 3 }, day('2026-10-28'));
    expect(fresh.check('founder', 0.3)?.code).toBe('daily');
    expect(fresh.check('founder', 0.1)).toBeNull();
    const tomorrow = new Ledger(path, { totalUsd: 40, dailyUsd: 3 }, day('2026-10-29'));
    expect(tomorrow.check('founder', 2.9)).toBeNull();
  });
  it('counts only founder reservations in flight toward the daily cap', () => {
    const l = new Ledger(path, { totalUsd: 40, dailyUsd: 1 }, day('2026-10-28'));
    expect(l.reserve('e', 'dev', 5)).toBeNull();
    expect(l.reserve('f', 'founder', 0.9)).toBeNull();
    expect(l.reserve('g', 'founder', 0.2)?.code).toBe('daily');
  });
});
