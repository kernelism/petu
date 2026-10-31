// src/ui/zoomKeys.ts
import { isTyping } from './playbackKeys';

/**
 * Board zoom keys (pure, so it is testable without the app):
 *
 *   ⌘+ / ⌘=   zoom in        ⌘−   zoom out        ⌘0   fit
 *
 * (Ctrl instead of ⌘ off a Mac.) Only while the board is open and focus is not in a text field;
 * never with Alt, while composing, or when the event was already handled. The caller swallows the
 * key (preventDefault) when this returns non-null, so the browser's own page zoom does not run.
 */
export type ZoomKeyContext = {
  /** The board is open beside the slides. */
  boardOpen: boolean;
  /** ⌘ is the modifier (macOS); otherwise Ctrl. */
  mac: boolean;
};

type KeyLike = Pick<KeyboardEvent, 'key' | 'metaKey' | 'ctrlKey' | 'altKey' | 'defaultPrevented' | 'target'> & { isComposing?: boolean; code?: string };

export function boardZoomKey(e: KeyLike, ctx: ZoomKeyContext): 'in' | 'out' | 'fit' | null {
  if (!ctx.boardOpen || e.defaultPrevented || e.altKey || e.isComposing) return null;
  const mod = ctx.mac ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey;
  if (!mod || isTyping(e.target)) return null;
  switch (e.key) {
    case '+':
    case '=':
      return 'in';
    case '-':
    case '_':
    case '−':
      return 'out';
    case '0':
      return 'fit';
  }
  // Numpad / layouts where `key` differs.
  if (e.code === 'NumpadAdd') return 'in';
  if (e.code === 'NumpadSubtract') return 'out';
  if (e.code === 'Digit0' || e.code === 'Numpad0') return 'fit';
  return null;
}

/**
 * Overview keys of the lane layout (layout C, W ≥ 1200: the board's own zoom does not exist there):
 *
 *   Z   toggle the overview (100% ↔ fit)      ⌘+ / ⌘=   in      ⌘−   out      ⌘0   100%
 *
 * Z: no modifiers, not while typing, not with a popover open. The ⌘ keys follow boardZoomKey's
 * rules. Only in lane mode (`lane`); otherwise null and B's board mapping applies.
 */
export type OverviewKeyContext = { lane: boolean; mac: boolean; popover: boolean };

export function overviewKey(e: KeyLike & { shiftKey?: boolean }, ctx: OverviewKeyContext): 'toggle' | 'in' | 'out' | 'reset' | null {
  if (!ctx.lane || e.defaultPrevented || e.isComposing) return null;
  if (e.key === 'z' || e.key === 'Z') {
    if (e.metaKey || e.ctrlKey || e.altKey || e.shiftKey || ctx.popover || isTyping(e.target)) return null;
    return 'toggle';
  }
  const z = boardZoomKey(e, { boardOpen: true, mac: ctx.mac });
  return z === 'fit' ? 'reset' : z;
}

export const isMacPlatform =(): boolean => typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
