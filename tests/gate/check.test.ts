import { describe, expect, it } from 'vitest';
import { matches, mentions, textNumbers } from '../../src/gate/numbers';
import { checkDeixis, checkDirections, checkErasure, checkGeometry, checkNumbers, checkTags, checkThresholds, deictics, derivedValues } from '../../src/gate/check';
import { GateState } from '../../src/gate/engine';
import { checkLayout, segHitsRect, type El } from '../../src/gate/layout';
import { beats } from '../../src/gate/segment';

const W = (s: string) => s.split(/\s+/).filter(Boolean);
/** Replays a script into a fresh state (every tag applied, beat index = its beat). */
function replay(script: string) {
  const st = new GateState();
  const bs = beats(script, { rule: 'para' });
  bs.forEach((b, k) => { for (const t of b.tags) if (t.action) { st.note(t.action); st.apply(t.action, k); } });
  return { st, bs };
}

describe('numbers', () => {
  it('reads digits, spelled numbers, decimals, fractions and percentages', () => {
    const ms = mentions(W('twelve trials, zero point nine nine, about fifty-eight percent, 0.012 and 2/3 or two-thirds; one hundred twenty dollars'));
    expect(ms.map((m) => [m.value, m.percent, m.approx])).toEqual([
      [12, false, false], [0.99, false, false], [58, true, true], [0.012, false, false], [2 / 3, false, false], [2 / 3, false, false], [120, false, false],
    ]);
  });
  it('stops a spelled number at punctuation, and marks references', () => {
    expect(mentions(W('ten and twenty. Nine is')).map((m) => m.value)).toEqual([10, 20, 9]);
    expect(mentions(W('on page 48, see Figure 3')).every((m) => m.ref)).toBe(true);
  });
  it('matches within the written precision; a percentage also reads as a fraction', () => {
    const [one] = mentions(W('one percent'));
    expect(matches(one, 0.01)).toBe(true);
    expect(matches(one, 0.012)).toBe(true); // 1.2% rounds to one percent: D9's contradiction is the threshold, not the number
    expect(matches(one, 0.016)).toBe(false);
    const [d] = mentions(W('0.58'));
    expect(matches(d, 0.578)).toBe(true);
    expect(matches(d, 0.57)).toBe(false);
    expect(textNumbers('of 150 N and 1/3, 2.5%')).toEqual([150, 1 / 3, 2.5]);
  });
  it('flags a number that matches nothing known, accepts one arithmetic step', () => {
    const known = [{ v: 105, source: 'computed' as const, of: 'x', beat: 0 }, { v: 100, source: 'computed' as const, of: 'y', beat: 0 }];
    const ctx = { known, derived: derivedValues([105, 100], []), intersections: [] };
    expect(checkNumbers(W('guests pay five dollars more, 105 in total'), ctx).flags).toEqual([]);
    expect(checkNumbers(W('guests pay 137 in total'), ctx).flags).toHaveLength(1);
    expect(checkNumbers(W('two points and three images'), ctx).flags).toEqual([]); // small counts
    expect(checkNumbers(W('137 on the slide'), { ...ctx, pageImage: true }).flags).toEqual([]);
  });
});

describe('engine-bound claims', () => {
  const D9 = '{{sketch id=s}} {{table on=s id=trials cols=k,failure vals=10;11}} {{col id=trials.failure fn="(1-(6/10)*(5/9))^a" dur=3}} Here, ten trials leave more than one percent failure probability; eleven bring it below one percent.';
  it('computes a table column with the kit formula and catches a threshold claim it contradicts', () => {
    const { st, bs } = replay(D9);
    expect(st.values.filter((v) => v.row).map((v) => +v.v.toFixed(4))).toEqual([0.0173, 0.0116]);
    const f = checkThresholds(bs[0].words.map((w) => w.text), st, 0);
    expect(f).toHaveLength(1);
    expect(f[0].detail).toContain('eleven');
  });
  it('passes the same claims when the numbers agree', () => {
    const { st, bs } = replay(D9.replace('vals=10;11', 'vals=10;12').replace('eleven', 'twelve'));
    expect(checkThresholds(bs[0].words.map((w) => w.text), st, 0)).toEqual([]);
  });
  it('catches a direction claim about a computed column', () => {
    const s = '{{sketch id=s}} {{table on=s id=patch cols="l0,l1,Harris" vals=1,1;1,10}} {{col id=patch.c fn="a*b-0.06*(a+b)^2" dur=2}} Harris gives the edge-like patch a lower score.';
    const { st, bs } = replay(s);
    expect(checkDirections(bs[0].words.map((w) => w.text), st, 0)[0]?.detail).toMatch(/0\.76 → 2\.74/);
    const ok = replay(s.replace('lower', 'higher'));
    expect(checkDirections(ok.bs[0].words.map((w) => w.text), ok.st, 0)).toEqual([]);
  });
  it('knows calc results, set updates and where plots on shared axes cross', () => {
    const { st } = replay('{{sketch id=s}} {{bars on=s id=v vals=48,52}} {{calc on=s of=v reduce=mean}} {{set id=v vals=50,54}} {{const a=125 b=0.25 c=25 d=0.75}} {{plot on=s id=dm fn="a-b*x" domain=0,120}} {{plot on=s id=sp fn="c+d*x" domain=0,120 axes=dm}} Done.');
    expect(st.values.some((v) => v.of === '_1' && v.v === 50)).toBe(true);
    expect(st.values.some((v) => v.v === 54)).toBe(true);
    const x = st.intersections();
    expect(x).toHaveLength(1);
    expect(x[0].x).toBeCloseTo(100, 6);
    expect(x[0].y).toBeCloseTo(100, 6);
  });
});

