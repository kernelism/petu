// A Director keeps one KitStore for life (registry.ext); a new answer clears it (Director.begin →
// registry.clear). An answer's constants are its own: a follow-up that reuses a name with a new value
// (fu D3: a=30*pi/180 then a=15) draws its readouts from the new value, not a refusal.
import { describe, expect, it } from 'vitest';
import { KitStore } from '../../src/desk/kit/kit';

describe('constants are scoped to the answer', () => {
  it('a new answer may give a name the last answer defined its own value', () => {
    const k = new KitStore();
    k.defineConsts([['a', '30']]);
    k.clear(); // the next answer
    k.defineConsts([['a', '15']]);
    expect(k.consts.a).toBe(15);
    k.defineConsts([['a', '20']]); // within the answer the first value still stands
    expect(k.consts.a).toBe(15);
  });

  it('an extended board: the inherited value gives way to the follow-up\'s, once', () => {
    const k = new KitStore();
    k.defineConsts([['a', '30']]);
    const board = k.consts;
    k.clear();
    // linkStore (src/svgboard/element.ts): the store takes the board's constants it does not have.
    for (const [n, v] of Object.entries(board)) if (!(n in k.consts)) k.consts[n] = v;
    k.defineConsts([['a', '15']]);
    expect(k.consts.a).toBe(15);
    k.defineConsts([['a', '20']]);
    expect(k.consts.a).toBe(15);
  });
});
