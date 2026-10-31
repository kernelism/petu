// tests/session/session.test.ts — saved questions: titles, names in the list, page marks taken and put back.
import { describe, it, expect } from 'vitest';
import { cleanTitle, titleInput } from '../../src/session/title';
import { linesOf, nameOf, newConversation, pagesOf, titleInputOf, type ConvEntry } from '../../src/session/conversations';
import { putMarks, takeMarks } from '../../src/session/marks';

describe('cleanTitle', () => {
  it('plain words: no quotes, lead, markdown or trailing period; at most six words; one line', () => {
    expect(cleanTitle('"Compound interest over time."')).toBe('Compound interest over time');
    expect(cleanTitle('Title: Why prices fall')).toBe('Why prices fall');
    expect(cleanTitle('**Supply and demand**')).toBe('Supply and demand');
    expect(cleanTitle('one two three four five six seven eight')).toBe('one two three four five six');
    expect(cleanTitle('Why the yeast rises at the end')).toBe('Why the yeast rises');
    expect(cleanTitle('\n  Torque on a lever\nmore text')).toBe('Torque on a lever');
    expect(cleanTitle('“Elasticity”…')).toBe('Elasticity');
    expect(cleanTitle('   ')).toBe('');
  });
  it('the input is trimmed, bounded and deduplicated', () => {
    expect(titleInput([' a  b ', ''], ['S', 'S', ' '])).toEqual({ questions: ['a b'], sections: ['S'] });
    expect(titleInput(Array(20).fill('q'), []).questions).toHaveLength(12);
  });
});

describe('conversations', () => {
  const conv = (entries: ConvEntry[]) => { const c = newConversation(); c.entries.push(...entries); return c; };
  const labels: Record<number, string> = { 3: 'The village economy', 5: 'Income' };
  const label = (p: number) => labels[p];

  it('named by its title, else the first answer\'s section title, else its first question', () => {
    const c = conv([{ question: 'why is it 50?', page: 3, pages: [3, 5] }]);
    expect(nameOf(c, label)).toBe('The village economy');
    expect(nameOf(conv([{ question: 'why is it 50?', page: 9 }]), label)).toBe('why is it 50?');
    c.title = 'Coins at the baker';
    expect(nameOf(c, label)).toBe('Coins at the baker');
  });

  it('its title is made from its questions (not a check reply) and the sections it taught from', () => {
    const c = conv([
      { question: 'why is it 50?', page: 3, pages: [3] },
      { question: 'and the income?', page: 3, pages: [5, 3] },
      { question: 'about 10', page: 3, check: 'how much?' },
    ]);
    expect(pagesOf(c)).toEqual([3, 5]);
    expect(titleInputOf(c, label)).toEqual({ questions: ['why is it 50?', 'and the income?'], sections: ['The village economy', 'Income'] });
  });

  it('opens to its questions and asides; nothing to open with one question and no aside', () => {
    expect(linesOf(conv([{ question: 'q1', page: 1 }]))).toEqual([]);
    expect(linesOf(conv([{ question: 'q1', page: 1, asides: ['a1'] }, { question: 'f1', page: 1 }]))).toEqual([
      { text: 'q1', aside: false }, { text: 'a1', aside: true }, { text: 'f1', aside: false },
    ]);
  });

  it('each conversation has its own history and memory', () => {
    const a = newConversation(), b = newConversation();
    a.history.push('q', ['an', 'answer.'], 1);
    expect(a.history.last()).toHaveLength(1);
    expect(b.history.last()).toHaveLength(0);
    expect(a.memory).not.toBe(b.memory);
    expect(a.id).not.toBe(b.id);
  });
});

describe('page marks', () => {
  const SVG = 'http://www.w3.org/2000/svg';
  function pages(n: number) {
    const ls = Array.from({ length: n }, () => {
      const svgH = document.createElementNS(SVG, 'svg'), svgA = document.createElementNS(SVG, 'svg');
      const highlight = svgH.appendChild(document.createElementNS(SVG, 'g')) as SVGGElement;
      const agent = svgA.appendChild(document.createElementNS(SVG, 'g')) as SVGGElement;
      return { highlight, agent };
    });
    return { numPages: () => n, layers: (p: number) => ls[p - 1] ?? null, ls };
  }
  const mark = (g: SVGGElement, id: string) => { const r = document.createElementNS(SVG, 'rect'); r.id = id; g.appendChild(r); return r; };

  it('takes every mark and past mark off the pages, then puts the same nodes back where they were', () => {
    const v = pages(3);
    const h = mark(v.ls[1].highlight, 'h'), a = mark(v.ls[1].agent, 'a');
    const past = document.createElementNS(SVG, 'g');
    past.setAttribute('class', 'petu-past');
    v.ls[2].agent.parentNode!.insertBefore(past, v.ls[2].agent);
    mark(past as SVGGElement, 'old');
    v.ls[1].agent.style.opacity = '0';
    const snap = takeMarks(v);
    expect([...snap.keys()]).toEqual([2, 3]);
    expect(v.ls[1].highlight.childNodes).toHaveLength(0);
    expect(v.ls[1].agent.childNodes).toHaveLength(0);
    expect(past.isConnected || past.parentNode).toBeFalsy();
    expect(v.ls[1].agent.style.opacity).toBe('');
    putMarks(v, snap);
    expect(v.ls[1].highlight.firstChild).toBe(h);
    expect(v.ls[1].agent.firstChild).toBe(a);
    expect(v.ls[2].agent.previousElementSibling).toBe(past);
  });

  it('nothing on the pages: an empty snapshot', () => {
    expect(takeMarks(pages(4)).size).toBe(0);
  });
});
