import { useSyncExternalStore } from 'react';
import type { InkStyle } from '../ink/agent/marks';

/** shortcuts: single-key drawing shortcuts (D, P, H, E). */
export type Settings = { inkStyle: InkStyle; inkColor: string; highlightColor: string; wpm: number; shortcuts: boolean };
/**
 * The default ink is violet: lecture slides use red, orange, yellow, green and blue for their own
 * content (titles, boxes, figures), and violet sits in the widest gap of that wheel, so the tutor's
 * ink never reads as part of the slide. 5.2:1 on a white page, 4.2:1 on the desk.
 */
export const DEFAULTS: Settings = { inkStyle: 'live', inkColor: '#8E4EC6', highlightColor: '#FFD60A', wpm: 170, shortcuts: true };
export const INK_COLORS = ['#8E4EC6', '#F2600C', '#E5484D', '#0A84FF', '#30A46C'];
export const HIGHLIGHT_COLORS = ['#FFD60A', '#7EE787', '#7CC4FF', '#FF9ECF'];

const KEY = 'pdf-tutor.settings';
/** v2: the default ink moved from orange to violet. */
const VERSION = 2;
/** Before v2 every save wrote the whole state, so a stored orange is the old default, not a choice. */
const OLD_DEFAULT_INK = '#F2600C';
let state: Settings = load();
const subs = new Set<() => void>();

function load(): Settings {
  try {
    const { v, ...saved } = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<Settings> & { v?: number };
    if ((v ?? 1) < 2 && saved.inkColor?.toUpperCase() === OLD_DEFAULT_INK) delete saved.inkColor;
    return { ...DEFAULTS, ...saved };
  } catch { return DEFAULTS; }
}
export const getSettings = () => state;
export function setSettings(patch: Partial<Settings>) {
  state = { ...state, ...patch };
  try { localStorage.setItem(KEY, JSON.stringify({ ...state, v: VERSION })); } catch { /* private mode */ }
  subs.forEach((f) => f());
}
export const useSettings = () => useSyncExternalStore((f) => (subs.add(f), () => subs.delete(f)), getSettings);
