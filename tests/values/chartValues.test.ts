// Chart plots in the value model (design 3.2): a plot drawn on a slide's calibrated chart
// (`p=N on=#c1`) is a curve like any engine plot, so find / val / beforeafter / limit / contrast run
// on the slide's own graph. Before: a find there was spoken as "—" (engine.ts only modelled region plots).
import { describe, expect, it, afterEach } from 'vitest';
import { ScriptParser } from '../../src/script/parser';
import { GateState, UNBOUND_TEXT } from '../../src/gate/engine';
import { Figures, type Grounding } from '../../src/geometry/resolve';
import { parseTag } from '../../src/script/parseTag';
import { noteCharts } from '../../src/agent/context/charts';
import type { RawAction, ScriptEvent } from '../../src/script/types';

// A chart whose x axis runs 0–10 and y axis 0–60 (the counter example: wait = 60 / (mu − a)).
const chart = { kind: 'chart' as const, rect: { x: 520, y: 330, w: 420, h: 560 }, x: { lo: 0, hi: 10, p0: 520, p1: 940 }, y: { lo: 0, hi: 60, p0: 890, p1: 330 } };
const ground: Grounding = { mark: (p, id) => (p === 2 && id === '#c1' ? chart : undefined) };

const words = (p: ScriptParser, s: string) => {
  const ev: ScriptEvent[] = [...p.push(s), ...p.end()];
  return ev.flatMap((e) => (e.type === 'word' ? [e.text] : [])).join(' ');
};

afterEach(() => noteCharts(undefined));

describe('chart plots in the value model', () => {
  it('a find on a chart plot is spoken with the engine value (was —)', () => {
    const p = new ScriptParser(new GateState(ground));
    const said = words(p, '{{const mu=10}} {{plot p=2 on=#c1 id=w fn="60/(mu-x)"}} {{find id=b of=w x=8}} At eight it reads {{val id=b.y}} minutes.');
    expect(said).toContain('reads 30 minutes');
    expect(said).not.toContain(UNBOUND_TEXT);
  });

  it('the parser of a live answer reads the charts of the latest grounding', () => {
    noteCharts(ground);
    const p = new ScriptParser();
    expect(words(p, '{{const mu=10}} {{plot p=2 on=#c1 id=w fn="60/(mu-x)"}} {{find id=top of=w level=20}} It hits twenty at {{val id=top.x}}.')).toContain('at 7.');
  });

  it('a chart plot spans the chart x axis: a crossing off it is not read (never guessed)', () => {
    const g = new GateState(ground);
    // 4 + x/5 = 12 − x/5 at x = 20, past this chart's 0–10 axis.
    for (const s of ['const t=2', 'plot p=2 on=#c1 id=st fn="2+t+x/5"', 'plot p=2 on=#c1 id=d fn="12-x/5"']) expect(g.apply(parseTag(s) as RawAction, 0)).toBeUndefined();
    expect(g.apply(parseTag('find id=E of=st,d') as RawAction, 0)).toBeTypeOf('string');
  });

  it('a crossing inside the chart is read, and beforeafter moves it', () => {
    const wide = { ...chart, x: { lo: 0, hi: 60, p0: 113, p1: 525 }, y: { lo: 0, hi: 14, p0: 804, p1: 254 } };
    const g = new GateState({ mark: (p, id) => (p === 1 && id === '#c1' ? wide : undefined) });
    for (const s of ['const t=2', 'plot p=1 on=#c1 id=st fn="2+t+x/5"', 'plot p=1 on=#c1 id=d fn="12-x/5"', 'find id=E of=st,d']) expect(g.apply(parseTag(s) as RawAction, 0)).toBeUndefined();
    expect(g.value('E.x')).toMatchObject({ v: expect.closeTo(20, 6) });
    expect(g.value('E.y')).toMatchObject({ v: expect.closeTo(8, 6) });
    expect(g.apply(parseTag('beforeafter of=st t=4') as RawAction, 1)).toBeUndefined();
    expect(g.value('E.y')).toMatchObject({ v: expect.closeTo(9, 6) });
    const c = g.expand(parseTag('contrast of=st t=0 id=s0') as Extract<RawAction, { kind: 'contrast' }>);
    expect(c).toMatchObject({ kind: 'plot', page: 1, chart: '#c1', id: 's0' });
  });

  it('a chart plot on an unknown chart is not modelled (skip, never guess)', () => {
    const g = new GateState(ground);
    expect(g.apply(parseTag('plot p=2 on=#c9 id=w fn="x"') as RawAction, 0)).toBeUndefined();
    expect(g.apply(parseTag('find id=b of=w x=1') as RawAction, 0)).toBeTypeOf('string');
  });

  it('the resolver leaves a readout point on a chart for the kit (at=E)', () => {
    const f = new Figures(ground);
    const pt = parseTag('point p=2 on=#c1 at=E "E"') as RawAction;
    f.note(parseTag('find id=E of=w x=8') as RawAction);
    f.note(pt);
    const r = f.resolve(pt) as unknown as Record<string, unknown>;
    expect(r).toMatchObject({ kind: 'point', page: 2, at: { ref: 'E' } });
    expect(r.onChart).toMatchObject({ rect: chart.rect });
  });
});
