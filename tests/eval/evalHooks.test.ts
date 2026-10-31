import { describe, it, expect, vi } from 'vitest';
import type { GateEvent } from '../../src/gate/events';
import { EvalHooks, installEvalHooks, outOfFrameOf, loopAround, publishGate, gateEvents, GATE_LOG_KEY, type EvalBackend } from '../../src/agent/evalHooks';

function backend(over: Partial<EvalBackend> = {}): EvalBackend {
  return {
    ready: async () => {}, ask: async () => {}, replay: async () => {}, addInk: () => {},
    registry: () => [], outOfFrame: () => 0, ...over,
  };
}

describe('evalHooks', () => {
  it('records chunks, words, sentences, timings relative to Enter, and serialises to JSON', async () => {
    let clock = 1000;
    const shot = vi.fn();
    const h = new EvalHooks(backend({
      ask: async (_q, rec) => {
        clock = 1100; rec.chunk('Hello {{circle p=1');
        rec.event({ t: 'text', d: 'Hello' });
        clock = 1300; rec.word('Hello');
        rec.timing({ action: { kind: 'circle', page: 1 } as never, firedAt: 1300, queuedAt: 1290, startedAt: NaN });
        rec.timing({ action: { kind: 'circle', page: 1 } as never, firedAt: 1300, queuedAt: 1290, startedAt: 1310, endedAt: 1500 });
        clock = 1600; rec.sentenceEnd('Hello.');
      },
      registry: () => [{ id: 'a', kind: 'circle', target: { page: 1 }, bbox: { x: 0, y: 0, w: 1, h: 1 }, boxes: [], strokes: [[{ x: 0, y: 0 }, { x: 1, y: 1 }]] }],
      outOfFrame: () => 2,
    }), () => clock, shot);
    clock = 1000;
    await h.ask('Q?');
    const r = h.result();
    expect(JSON.parse(JSON.stringify(r))).toEqual(r);
    expect(r.question).toBe('Q?');
    expect(r.t0).toBe(1000);
    expect(r.chunks).toEqual([{ t: 100, d: 'Hello {{circle p=1' }]);
    expect(r.words).toEqual([{ text: 'Hello', t: 300 }]);
    expect(r.sentences).toEqual([{ text: 'Hello.', endMs: 600 }]);
    expect(shot).toHaveBeenCalledWith(0);
    expect(r.timings).toHaveLength(1); // start + end reports collapse to one row
    expect(r.timings[0]).toMatchObject({ firedAt: 300, startedAt: 310, endedAt: 500 });
    expect(r.registry[0].id).toBe('a');
    expect(r.outOfFrame).toBe(2);
  });
  it('NaN start becomes null', async () => {
    const h = new EvalHooks(backend({ ask: async (_q, rec) => { rec.timing({ action: { kind: 'scroll', page: 2 } as never, firedAt: 5, queuedAt: 5, startedAt: NaN, skipped: 'x' }); } }), () => 0, () => {});
    await h.ask('q');
    expect(h.result().timings[0]).toMatchObject({ startedAt: null, endedAt: null, skipped: 'x' });
  });
  it('replay feeds the same chunks in order and keeps the question', async () => {
    const seen: string[] = [];
    const h = new EvalHooks(backend({ replay: async (chunks, rec) => { for (const c of chunks) { seen.push(c.d); rec.chunk(c.d); } } }), () => 0, () => {});
    const log = { question: 'Q', chunks: [{ t: 0, d: 'a' }, { t: 40, d: 'b' }, { t: 90, d: 'c' }], events: [] };
    await h.replay(log);
    expect(seen).toEqual(['a', 'b', 'c']);
    expect(h.result().chunks.map((c) => c.d)).toEqual(['a', 'b', 'c']);
    expect(h.result().question).toBe('Q');
  });
  it('a failing ask still snapshots the registry', async () => {
    const h = new EvalHooks(backend({ ask: async () => { throw new Error('boom'); }, outOfFrame: () => 1 }), () => 0, () => {});
    await expect(h.ask('q')).rejects.toThrow('boom');
    expect(h.result().outOfFrame).toBe(1);
  });
  it('installs window.__petu with its calls', () => {
    const w = {} as Window & { __petu?: Record<string, unknown> };
    installEvalHooks(backend(), w);
    expect(Object.keys(w.__petu!).sort()).toEqual(['addInk', 'ask', 'gate', 'goto', 'inkAroundLargestMark', 'ready', 'replay', 'result']);
  });
  it('__petu.gate(): the answer’s gate and repair events, else what the app published (dev scripts)', async () => {
    const w = {} as Window & { __petu?: Record<string, () => unknown> };
    const g: GateEvent = { t: 'gate', k: '2', unit: 'beat', result: 'fail', action: 'drop', flags: [{ check: 'named', detail: 'point Z' }], notes: [], ms: 4, bufferedMs: 6100, mode: 'beat' };
    publishGate(g, w);
    expect((w as unknown as Record<string, unknown[]>)[GATE_LOG_KEY]).toHaveLength(1);
    const h = installEvalHooks(backend({ ask: async (_q, rec) => { rec.event({ t: 'text', d: 'x' }); rec.event({ ...g, k: '0', action: 'release', result: 'pass', flags: [] }); rec.event({ t: 'repair', k: '0', phase: 'sent', ms: 0 }); } }), w);
    expect(w.__petu!.gate()).toEqual([g]);
    await h.ask('q');
    expect((w.__petu!.gate() as { k: string }[]).map((e) => e.k)).toEqual(['0', '0']);
    expect(gateEvents({ events: [] }, {})).toEqual([]);
  });
  it('outOfFrameOf sums fitted regions from director.figures', () => {
    const figs = { figure: (t: { region: string }) => ({ outOfFrame: t.region === 'a' ? 2 : 3 }) };
    expect(outOfFrameOf(figs, ['a', 'b'])).toBe(5);
  });
  it('ink loop surrounds the largest mark and stays on the page', () => {
    const added: unknown[] = [];
    const h = new EvalHooks(backend({ largestMark: () => ({ x: 400, y: 400, w: 100, h: 60 }), addInk: (p, pts) => added.push([p, pts]) }), () => 0, () => {});
    expect(h.inkAroundLargestMark(3)).toBe(true);
    const pts = (added[0] as [number, { x: number; y: number }[]])[1];
    expect(pts[0]).toEqual({ x: expect.closeTo(pts[pts.length - 1].x, 5), y: expect.closeTo(pts[pts.length - 1].y, 5) });
    expect(Math.min(...pts.map((p) => p.x))).toBeLessThan(400);
    expect(Math.max(...pts.map((p) => p.x))).toBeGreaterThan(500);
    expect(loopAround({ x: 990, y: 0, w: 20, h: 20 }).every((p) => p.x <= 1000 && p.y >= 0)).toBe(true);
    expect(new EvalHooks(backend(), () => 0, () => {}).inkAroundLargestMark(1)).toBe(false);
  });
});
