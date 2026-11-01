// @vitest-environment jsdom
// Grounded (C1, 2026-10-31): on a board with a data model, points and numbers come from the engine. A hand
// dot next to a curve or crossing is placed on it (data.ts snapMarkers, the same in the gate and on the
// board); one between two candidates, and a typed number beside a readout it contradicts, fail the group;
// other hand-made dots and numbers are noted.
import { describe, expect, it } from 'vitest';
import { checkGroups, newBoardState, typedNumbers } from '../../src/svgboard/check';
import { newScope, point, resolveData } from '../../src/svgboard/data';
import { parseGroup } from '../../src/svgboard/sanitize';
import { mountBoard, prepareGroup } from '../../src/svgboard/render';

// Demand d = 1200 − 5x, supply s = 400 + 5x on a 0–140 × 400–1300 frame: they cross at (80, 800).
const FRAME = '<g data-axes="ax" data-x="0,140" data-y="400,1300" data-box="100,60,420,360" data-frame=""/><path id="d" data-fn="1200-5*x" data-axes="ax" stroke="#333" fill="none"/><path id="s" data-fn="400+5*x" data-axes="ax" stroke="#333" fill="none"/>';
const mk = (inner: string, attrs = 'data-const="k=1"') => `<g id="mk" ${attrs}>${FRAME}${inner}</g>`;
const check = (src: string) => checkGroups([src], newBoardState(560, 600), 16, newScope());
const sc0 = () => { const sc = newScope(); resolveData(parseGroup(mk('')) as Element, sc); return sc; };

