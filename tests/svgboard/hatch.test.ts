// @vitest-environment jsdom
// The board's hatched washes (sanitize.ts marks a shaded region data-wash; render.ts paints it with
// the board's hatch pattern). A board is also serialised on its own (src/report/screenshot.ts svgUrl:
// report and bug screenshots), so the pattern a wash points at has to travel inside the board's svg.
import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { mountBoard, prepareGroup } from '../../src/svgboard/render';
import { svgUrl } from '../../src/report/screenshot';
import { sanitizeGroup } from '../../src/svgboard/sanitize';

const SVG = 'http://www.w3.org/2000/svg';
// The board CSS's own wash rules (desk.css), as the page applies them.
const WASH_CSS = readFileSync('src/desk/desk.css', 'utf8').split('\n').filter((l) => l.includes('[data-wash]') && l.includes('{')).join('\n');

function board(ns = 'b1', accent = '#7c3aed') {
  const style = document.createElement('style');
  style.textContent = WASH_CSS;
  document.head.appendChild(style);
  const layer = document.createElementNS(SVG, 'g');
  document.body.appendChild(document.createElementNS(SVG, 'svg')).appendChild(layer);
  return mountBoard(layer, { w: 1000, h: 700 }, ns, accent).board;
}
const REGION = '<g id="dwl"><polygon points="100,100 400,100 400,300" fill="#7c3aed" fill-opacity="0.2"/></g>';

afterEach(() => { document.head.innerHTML = ''; document.body.innerHTML = ''; });

describe('a hatched wash, serialised with its board', () => {
  it('carries the pattern it is filled with (a report screenshot draws the hatch, not nothing)', () => {
    const b = board();
    const s = prepareGroup(b, REGION, 16, 1);
    if (typeof s === 'string') throw new Error(s);
    b.root.appendChild(s.el);
    expect(s.el.querySelector('[data-wash]')).not.toBeNull();
    const out = decodeURIComponent(svgUrl(b.root).replace(/^data:image\/svg\+xml;charset=utf-8,/, ''));
    const refs = [...out.matchAll(/url\((?:&quot;|["'])?[^#)]*#([\w-]+)/g)].map((m) => m[1]);
    expect(refs.some((r) => r.startsWith('petu-hatch'))).toBe(true);
    for (const r of refs) expect(out).toContain(`id="${r}"`);
  });
});

const clean = (src: string) => {
  const r = sanitizeGroup(src, { ns: 'b', palette: { accent: '#7c3aed', hue: null }, minFont: 13, w: 1000, h: 700, ids: new Map(), doc: document });
  if (typeof r === 'string') throw new Error(r);
  return r.el;
};
const washed = (src: string, sel: string) => clean(src).querySelector(sel)!.hasAttribute('data-wash');

describe('which fills are hatched (sanitize.ts data-wash)', () => {
  it('a shaded region is: a polygon, a large circle, a rect the model drew translucent', () => {
    expect(washed(REGION, 'polygon')).toBe(true);
    expect(washed('<g><circle cx="300" cy="300" r="120" fill="#60a5fa"/></g>', 'circle')).toBe(true);
    expect(washed('<g><rect x="100" y="100" width="300" height="200" fill="#7c3aed" fill-opacity="0.25"/></g>', 'rect')).toBe(true);
    expect(washed('<g><rect x="100" y="100" width="300" height="200" fill="rgba(124,58,237,0.2)"/></g>', 'rect')).toBe(true);
  });
  it('a callout card behind its text is not (hatch lines would run under the label)', () => {
    expect(washed('<g id="c"><rect x="680" y="70" width="290" height="190" fill="#e0e7ff" stroke="#6366f1"/><text x="700" y="108">at the cap</text></g>', 'rect')).toBe(false);
  });
  it('a bar is not (a solid mark, softened only)', () => {
    expect(washed('<g><rect x="100" y="100" width="80" height="300" fill="#7c3aed"/></g>', 'rect')).toBe(false);
  });
});
