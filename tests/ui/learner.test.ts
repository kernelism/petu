// v1 learner UX: the bar's moment, check questions, point-to-ask context, aside context, trail heads,
// and the server's per-turn notes.
import { describe, it, expect, vi } from 'vitest';
import { barMode, closingQuestion, PLACEHOLDER } from '../../src/ui/barMode';
import { aboutContext, asideContext, bboxOf, isLoop, pointedLabel } from '../../src/agent/moment';
import { answerHead, asideHead, clockOf, trailTitle } from '../../src/ui/trail';
import { boardLayout } from '../../src/desk/layout';

describe('bar mode', () => {
  const base = { busy: false, aside: false, answered: false, check: null };
  it('follows the moment, and its placeholder says which', () => {
    expect(PLACEHOLDER[barMode(base)]).toBe('Ask about this PDF…');
    expect(PLACEHOLDER[barMode({ ...base, busy: true })]).toBe('Ask about this…');
    expect(barMode({ ...base, busy: true, aside: true })).toBe('aside');
    expect(PLACEHOLDER[barMode({ ...base, answered: true })]).toBe('Follow up…');
    expect(PLACEHOLDER[barMode({ ...base, answered: true, check: 'What would buyers pay?' })]).toBe('Your answer…');
    // A new answer playing outranks a pending check.
    expect(barMode({ ...base, busy: true, check: 'x?' })).toBe('during');
  });
  it('a check question is the shape of the ending, never its words', () => {
    expect(closingQuestion('Each side pays half. With a tax of four, what would buyers pay?')).toBe('With a tax of four, what would buyers pay?');
    expect(closingQuestion('Was ist die Elastizität? Sie misst die Reaktion.')).toBeNull();
    expect(closingQuestion('So the cell divides.')).toBeNull();
    expect(closingQuestion('Gains vanish. Now try one yourself: with a tax of four, what would buyers pay?')).toBe('With a tax of four, what would buyers pay?');
    expect(closingQuestion('Why?')).toBeNull();
  });
});

describe('point-to-ask', () => {
  it('a selection or a circle becomes a short chip label and a context line', () => {
    const sel = { kind: 'selection' as const, page: 12, text: 'Buyers and sellers split the tax between them evenly' };
    expect(pointedLabel(sel)).toBe('Buyers and sellers split the…');
    expect(aboutContext(sel)).toContain('page 12');
    const circ = { kind: 'circle' as const, page: 4, bbox: { x: 250, y: 480, w: 60, h: 100 }, text: '' };
    expect(pointedLabel(circ)).toBe('circled region');
    expect(aboutContext(circ)).toMatch(/page 4 \(x 250–310, y 480–580 of 1000\); no text inside/);
    expect(aboutContext({ kind: 'circle', board: true, elements: ['bars #pay'], text: '' })).toContain('bars #pay');
  });
  it('a pen stroke that closes on itself is a loop; a line is not', () => {
    const loop = Array.from({ length: 30 }, (_, i) => ({ x: 100 + 40 * Math.cos((i / 29) * 2 * Math.PI), y: 100 + 30 * Math.sin((i / 29) * 2 * Math.PI) }));
    expect(isLoop(loop)).toBe(true);
    expect(isLoop(Array.from({ length: 30 }, (_, i) => ({ x: i * 10, y: 50 })))).toBe(false);
    expect(bboxOf(loop).w).toBeCloseTo(80, 0);
  });
});

describe('aside context', () => {
  it('carries the paused answer: question, plan, words so far (tail), board', () => {
    const t = asideContext({ question: 'Who pays the tax?', plan: 'wedge, then shares', said: 'word '.repeat(400), board: ['bars #pay on w'] });
    expect(t).toContain('Who pays the tax?');
    expect(t).toContain('Its plan: wedge, then shares');
    expect(t).toContain('…');
    expect(t).toContain('On the board now: bars #pay on w');
    expect(t.length).toBeLessThan(2000);
  });
});

describe('session trail', () => {
  it('an answer head replays on click and shows its meta', () => {
    const onReplay = vi.fn();
    const h = answerHead({ num: '2', question: 'Why?', onReplay });
    h.setMeta(`p.12 · ${clockOf(52_400)}`);
    expect(h.el.textContent).toContain('p.12 · 0:52');
    (h.el.querySelector('button') as HTMLButtonElement).click();
    expect(onReplay).toHaveBeenCalled();
    expect(trailTitle('check', 'What would buyers pay?')).toBe('Check yourself: What would buyers pay?');
    expect(trailTitle('answer', 'why lost?', 'DWL')).toBe('About DWL: why lost?');
  });
  it('an aside head goes back while open and reopens from its marker', () => {
    const onBack = vi.fn(), onToggle = vi.fn();
    const h = asideHead({ question: 'what is elasticity?', onBack, onToggle });
    (h.el.querySelector('.trail-aside-back') as HTMLButtonElement).click();
    (h.el.querySelector('.trail-aside-marker') as HTMLButtonElement).click();
    expect(onBack).toHaveBeenCalledTimes(1);
    expect(onToggle).toHaveBeenCalledTimes(1);
  });
  it('heads take room above their section; a collapsed aside keeps only its head', () => {
    const plain = boardLayout(600, [{ body: 16 }, { body: 16 }]);
    const headed = boardLayout(600, [{ body: 16, head: 44 }, { body: 16, head: 40, hidden: true }]);
    expect(headed.boxes[0].y).toBe(plain.boxes[0].y + 44);
    expect(headed.boxes[1].h).toBe(0);
    expect(headed.height).toBeLessThan(plain.height);
  });
});

