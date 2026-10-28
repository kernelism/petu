// src/ink/agent/weights.ts
import type { Weight } from '../../script/types';
import { token, tokenNum } from './tokens';

export type { Weight };
export type WeightStyle = { width: number; color: string; opacity: number; dash: string };

/** The kinds whose default is `secondary`: scaffolding and annotation, not the figure itself. */
const SECONDARY_KINDS = new Set(['axes', 'angle', 'brace']);

/** The weight an element draws at: explicit `weight`, else dash → faint, else its kind's default. */
export function weightOf(a: { kind: string; weight?: Weight; dash?: boolean }): Weight {
  if (a.weight) return a.weight;
  if (a.dash) return 'faint';
  return SECONDARY_KINDS.has(a.kind) ? 'secondary' : 'primary';
}

/**
 * How a weight draws: width (CSS px), neutral color, opacity, and its dash pattern (used only when
 * the element is dashed). `hand` draws everything 1.2× heavier, keeping the ratios.
 */
export function weightStyle(w: Weight, hand = false): WeightStyle {
  const k = hand ? 1.2 : 1;
  switch (w) {
    case 'primary': return { width: tokenNum('--ink-w-primary') * k, color: token('--ink'), opacity: 1, dash: '6 5' };
    case 'secondary': return { width: tokenNum('--ink-w-secondary') * k, color: token('--ink-2'), opacity: 1, dash: '5 4' };
    case 'faint': return { width: tokenNum('--ink-w-faint') * k, color: token('--muted'), opacity: tokenNum('--ink-faint-opacity'), dash: '4 3.5' };
  }
}
