// A board driven by a step constant (src/demo/teach.ts add-proc): what data-set computes is the engine's.
import { describe, expect, it } from 'vitest';
import { mountBoard, prepareGroup } from '../../src/svgboard/render';

describe('a step-driven board', () => {
  it('keeps a computed opacity and size: a reveal at 0 is "not yet", a moving frame is no card', () => {
    const layer = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    document.body.appendChild(document.createElementNS('http://www.w3.org/2000/svg', 'svg')).appendChild(layer);
    const b = mountBoard(layer, { w: 560, h: 320 }, 'b1', '#7c3aed').board;
    b.scope.consts.s = 0;
    const s = prepareGroup(b, `<g id="sum">
      <rect y="96" width="52" height="186" fill="none" stroke="#7c3aed" data-set="x: 324 - 60*(s - 1); opacity: min(1, max(0, s))"/>
      <text x="420" y="160" font-size="22" data-set="opacity: max(0, 1 - abs(s - 1))">8 + 6 = 14</text>
      <text x="420" y="160" font-size="22" data-set="opacity: max(0, 1 - abs(s - 2))">7 + 5 + 1 = 13</text>
      <text x="350" y="266" font-size="40" data-set="opacity: min(1, max(0, s))">4</text>
    </g>`, 16, 1);
    if (typeof s === 'string') throw new Error(s);
    const texts = Array.from(s.el.querySelectorAll('text'));
    expect(texts.map((t) => t.getAttribute('opacity'))).toEqual(['0', '0', '0']);
    const r = s.el.querySelector('rect')!;
    expect(r.getAttribute('width')).toBe('52');
    expect(r.getAttribute('height')).toBe('186');
  });
});