describe('a hand-placed dot on a plot', () => {
  it('next to the curves\' crossing: placed at cross(d,s), noted', () => {
    const E = point('cross(d,s)', sc0());
    const g = parseGroup(mk(`<circle cx="${E.x + 9}" cy="${E.y - 7}" r="5" fill="#222"/>`)) as Element;
    resolveData(g, newScope());
    const c = g.querySelector('circle')!;
    expect(c.getAttribute('data-at')).toBe('cross(d,s)');
    expect(+c.getAttribute('cx')!).toBeCloseTo(E.x, 1);
    expect(+c.getAttribute('cy')!).toBeCloseTo(E.y, 1);
    const r = check(mk(`<circle cx="${E.x + 9}" cy="${E.y - 7}" r="5" fill="#222"/>`));
    expect(r.flags).toEqual([]);
    expect(r.notes.join()).toMatch(/hand-placed dot was put on cross\(d,s\)/);
  });

  it('next to one curve, away from the crossing: placed on that curve at its x', () => {
    const P = point('at(d, x=30)', sc0());
    const g = parseGroup(mk(`<circle cx="${P.x}" cy="${P.y + 6}" r="4"/>`)) as Element;
    resolveData(g, newScope());
    const c = g.querySelector('circle')!;
    expect(c.getAttribute('data-at')).toMatch(/^at\(d, x=/);
    expect(+c.getAttribute('cy')!).toBeCloseTo(point(c.getAttribute('data-at')!, (() => { const sc = newScope(); resolveData(parseGroup(mk('')) as Element, sc); return sc; })()).y, 1);
  });

  it('between two candidates: never guessed, the group fails', () => {
    // Two curves 6 units apart near x=30: the dot between them could be on either.
    const src = `<g id="two" data-const="k=1">${FRAME}<path id="d2" data-fn="1190-5*x" data-axes="ax" fill="none" stroke="#333"/><circle cx="${point('at(d, x=30)', sc0()).x}" cy="${point('at(d, x=30)', sc0()).y + 3}" r="4"/></g>`;
    const r = check(src);
    expect(r.flags.map((f) => f.detail).join()).toMatch(/sits between at\(d, x=.*\| at\(d2, x=/);
  });

  it('far from every curve, or in a schematic part: left as drawn (a note, or nothing)', () => {
    const far = check(mk('<circle cx="300" cy="400" r="4"/>'));
    expect(far.flags).toEqual([]);
    expect(far.notes.join()).toMatch(/dot at \(300, 400\) is placed by hand/);
    const E = point('cross(d,s)', sc0());
    const sch = mk(`<g data-schematic=""><circle cx="${E.x + 4}" cy="${E.y}" r="4"/></g>`);
    const g = parseGroup(sch) as Element;
    resolveData(g, newScope());
    expect(g.querySelector('circle')!.hasAttribute('data-at')).toBe(false);
    expect(check(sch).notes.join()).not.toMatch(/dot/);
  });

  it('the board places it the same way the gate checks it', () => {
    const layer = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    document.body.appendChild(document.createElementNS('http://www.w3.org/2000/svg', 'svg')).appendChild(layer);
    const b = mountBoard(layer, { w: 560, h: 600 }, 'b1', '#7c3aed').board;
    const E = point('cross(d,s)', sc0());
    const s = prepareGroup(b, mk(`<circle cx="${E.x - 8}" cy="${E.y + 8}" r="5" fill="#222"/>`), 16, 1);
    if (typeof s === 'string') throw new Error(s);
    const c = s.el.querySelector('circle')!;
    expect(c.getAttribute('data-at')).toBe('cross(d,s)');
    expect(+c.getAttribute('cx')!).toBeCloseTo(E.x, 1);
  });
});

describe('typed numbers on a board with a data model', () => {
  it('a typed number beside a readout it contradicts fails; one that agrees, or far from it, notes', () => {
    const r = check(mk('<text x="300" y="40" font-size="16" data-val="xof(cross(d,s))-40" data-fmt="0">shortage {} flats</text><text x="300" y="62" font-size="16">about 37 flats</text>'));
    expect(r.flags.map((f) => f.detail)).toEqual(['group mk: "37" is typed beside the readout 40 (shortage) it contradicts: write it as data-val']);
    const ok = check(mk('<text x="300" y="40" font-size="16" data-val="xof(cross(d,s))-40" data-fmt="0">shortage {} flats</text><text x="300" y="62" font-size="16">40 flats</text><text x="120" y="500" font-size="16">37 units away</text>'));
    expect(ok.flags).toEqual([]);
    expect(ok.notes.filter((n) => /typed by hand/.test(n))).toHaveLength(2);
  });

  it('a readout\'s own template counts: "crossing {} s, not 160 s" beside 150 contradicts', () => {
    const r = check('<g id="t" data-const="W=300 u=2"><text x="20" y="40" font-size="16" data-val="W/u" data-fmt="0">crossing {} s, not 160 s</text></g>');
    expect(r.flags.map((f) => f.detail).join()).toMatch(/"160" is typed beside the readout 150/);
  });

  it('exempt: names (E1, x2), counts ≤ 12, references, years, the engine\'s ticks, schematic parts, a board with no data', () => {
    const el = parseGroup('<text>E1 and x2, ×2, step 14, in 2024, 3 dots</text>') as Element;
    expect(typedNumbers(el)).toEqual([]);
    expect(typedNumbers(parseGroup('<text>300 m, 2.5 m/s, 37°</text>') as Element).map((n) => n.v)).toEqual([300, 2.5, 37]);
    const ticks = check(mk('', 'data-const="k=1"').replace('data-frame=""', 'data-frame="" data-ticks-x="0,40,80,120"'));
    expect(ticks.notes.filter((n) => /typed/.test(n))).toEqual([]);
    expect(check(mk('<g data-schematic=""><text x="300" y="40" font-size="16">45 min</text></g>')).notes.filter((n) => /typed/.test(n))).toEqual([]);
    expect(check('<g id="plain"><text x="20" y="40" font-size="16">45 min</text><circle cx="50" cy="50" r="4"/></g>').notes.filter((n) => /grounded/.test(n))).toEqual([]);
  });
});

describe('a snap is decided once', () => {
  it('a dot the first resolve left alone stays put when a tween later moves a curve under it', () => {
    // s = 400 + m*x with m=5; the dot sits on where s would be with m=7, out of reach at first.
    const src = `<g id="mv" data-const="m=5">${FRAME.replace('400+5*x', '400+m*x')}<circle cx="0" cy="0" r="4"/></g>`;
    const sc = newScope();
    resolveData(parseGroup(src.replace('<circle cx="0" cy="0" r="4"/>', '')) as Element, sc);
    const Q = point('pt(ax, 30, 610)', sc); // on s once m = 7
    const g = parseGroup(src.replace('cx="0" cy="0"', `cx="${Q.x}" cy="${Q.y}"`)) as Element;
    const sc2 = newScope();
    resolveData(g, sc2);
    const c = g.querySelector('circle')!;
    expect(c.hasAttribute('data-at')).toBe(false);
    sc2.consts.m = 7;
    resolveData(g, sc2);
    expect(c.hasAttribute('data-at')).toBe(false);
    expect(+c.getAttribute('cx')!).toBeCloseTo(Q.x, 5);
  });
});
