// tests/agent/askedPage.test.ts — the one page a question is about (C5, src/agent/moment.ts): decided
// when it is sent, a check reply on the check's own page, a selection's page over the page in view.
import { describe, it, expect } from 'vitest';
import { askedPage, checkPageOf, type Pointed } from '../../src/agent/moment';

const sel = (page: number): Pointed => ({ kind: 'selection', page, text: 'the rate doubles' });

describe('askedPage', () => {
  it('a selection or circle on a page wins over everything', () => {
    expect(askedPage({ point: sel(13), check: 12, mark: 4, visible: 6 })).toBe(13);
  });
  it('a check reply is asked on the page the check was offered on, not the page in view', () => {
    expect(askedPage({ check: 12, visible: 6 })).toBe(12);
    expect(askedPage({ check: 12, mark: 4, visible: 6 })).toBe(12);
  });
  it('then the tutor\'s focus page (the indicator\'s), over the most visible page; anything the student named wins over it', () => {
    expect(askedPage({ focus: 7, visible: 8 })).toBe(7);
    expect(askedPage({ focus: null, visible: 8 })).toBe(8);
    expect(askedPage({ point: sel(3), check: 12, mark: 4, focus: 7, visible: 8 })).toBe(3);
    expect(askedPage({ check: 12, focus: 7, visible: 8 })).toBe(12);
    expect(askedPage({ mark: 4, focus: 7, visible: 8 })).toBe(4);
  });
  it('then the page of the marks taken with the question; then the most visible page', () => {
    expect(askedPage({ mark: 4, visible: 6 })).toBe(4);
    expect(askedPage({ point: { kind: 'selection', board: true, text: 'x' }, visible: 6 })).toBe(6);
    expect(askedPage({ point: null, check: null, mark: undefined, visible: 6 })).toBe(6);
  });
});

describe('checkPageOf: where the check was offered', () => {
  it('{{scroll p=6}} then {{highlight p=12}}: the check is about p12 (recorded a28)', () => {
    const script = 'First, {{scroll p=6}} the setup here. Now {{highlight p=12 "the rate"}} the rate doubles. <check>What if it halves?</check>';
    expect(checkPageOf(script, 3)).toBe(12);
  });
  it('board and svg tags do not move it; no page tag: the asked page', () => {
    expect(checkPageOf('{{scroll p=5}} a {{dot on=s1 x=1 y=2}} {{svg <g id="a"><text x="1" y="2">p=9</text></g>}} b', 2)).toBe(5);
    expect(checkPageOf('Just words.', 7)).toBe(7);
  });
});
