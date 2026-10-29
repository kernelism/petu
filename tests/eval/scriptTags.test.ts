import { describe, it, expect } from 'vitest';
import { parseScript } from '../../scripts/eval/scriptTags';
import { renderTranscript } from '../../scripts/eval/judge';
import { computeMetrics } from '../../scripts/eval/metrics';
import { emptyResult, type EvalResult, type SerialTiming } from '../../src/agent/evalHooks';

const tm = (action: Record<string, unknown>, fired: number, skipped?: string): SerialTiming =>
  ({ action: action as SerialTiming['action'], firedAt: fired, queuedAt: fired, startedAt: fired, endedAt: fired + 1, ...(skipped ? { skipped } : {}) });

// Verbatim shapes from the draw runs (haiku D1): const, scene, plot, find, val — all of which work.
const SCRIPT = '{{const g=9.8 Km=2}} {{scene id=s}} Here is the curve {{plot on=s id=q fn="g*x/(Km+x)" domain=0,20 "rate"}} '
  + '{{find id=h of=q level=4.9}} {{point on=s at=h "half"}} It reaches half at {{val id=h.x fmt=0}} units. '
  + '{{sketch id=t near=p4}} {{line on=t from=Ps}} {{val id=nope}} done';
const TIMINGS = [
  tm({ kind: 'sketch', id: 's', scene: true }, 10), tm({ kind: 'plot', id: 'q' }, 20), tm({ kind: 'point' }, 30),
  tm({ kind: 'sketch', id: 't' }, 40), tm({ kind: 'val', ref: 'nope' }, 50, 'unbound value nope'),
];
const result = (): EvalResult => { const r = emptyResult('Q', 0); r.chunks = [{ t: 0, d: SCRIPT }]; r.timings = TIMINGS; return r; };

describe('judge transcript marks only real failures', () => {
  const t = renderTranscript(result(), parseScript(SCRIPT).tags);
  it('const, scene, find and a resolved val are not "not parsed"', () => {
    expect(t).toContain('[const g=9.8 Km=2]');
    expect(t).toContain('[scene id=s ✓]');
    expect(t).toContain('[find id=h of=q level=4.9]');
    expect(t).toContain('[sketch id=t near=p4 ✓]'); // the scene does not take the later sketch's timing
    expect(t.match(/not parsed/g)).toHaveLength(1); // only the broken line
    expect(t).toContain('[line on=t from=Ps ✗ not parsed]');
  });
  it('a resolved val shows what was said; an unbound one shows its skip', () => {
    expect(t).toContain('[val id=h.x fmt=0 → "2" ✓]');
    expect(t).toContain('[val id=nope ✗ unbound value nope]');
  });
  it('without the parse, names alone still keep const/find/val/scene honest', () => {
    const n = renderTranscript(result());
    expect(n).toContain('[const g=9.8 Km=2]');
    expect(n).toContain('[scene id=s ✓]');
    expect(n).toContain('[sketch id=t near=p4 ✓]');
    expect(n).toContain('[val id=nope ✗ unbound value nope]');
    expect(n.match(/not parsed/g)).toHaveLength(1);
  });
});

describe('malformed comes from the parser', () => {
  it('one broken tag; find, val and a contrast expansion are not malformed', () => {
    const s = `${SCRIPT} {{contrast of=q Km=4 "slower"}}`;
    expect(parseScript(s).malformed).toBe(1);
    const r = result(); r.chunks = [{ t: 0, d: s }];
    const m = computeMetrics(r, parseScript(s));
    expect(m.malformed).toBe(1);
  });
  it('an unclosed tag counts', () => {
    expect(parseScript('Say {{circle p=3 mark=#d1 and then more words').malformed).toBe(1);
  });
});

describe('skip dependents see untimed readouts', () => {
  it('a skipped plot that a later {{find}} reads is a skip with dependents (sonnet D1)', () => {
    const s = '{{sketch id=s near=p4}} {{const Vmax=10 K2=4}} {{plot on=s id=b fn="Vmax*x/(K2+x)" domain=0,20}} {{find id=h2 of=b level=5}} Half rate at {{val id=h2.x fmt=0}}.';
    const r = emptyResult('Q', 0); r.chunks = [{ t: 0, d: s }];
    r.timings = [tm({ kind: 'sketch', id: 's' }, 10), tm({ kind: 'plot', id: 'b' }, 20, 'bad fn Vmax*x/(K2+x)'), tm({ kind: 'val', ref: 'h2.x' }, 30, 'unbound value h2.x')];
    const m = computeMetrics(r, parseScript(s));
    expect(m.skippedDeps).toBe(1);
    expect(m.skipDefect).toBe(true);
    expect(m.malformed).toBe(0);
  });
});
