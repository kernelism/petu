// tests/desk/kitLayout.test.ts — relative placement of kit blocks, and the one-animation-per-block rule.
import { describe, it, expect, vi } from 'vitest';
import { place, wrapPieces, type Placed, type Spacing } from '../../src/desk/kit/layout';
import { Animations, tween, pause } from '../../src/desk/kit/anim';
import { metrics } from '../../src/desk/kit/kit';

const S: Spacing = { gap: 20, opW: 16, margin: 40, top: 30, width: 1000 };
const none = { l: 0, t: 0, r: 0, b: 0 };

describe('placement', () => {
  const a: Placed = place(180, 150, { l: 0, t: 0, r: 0, b: 24 }, {}, undefined, [], S);
  it('the first block sits at the top-left margins', () => {
    expect(a.body).toEqual({ x: 40, y: 30, w: 180, h: 150 });
    expect(a.rect).toEqual({ x: 40, y: 30, w: 180, h: 174 });
  });
  it('right=: one gap plus room for the glyph, bodies centred on one line, the glyph between', () => {
    const k = place(90, 90, { l: 0, t: 0, r: 0, b: 24 }, { right: 'a', op: '⊛' }, a, [a], S);
    expect(k.body.x).toBe(40 + 180 + 16 + 20);
    expect(k.body.y + k.body.h / 2).toBe(a.body.y + a.body.h / 2);
    expect(k.op).toEqual({ x: 40 + 180 + 18, y: 105, glyph: '⊛' });
    const plain = place(90, 90, none, { right: 'a' }, a, [a], S);
    expect(plain.body.x).toBe(240);
  });
  it('right= wraps under everything when it would cross the right margin, the glyph leading the new line', () => {
    const wide = place(800, 60, none, { right: 'a', op: '=' }, a, [a], S);
    expect(wide.body.y).toBe(a.rect.y + a.rect.h + S.gap);
    expect(wide.op!.x).toBe(40 + 8);
    expect(wide.body.x).toBe(40 + 16 + 10);
  });
  it('below=: under the anchor’s labels, left edges of the bodies aligned', () => {
    const b = place(120, 40, { l: 30, t: 10, r: 0, b: 0 }, { below: 'a' }, a, [a], S);
    // aligned with the anchor's body, unless its own row labels need the room
    expect(b.body.x).toBe(70);
    expect(place(120, 40, none, { below: 'a' }, a, [a], S).body.x).toBe(a.body.x);
    expect(b.body.y).toBe(a.rect.y + a.rect.h + S.gap + 10);
  });
  it('below=: also under whatever was placed under the anchor since (a calc line)', () => {
    const calc = place(300, 20, none, { below: 'a' }, a, [a], S);
    const b = place(120, 40, none, { below: 'a' }, a, [a, calc], S);
    expect(b.body.y).toBe(calc.rect.y + calc.rect.h + S.gap);
  });
  it('no anchor: under the lowest block in the section; at= is the body’s top-left', () => {
    const b = place(100, 50, none, { right: 'a' }, a, [a], S);
    const c = place(100, 50, none, {}, undefined, [a, b], S);
    expect(c.body.y).toBe(Math.max(a.rect.y + a.rect.h, b.rect.y + b.rect.h) + S.gap);
    expect(place(10, 10, none, { at: { x: 300, y: 400 } }, undefined, [a], S).body).toMatchObject({ x: 300, y: 400 });
  });
  it('calc lines wrap between pieces, never inside one', () => {
    const lines = wrapPieces(['aaaa + ', 'bbbb + ', 'cccc = ', '12'], 15, (s) => s.length);
    expect(lines).toEqual([['aaaa + ', 'bbbb + '], ['cccc = ', '12']]);
  });
  it('type: numerals at the slide body size, never under 13px, growing with a wide board; square cells ~2.5em', () => {
    const narrow = metrics(0.6, 14), wide = metrics(1.2, 14);
    expect(narrow.numPx).toBe(13);
    expect(wide.numPx).toBe(20);
    expect(narrow.num).toBeCloseTo(13 / 0.6);
    expect(metrics(0.6, 30).numPx).toBe(27);
  });
});

describe('animations: one state animation per block', () => {
  it('a later change on the same block fast-forwards the running one, then starts', async () => {
    const A = new Animations();
    const log: string[] = [];
    let first!: Promise<void>;
    first = A.run(undefined, ['o'], async (ctl) => {
      for (let i = 0; i < 50; i++) { await pause(40, ctl); log.push(`a${i}`); }
      log.push('a-end');
    });
    await new Promise((r) => setTimeout(r, 60));
    expect(A.busy('o')).toBe(true);
    const t0 = performance.now();
    await A.run(undefined, ['o', 'p'], async () => { log.push('b'); });
    await first;
    // the first ran to its end state at once (all 50 steps, no waiting), before the second began
    expect(log.indexOf('a-end')).toBeLessThan(log.indexOf('b'));
    expect(log.filter((x) => x.startsWith('a')).length).toBe(51);
    expect(performance.now() - t0).toBeLessThan(400);
    expect(A.busy('o')).toBe(false);
  });
  it('different blocks run side by side; settle() lands everything', async () => {
    const A = new Animations();
    let doneA = false, doneB = false;
    const a = A.run(undefined, ['a'], async (ctl) => { await pause(5000, ctl); doneA = true; });
    const b = A.run(undefined, ['b'], async (ctl) => { await pause(5000, ctl); doneB = true; });
    await new Promise((r) => setTimeout(r, 0));
    expect(A.busy('a') && A.busy('b')).toBe(true);
    A.settle();
    await Promise.all([a, b]);
    expect(doneA && doneB).toBe(true);
  });
  it('motion runs on the narration clock: still while paused, compressed with a backlog', async () => {
    const A = new Animations();
    let paused = true;
    let seen = -1;
    const run = A.run({ speed: 1, paused: () => paused }, ['w'], async (ctl) => { await tween(200, (t) => { seen = t; }, ctl, (t) => t); });
    await new Promise((r) => setTimeout(r, 250));
    expect(seen).toBe(0); // paused from the start: the window has not moved
    paused = false;
    await run;
    expect(seen).toBe(1);
    const t0 = performance.now();
    await A.run({ speed: 0.5 }, ['w'], async (ctl) => { await pause(300, ctl); });
    const took = performance.now() - t0;
    expect(took).toBeGreaterThanOrEqual(140);
    expect(took).toBeLessThan(280);
  });
  it('tweens end on exactly 1; reduced motion lands at once', async () => {
    const seen: number[] = [];
    await tween(30, (t) => seen.push(t));
    expect(seen[seen.length - 1]).toBe(1);
    const mm = vi.spyOn(window, 'matchMedia').mockReturnValue({ matches: true } as MediaQueryList);
    const once: number[] = [];
    await tween(5000, (t) => once.push(t));
    expect(once).toEqual([1]);
    mm.mockRestore();
  });
});
