import { describe, it, expect } from 'vitest';
import { pickForCalibration, compareHand, handTemplate, formatCalibration, handHtml, TRUST, type HandItem } from '../../scripts/eval/calibrate';
import { CRITERIA_R3, type JudgeResult } from '../../scripts/eval/judge';

const J = (s: number[], defects: string[] = [], fatal: JudgeResult['fatal'] = []): JudgeResult => ({ rubric: 'r3', scores: Object.fromEntries(CRITERIA_R3.map((c, i) => [c, s[i]])), defects, fatal, notes: '' });
const H = (id: string, s: (number | null)[], defects: string[] = [], fatal: string[] = []): HandItem => ({ id, scores: Object.fromEntries(CRITERIA_R3.map((c, i) => [c, s[i]])), defects, fatal, notes: '' });

describe('calibration', () => {
  it('picks spread over decks first, then scope; seeded and distinct', () => {
    const items = ['a', 'a', 'a', 'a', 'b', 'b', 'c', 'd'].map((deck, i) => ({ id: `D${i + 1}`, deck, scope: i % 2 ? 'broad' : 'narrow' }));
    const p = pickForCalibration(items, 4, 1);
    expect(new Set(p.map((x) => x.deck))).toEqual(new Set(['a', 'b', 'c', 'd']));
    expect(new Set(p.map((x) => x.id)).size).toBe(4);
    expect(pickForCalibration(items, 4, 1)).toEqual(p);
    expect(pickForCalibration(items, 20, 1)).toHaveLength(8);
    const two = pickForCalibration(items.filter((x) => x.deck === 'a'), 2, 5);
    expect(new Set(two.map((x) => x.scope)).size).toBe(2);
  });
  it('compares hand and judge: bias, exact, ±1, defects, fatal; trust needs both thresholds', () => {
    const judge = { D1: J([4, 3, 3, 4, 4], ['padded']), D2: J([5, 2, 4, 3, 3], [], ['wrong_fact']), D3: J([3, 3, 3, 3, 3]) };
    const hand = [H('D1', [3, 3, 3, 4, 4], ['padded']), H('D2', [4, 1, 4, 3, 3], ['written_not_drawn'], ['wrong_fact']), H('D3', [null, 3, 3, 3, 3]), H('D9', [3, 3, 3, 3, 3])];
    const c = compareHand(hand, judge, CRITERIA_R3);
    expect(c.n).toBe(2); // D3 incomplete, D9 unjudged
    const u = c.criteria.find((s) => s.criterion === 'understanding')!;
    expect(u.bias).toBeCloseTo(1); expect(u.exact).toBe(0); expect(u.within1).toBe(1);
    expect(c.within1).toBe(1); expect(c.exact).toBeCloseTo(7 / 10);
    expect(c.trusted).toBe(false); // understanding bias +1 > 0.5
    expect(c.defects).toEqual([{ defect: 'padded', judge: 1, hand: 1, both: 1 }, { defect: 'written_not_drawn', judge: 0, hand: 1, both: 0 }]);
    expect(c.fatal).toEqual({ judge: 1, hand: 1, both: 1 });
    expect(compareHand([H('D1', [4, 3, 3, 4, 4])], judge, CRITERIA_R3).trusted).toBe(false); // too few answers
    const eight = Object.fromEntries(Array.from({ length: 8 }, (_, i) => [`D${i + 1}`, J([4, 3, 3, 4, 4])]));
    expect(compareHand(Array.from({ length: 8 }, (_, i) => H(`D${i + 1}`, i % 2 ? [4, 4, 3, 4, 5] : [4, 3, 3, 4, 4])), eight, CRITERIA_R3).trusted).toBe(true);
    expect(compareHand([], judge, CRITERIA_R3)).toMatchObject({ n: 0, trusted: false });
    expect(formatCalibration(c)).toContain('NOT TRUSTED');
    expect(TRUST.within1).toBe(0.8);
  });
  it('the template has null scores for every criterion; the hand page is blind and script-free', () => {
    const t = handTemplate('r3', ['D1', 'T4']);
    expect(t.items).toHaveLength(2);
    expect(Object.values(t.items[0].scores).every((v) => v === null)).toBe(true);
    expect(t.criteria).toEqual([...CRITERIA_R3]);
    const html = handHtml('RUBRIC <x>', [{ id: 'D1', question: 'why?', deck: 'econ', scope: 'broad', page: '../D1/page.png', timeline: [{ src: '../D1/s2.png', caption: 'After sentence 3' }], final: '../D1/final.png', transcript: 'Look [circle ✓]' }]);
    expect(html).toContain('../D1/s2.png'); expect(html).toContain('RUBRIC &lt;x&gt;');
    expect(html).not.toMatch(/<script/i); expect(html).not.toMatch(/judge mean|notes/i);
  });
});
