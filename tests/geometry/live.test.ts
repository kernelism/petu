// tests/geometry/live.test.ts — live geometry: figures whose numbers are formulas over {{const}}s.
import { describe, it, expect } from 'vitest';
import { Figures } from '../../src/geometry/resolve';
import { parseTag } from '../../src/script/parseTag';
import type { RawAction } from '../../src/script/types';
import { evalConst } from '../../src/geometry/live';

const T = (s: string) => parseTag(s) as RawAction;
const none = { mark: () => undefined };
type P = { x: number; y: number };

describe('live geometry grammar', () => {
  it('reads coordinates and along() t as formulas over constants', () => {
    const a = T('let on=k O=0,0 M=-300,0 B=300,0 P=along(M,B,s) S=R*cos(th),R*sin(th) F=foot(S,M,B)') as Extract<RawAction, { kind: 'let' }>;
    const d = Object.fromEntries(a.defs);
    expect(d.S).toEqual({ fn: 'xy', ex: 'R*cos(th)', ey: 'R*sin(th)' });
    expect(d.P).toMatchObject({ fn: 'along', tSrc: 's' });
    expect(d.F).toMatchObject({ fn: 'foot' });
  });
  it('reads r=, len= and value= as live numbers; trace on a point; a tween', () => {
    expect(T('circle on=k at=O r=R')).toMatchObject({ kind: 'circle', exprs: { r: 'R' } });
    expect(T('line on=k from=O through=S len=k2')).toMatchObject({ exprs: { len: 'k2' } });
    expect(T('write on=k at=40,40 "spin:" value=omega fmt=1 unit=rad/s')).toMatchObject({ kind: 'write', text: 'spin:', value: 'omega', fmt: 1, unit: 'rad/s' });
    expect(T('point on=k at=S "satellite" trace')).toMatchObject({ kind: 'point', trace: true });
    expect(T('tween th=2*pi s=1 dur=6 ease=linear repeat=2 yoyo')).toEqual({ kind: 'tween', ref: 'th', sets: [['th', '2*pi'], ['s', '1']], dur: 6, ease: 'linear', repeat: 2, yoyo: true });
    expect(T('tween dur=3')).toBeNull();
    expect(T('tween th=1 ease=bounce')).toBeNull();
    // Literal geometry is untouched.
    expect(T('circle on=k at=10,20 r=30')).toEqual({ kind: 'circle', region: 'k', at: { x: 10, y: 20 }, rx: 30, ry: 30 });
  });
});

describe('re-resolution when a constant changes', () => {
  const consts: Record<string, number> = { r: 100, th: 0, s: 0 };
  const f = new Figures(none, () => consts);
  const script = [
    T('sketch id=k fit'),
    T('let on=k O=0,0 M=-100,0 B=100,0 P=along(M,B,s) S=R*cos(th),R*sin(th) F=foot(S,M,B)'),
    T('circle on=k at=O r=R'),
    T('point on=k at=S "S" trace'),
    T('point on=k at=F "ball"'),
    T('line on=k from=S to=F dash'),
    T('point on=k at=M "M"'),
    T('write on=k at=O "x =" value=R*cos(th) fmt=0'),
  ];
  script.forEach((a) => f.note(a));
  const at = (i: number) => (f.resolve(script[i]) as { at: P }).at;

  it('tracks the constants every time it resolves (names are not frozen)', () => {
    const S0 = at(3), F0 = at(4);
    expect(F0.x).toBeCloseTo(S0.x, 6); // the ball sits under the satellite
    consts.th = Math.PI / 3;
    const S1 = at(3), F1 = at(4);
    expect(S1.x).toBeLessThan(S0.x);
    expect(F1.x).toBeCloseTo(S1.x, 6); // …and still does: foot() re-resolved through the live name
    const line = f.resolve(script[5]) as { from: P; to: P };
    expect(line.from).toEqual(S1); expect(line.to).toEqual(F1);
    consts.th = 0;
  });
  it('keeps one frozen fit (uniform scale): the circle radius and the points agree', () => {
    const c = f.resolve(script[2]) as { at: P; rx: number; ry: number };
    const S = at(3);
    expect(Math.hypot(S.x - c.at.x, S.y - c.at.y)).toBeCloseTo(c.rx, 6);
    consts.r = 50;
    const c2 = f.resolve(script[2]) as { rx: number };
    expect(c2.rx).toBeCloseTo(c.rx / 2, 6);
    consts.r = 100;
  });
  it('writes a live readout into the text', () => {
    expect((f.resolve(script[7]) as { text: string }).text).toBe('x = 100');
    consts.th = Math.PI / 2;
    expect((f.resolve(script[7]) as { text: string }).text).toBe('x = 0');
    consts.th = 0;
  });
  it('knows which actions are live', () => {
    expect(script.map((a) => f.isLive(a))).toEqual([false, false, true, true, true, true, false, true]);
  });
  it('skips (never guesses) on an unknown constant', () => {
    const g = new Figures(none, () => ({}));
    const a = T('point on=q at=k*2,0');
    g.note(a);
    expect(g.resolve(a)).toBe('unknown constant k');
    expect(evalConst('zz+1', { a: 1 })).toBe('unknown constant zz');
  });
});

import { KitStore } from '../../src/desk/kit/kit';
import { GateState } from '../../src/gate/engine';
import { rederive } from '../../src/desk/kit/compute';

describe('formula constants follow the constants they read', () => {
  it('rederives in definition order, transitively (skater: r → I → w)', () => {
    const k = new KitStore();
    k.defineConsts([['t', '0'], ['L', '10'], ['r', '1.4-0.9*min(t/6,1)'], ['I', '3+4*r^2'], ['w', 'L/I']]);
    expect(k.consts.w).toBeCloseTo(10 / (3 + 4 * 1.96));
    let calls = 0; k.onConsts(() => calls++);
    k.setConst('t', 6); k.constsChanged();
    expect(k.consts.r).toBeCloseTo(0.5);
    expect(k.consts.w).toBeCloseTo(10 / 4);
    expect(calls).toBe(1);
    // Set directly, a formula constant becomes an input.
    k.setConst('r', 1); k.setConst('t', 0);
    expect(k.consts.r).toBe(1);
  });
  it('rederive leaves plain numbers and unrelated formulas alone', () => {
    const c: Record<string, number> = { a: 1, b: 2, s: 3, u: 9 };
    rederive(c, [['s', 'a+b'], ['u', 'b*2']], 'a');
    expect(c).toEqual({ a: 1, b: 2, s: 3, u: 9 }); // s recomputed (1+2=3), u untouched
    c.a = 5; rederive(c, [['s', 'a+b'], ['u', 'b*2']], 'a');
    expect(c.s).toBe(7); expect(c.u).toBe(9);
  });
  it('the value model lands a tween on its end (a yoyo where it started); derived constants follow', () => {
    const g = new GateState();
    for (const t of ['const tax=0 q=(10-tax)/0.3 p=12-q/5', 'tween tax=3 dur=5']) g.apply(parseTag(t)!, 1);
    expect(g.consts.p).toBeCloseTo(12 - 7 / 0.3 / 5);
    g.apply(parseTag('tween tax=6 repeat=2 yoyo')!, 2);
    expect(g.consts.tax).toBe(3);
    expect(g.apply(parseTag('tween nope=1')!, 3)).toBe('no constant nope');
  });
});