describe('deixis, geometry, erasure, tags', () => {
  it('finds pointing words, not anaphora or "here" meaning "in this case"', () => {
    expect(deictics(W('Here is the curve. Notice this line, and that line. Here, b is zero. That value matters. the fifth score here, rather')).map((d) => d.text)).toEqual(['Here', 'Notice', 'this line,', 'that line.', 'here,']);
  });
  it('flags a deictic word with no ink nearby', () => {
    const [b] = beats('{{sketch id=s}} Take this curve {{point on=s at=1,2}} here. Many many many words follow on and on and on until the end with this line far away now.', { rule: 'para' });
    expect(checkDeixis(b).map((f) => f.detail)).toEqual([expect.stringContaining('this line')]);
  });
  it('checks tangency and points on a circle exactly', () => {
    const s = (to: string) => `{{sketch id=s}} {{let on=s O=500,350 A=700,350 T=${to}}} {{circle on=s at=O r=200}} The tangent {{line on=s from=A to=T}} touches it.`;
    for (const [to, n] of [['700,100', 0], ['650,100', 1]] as const) {
      const { st, bs } = replay(s(to));
      expect(checkGeometry(bs[0], st, { segs: st.segs.map((x) => x.id), points: [] })).toHaveLength(n);
    }
  });
  it('allows erasure only as a declared move; reports malformed and skipped tags', () => {
    const [b] = beats('A {{fade id=x}} b. {{move id=p to=1,2}} Now slide it over. {{clear}} c. {{nonsense}} d.', { rule: 'para' });
    expect(checkErasure(b).map((f) => f.detail)).toEqual([expect.stringContaining('fade'), 'clear erases committed ink']);
    const skipped = new Map([[b.tags[0], 'unknown id']]);
    expect(checkTags(b, skipped).map((f) => f.detail)).toEqual(['fade skipped: unknown id', 'malformed {{nonsense}}']);
  });
});

describe('layout', () => {
  const el = (id: string, kind: string, bbox: El['bbox'], extra: Partial<El> = {}): El => ({ id, kind, region: 's', bbox, boxes: [bbox], strokes: [], text: [], ...extra });
  it('flags touching texts, a stroke through a label, overlapping kit blocks, wide bar labels', () => {
    const a = el('_1', 'write', { x: 195, y: 615, w: 189, h: 29 }, { text: [{ x: 195, y: 615, w: 189, h: 29 }] });
    const b = el('_2', 'write', { x: 385, y: 615, w: 188, h: 29 }, { text: [{ x: 385, y: 615, w: 188, h: 29 }] });
    expect(checkLayout([b], [a]).map((f) => f.kind)).toEqual(['text-overlap']);
    const lab = el('_3', 'point', { x: 159, y: 511, w: 72, h: 50 }, { text: [{ x: 159, y: 532, w: 72, h: 28 }] });
    const line = el('_4', 'line', { x: 191, y: 511, w: 8, h: 130 }, { strokes: [[{ x: 195, y: 511 }, { x: 195, y: 640 }]] });
    expect(checkLayout([line], [lab]).map((f) => f.kind)).toEqual(['text-on-stroke']);
    const k1 = el('p1', 'kit-plot', { x: 0, y: 0, w: 500, h: 400 }, { text: [{ x: 0, y: 0, w: 500, h: 400 }], group: 'p1' });
    const k2 = el('p2', 'kit-plot', { x: 0, y: 0, w: 500, h: 400 }, { text: [{ x: 0, y: 0, w: 500, h: 400 }], group: 'p1' });
    const k3 = el('g', 'kit-grid', { x: 400, y: 300, w: 200, h: 100 }, { text: [{ x: 400, y: 300, w: 200, h: 100 }] });
    expect(checkLayout([k2], [k1])).toEqual([]);
    expect(checkLayout([k3], [k1]).map((f) => f.kind)).toEqual(['block-overlap']);
    const bars = el('v', 'kit-bars', { x: 40, y: 32, w: 106, h: 241 }, { text: [{ x: 40, y: 32, w: 106, h: 241 }], barLabels: ['row-column', 'column-row'] });
    expect(checkLayout([bars], []).map((f) => f.kind)).toEqual(['bar-labels']);
  });
  it('clips segments against rectangles', () => {
    expect(segHitsRect({ x: 0, y: 0 }, { x: 10, y: 10 }, { x: 4, y: 4, w: 2, h: 2 })).toBe(true);
    expect(segHitsRect({ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 4, y: 4, w: 2, h: 2 })).toBe(false);
  });
});
