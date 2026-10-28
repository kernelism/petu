// tests/ink/weights.test.ts
import { describe, it, expect } from 'vitest';
import { weightOf, weightStyle } from '../../src/ink/agent/weights';

describe('line hierarchy', () => {
  it('explicit weight wins; dash defaults to faint; scaffolding kinds to secondary; the rest primary', () => {
    expect(weightOf({ kind: 'line' })).toBe('primary');
    expect(weightOf({ kind: 'line', dash: true })).toBe('faint');
    expect(weightOf({ kind: 'line', dash: true, weight: 'primary' })).toBe('primary');
    expect(weightOf({ kind: 'arrow', weight: 'secondary' })).toBe('secondary');
    for (const k of ['axes', 'angle', 'brace']) expect(weightOf({ kind: k })).toBe('secondary');
    for (const k of ['circle', 'box', 'curve', 'plot', 'underline']) expect(weightOf({ kind: k })).toBe('primary');
  });
  it('three distinct weights, heaviest to lightest, from the tokens', () => {
    const p = weightStyle('primary'), s = weightStyle('secondary'), f = weightStyle('faint');
    expect(p).toMatchObject({ width: 2, color: '#1D1D1F', opacity: 1 });
    expect(s).toMatchObject({ width: 1.25, color: '#3A3A3C', opacity: 1 });
    expect(f).toMatchObject({ width: 1, color: '#6E6E73', opacity: 0.7 });
    expect(weightStyle('primary', true).width).toBeCloseTo(2.4);
  });
});
