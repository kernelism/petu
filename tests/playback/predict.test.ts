// The prediction prompt (src/playback/predict.ts): asked before a window's third position, from the engine's value.
import { describe, expect, it } from 'vitest';
import { guessRight, predictionFor } from '../../src/playback/predict';
import { parseGroup } from '../../src/svgboard/sanitize';
import type { RawAction } from '../../src/script/types';

const win = parseGroup('<g id="conv" data-slide="img.f" data-op="mean" data-size="3x3"/>') as Element;
const tw = (k: string): RawAction => ({ kind: 'tween', ref: 'k', sets: [['k', k]] }) as RawAction;
const sc = (k: number) => ({ consts: { k }, calcs: new Map([['conv', { out: [[7, 8, 9.5], [12, 13, 14]] }]]) });

describe('predictionFor', () => {
  it('asks on the move on from step 2 (to 3, or a sweep), with the window\'s third output', () => {
    expect(predictionFor(tw('3'), [win], sc(2))).toEqual({ win: 'conv', value: 9.5, text: '9.5' });
    expect(predictionFor(tw('2'), [win], sc(1))).toBeNull();
    expect(predictionFor(tw('3'), [win], sc(1))).toBeNull(); // a jump from step 1
    expect(predictionFor(tw('9'), [win], sc(2))?.value).toBe(9.5); // a sweep from step 2
    expect(predictionFor(tw('3'), [], sc(2))).toBeNull();
  });

  it('a guess is right as the board writes it or exactly; not a number is no guess', () => {
    const p = { win: 'conv', value: 2 / 3, text: '0.67' };
    expect(guessRight('0.67', p)).toBe(true);
    expect(guessRight('2/3', p)).toBe(true);
    expect(guessRight('0.6', p)).toBe(false);
    expect(guessRight('a lot', p)).toBeNull();
  });
});
