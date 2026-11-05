// @vitest-environment jsdom
// Grounded (C1, 2026-10-31): on a board with a data model, points and numbers come from the engine. A hand
// dot next to a crossing, on neither curve, or labelled as that crossing or a curve, is placed on it
// (data.ts snapMarkers, the same in the gate and on the board); one between two crossings, one labelled E
// at none, and a typed number beside a readout it contradicts, fail the group; other hand-made dots
// (a curve's own point, a data point beside a line) and numbers are noted.
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
  it('next to the curves\' crossing and on neither curve: placed at cross(d,s), noted', () => {
    // 8 px right of E sits 4.4 px off both curves (a dot on one is that curve's point: see below).
    const E = point('cross(d,s)', sc0());
    const g = parseGroup(mk(`<circle cx="${E.x + 8}" cy="${E.y}" r="5" fill="#222"/>`)) as Element;
    resolveData(g, newScope());
    const c = g.querySelector('circle')!;
    expect(c.getAttribute('data-at')).toBe('cross(d,s)');
    expect(+c.getAttribute('cx')!).toBeCloseTo(E.x, 1);
    expect(+c.getAttribute('cy')!).toBeCloseTo(E.y, 1);
    const r = check(mk(`<circle cx="${E.x + 8}" cy="${E.y}" r="5" fill="#222"/>`));
    expect(r.flags).toEqual([]);
    expect(r.notes.join()).toMatch(/hand-placed dot was put on cross\(d,s\)/);
  });

  it('next to one curve, away from the crossing, unlabelled: left where it is (a data point may sit off its line), noted', () => {
    const P = point('at(d, x=30)', sc0());
    const src = mk(`<circle cx="${P.x}" cy="${P.y + 6}" r="4"/>`);
    const g = parseGroup(src) as Element;
    resolveData(g, newScope());
    const c = g.querySelector('circle')!;
    expect(c.hasAttribute('data-at')).toBe(false);
    expect(+c.getAttribute('cy')!).toBe(P.y + 6);
    expect(check(src)).toMatchObject({ flags: [] });
    expect(check(src).notes.join()).toMatch(/sits by at\(d, x=/);
  });

  it('between two crossings: never guessed, the group fails', () => {
    // d2 = d − 10 crosses s 1 unit left of E: a dot 9 px above E, on no curve, is in reach of both.
    const E = point('cross(d,s)', sc0());
    const src = `<g id="two" data-const="k=1">${FRAME}<path id="d2" data-fn="1190-5*x" data-axes="ax" fill="none" stroke="#333"/><circle cx="${E.x}" cy="${E.y - 9}" r="4"/></g>`;
    const r = check(src);
    expect(r.flags.map((f) => f.detail).join()).toMatch(/sits between cross\(d,s\) \| cross\(s,d2\)/);
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
    const s = prepareGroup(b, mk(`<circle cx="${E.x - 8}" cy="${E.y}" r="5" fill="#222"/>`), 16, 1);
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

  it('a readout\'s own template counts: "crossing {} s (160 s)" beside 150 contradicts', () => {
    const r = check('<g id="t" data-const="W=300 u=2"><text x="20" y="40" font-size="16" data-val="W/u" data-fmt="0">crossing {} s (160 s)</text></g>');
    expect(r.flags.map((f) => f.detail).join()).toMatch(/"160" is typed beside the readout 150/);
  });

  it('a contrast label (was, before, not, old) beside a readout is a note, not a contradiction', () => {
    for (const t of ['was 140 s', 'before: 140 s', 'not 140 s', 'old 140 s']) {
      const r = check(`<g id="c" data-const="W=300 v=2.5"><text x="600" y="100" font-size="16" data-val="300/(v-0.5)" data-fmt="0">now {} s</text><text x="600" y="130" font-size="16">${t}</text></g>`);
      expect(r.flags, t).toEqual([]);
      expect(r.notes.join(), t).toMatch(/"140" is typed by hand/);
    }
    const r = check('<g id="t" data-const="W=300 u=2"><text x="20" y="40" font-size="16" data-val="W/u" data-fmt="0">crossing {} s, not 160 s</text></g>');
    expect(r.flags).toEqual([]);
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

// Review (numbers-agree, 2026-10-31): a snap must not erase what the dot means. A dot already on a curve is a
// point of that curve (a ceiling's Qd and Qs, 14 px either side of E), never the crossing; dots beside a line
// are data with residuals, never moved onto it; a dot labelled E off every crossing is wrong, not re-homed.
describe('a snap keeps a deliberate point where it was drawn', () => {
  it('the shortage at a price ceiling: Qd on d and Qs on s, near E, keep their own places', () => {
    const sc = sc0();
    const qd = point('at(d, x=84)', sc), qs = point('at(s, x=76)', sc);
    const g = parseGroup(mk(`<circle cx="${qd.x}" cy="${qd.y}" r="5"/><circle cx="${qs.x}" cy="${qs.y}" r="5"/>`)) as Element;
    resolveData(g, newScope());
    const circles = Array.from(g.querySelectorAll('circle'));
    expect(circles.map((c) => c.getAttribute('data-at'))).not.toEqual(['cross(d,s)', 'cross(d,s)']);
    expect(circles.map((c) => [+c.getAttribute('cx')!, +c.getAttribute('cy')!])).toEqual([[qd.x, qd.y], [qs.x, qs.y]]);
  });

  it('data points scattered ±10 px about a line keep their residuals (a note, not a move)', () => {
    const sc = sc0();
    const pts = [20, 40, 60].map((x, i) => { const p = point(`at(s, x=${x})`, sc); return { x: p.x, y: p.y + (i % 2 ? -10 : 10) }; });
    const src = mk(pts.map((p) => `<circle cx="${p.x}" cy="${p.y}" r="4"/>`).join(''));
    const g = parseGroup(src) as Element;
    resolveData(g, newScope());
    expect(Array.from(g.querySelectorAll('circle')).map((c) => +c.getAttribute('cy')!)).toEqual(pts.map((p) => p.y));
    const r = check(src);
    expect(r.flags).toEqual([]);
    expect(r.notes.join()).toMatch(/sits by at\(s, x=.*not on it/);
  });

  it('a dot labelled E off every crossing fails; it is not snapped onto the curve it happens to sit by', () => {
    const E = point('cross(d,s)', sc0());
    const src = mk(`<circle cx="${E.x + 30}" cy="${E.y + 20}" r="5"/><text x="${E.x + 38}" y="${E.y + 12}" font-size="16">E</text>`);
    const g = parseGroup(src) as Element;
    resolveData(g, newScope());
    expect(g.querySelector('circle')!.hasAttribute('data-at')).toBe(false);
    expect(check(src).flags.map((f) => f.detail).join()).toMatch(/dot labelled E .* is at no crossing/);
  });

  it('a dot labelled E within reach of the crossing is placed there, even beside one curve', () => {
    // (E.x+9, E.y−7) sits within a pixel of s: unlabelled it stays on s; labelled E it is the crossing.
    const E = point('cross(d,s)', sc0());
    const g = parseGroup(mk(`<circle cx="${E.x + 9}" cy="${E.y - 7}" r="5"/><text x="${E.x + 18}" y="${E.y - 14}" font-size="16">E</text>`)) as Element;
    resolveData(g, newScope());
    expect(g.querySelector('circle')!.getAttribute('data-at')).toBe('cross(d,s)');
    const u = parseGroup(mk(`<circle cx="${E.x + 9}" cy="${E.y - 7}" r="5"/>`)) as Element;
    resolveData(u, newScope());
    expect(u.querySelector('circle')!.hasAttribute('data-at')).toBe(false);
  });

  it('a dot labelled with a curve\'s name beside it is placed on that curve', () => {
    const P = point('at(d, x=30)', sc0());
    const g = parseGroup(mk(`<circle cx="${P.x}" cy="${P.y + 6}" r="4"/><text x="${P.x + 8}" y="${P.y - 6}" font-size="16">d</text>`)) as Element;
    resolveData(g, newScope());
    expect(g.querySelector('circle')!.getAttribute('data-at')).toMatch(/^at\(d, x=/);
  });
});

describe('a number a calc program carries is grounded (teaching engine §0, not strict)', () => {
  it('a worked line typing its inputs passes; a number no program carries is still noted', () => {
    const sc = newScope();
    sc.calcs = new Map([['avg', { r: [4, 4, 22], out: [10] }]]);
    const r = checkGroups(['<g id="w" data-const="k=0"><text x="20" y="40" font-size="18" data-val="avg.out[0]">(4 + 4 + 22) / 3 = {}</text><text x="20" y="80" font-size="18">about 37 mm</text></g>'], newBoardState(560, 200), 16, sc);
    expect(r.notes.filter((n) => /"22" is typed/.test(n))).toEqual([]);
    expect(r.notes.join()).toMatch(/"37" is typed by hand/);
  });
});
