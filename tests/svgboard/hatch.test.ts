// @vitest-environment jsdom
// The board's hatched washes (sanitize.ts marks a shaded region data-wash; render.ts paints it with
// the board's hatch pattern). A board is also serialised on its own (src/report/screenshot.ts svgUrl:
// report and bug screenshots), so the pattern a wash points at has to travel inside the board's svg.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { drawGroup, mountBoard, prepareGroup } from '../../src/svgboard/render';
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

afterEach(() => { document.head.innerHTML = ''; document.body.innerHTML = ''; vi.unstubAllGlobals(); });

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

describe('which circles are points with a paper ring (sanitize.ts data-dot)', () => {
  const dot = (src: string) => clean(`<g>${src}</g>`).querySelector('circle')!.hasAttribute('data-dot');
  it('a small solid dot with no outline of its own is', () => {
    expect(dot('<circle cx="50" cy="50" r="4" fill="#111"/>')).toBe(true);
    expect(dot('<circle cx="50" cy="50" r="5" fill="#7c3aed" stroke="none"/>')).toBe(true);
  });
  it('a hollow point keeps its own outline (open vs closed endpoints)', () => {
    expect(dot('<circle cx="50" cy="50" r="5" fill="#eee" stroke="#333" stroke-width="2"/>')).toBe(false);
    expect(dot('<circle cx="50" cy="50" r="5" fill="#111" stroke="#333"/>')).toBe(false);
  });
  it('a pale dot is not (a paper ring would leave it invisible)', () => {
    expect(dot('<circle cx="50" cy="50" r="5" fill="#c7d2fe"/>')).toBe(false);
    expect(dot('<circle cx="50" cy="50" r="5" fill="#111" fill-opacity="0.3"/>')).toBe(false);
  });
});

describe('each board carries its own hatch (render.ts addHatch)', () => {
  const live = (b: ReturnType<typeof board>) => b.root.querySelector(`pattern[id="petu-hatch-live-${b.ns}"] line`)!.getAttribute('stroke');
  it('two boards: a pattern pair each, in its own <defs>, the live one in its accent', () => {
    const a = board('b1', '#111111'), z = board('b2', '#222222');
    expect(a.root.querySelectorAll('defs > pattern').length).toBe(2);
    expect(z.root.querySelector('pattern[id="petu-hatch-b2"]')).not.toBeNull();
    expect(a.root.querySelector('pattern[id="petu-hatch-b2"]')).toBeNull();
    expect([live(a), live(z)]).toEqual(['#111111', '#222222']);
    expect(a.root.style.getPropertyValue('--board-hatch-live')).toBe('url(#petu-hatch-live-b1)');
  });
  it('extending a board adds no second pair', () => {
    const b = board('b1');
    mountBoard(b.root.parentNode as SVGGElement, { w: 1000, h: 900, extend: true }, 'b1', '#7c3aed');
    expect(b.root.querySelectorAll('pattern').length).toBe(2);
  });
  it('a group drawn in another colour retints the live hatch', async () => {
    const b = board('b1', '#7c3aed');
    const s = prepareGroup(b, REGION, 16, 1);
    if (typeof s === 'string') throw new Error(s);
    await drawGroup(b, s.el, 'dwl', { signal: AbortSignal.abort(), color: '#0a84ff' });
    expect(live(b)).toBe('#0a84ff');
  });
});

describe('a wash traced on (drawGroup)', () => {
  // jsdom has no layout: give the region a stroke and a length so it takes the trace path.
  const traced = () => {
    vi.stubGlobal('requestAnimationFrame', (f: FrameRequestCallback) => setTimeout(() => f(performance.now()), 0));
    vi.stubGlobal('matchMedia', () => ({ matches: false }));
    const b = board();
    const st = document.createElement('style');
    st.textContent = 'polygon { stroke: #000; stroke-width: 1px; }';
    document.head.appendChild(st);
    const s = prepareGroup(b, REGION, 16, 1);
    if (typeof s === 'string') throw new Error(s);
    const el = s.el.querySelector('[data-wash]') as SVGPolygonElement;
    Object.assign(el, { getTotalLength: () => 40, getPointAtLength: () => ({ x: 0, y: 0 }) });
    return { b, g: s.el, el };
  };
  it('hides its fill while traced, then hands it back to the board CSS (no inline fill-opacity left)', async () => {
    const { b, g, el } = traced();
    const seen: string[] = [];
    await drawGroup(b, g, 'dwl', { signal: new AbortController().signal, color: '#7c3aed', speed: 0.05, onStep: (e) => seen.push((e as SVGElement).style.fillOpacity) });
    expect(seen).toEqual(['0']);
    expect(el.style.fillOpacity).toBe('');
    expect(el.getAttribute('fill')).toBe('url(#petu-hatch-b1)');
  });
  it('a stop mid-trace lands it the same way', async () => {
    const { b, g, el } = traced();
    const stop = new AbortController();
    await drawGroup(b, g, 'dwl', { signal: new AbortController().signal, stop: stop.signal, color: '#7c3aed', speed: 0.05, onStep: () => stop.abort() });
    expect(el.style.fillOpacity).toBe('');
    expect(el.style.strokeDashoffset).toBe('');
  });
});
