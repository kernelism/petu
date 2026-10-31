import { useSyncExternalStore } from 'react';
import type { InkStyle } from '../ink/agent/marks';

/**
 * shortcuts: single-key drawing shortcuts (D, P, H, E). speed: playback speed, one of SPEEDS (the wpm is unchanged).
 * voice: the narration read aloud by that voice (server/voice.ts), or 'off' (captions only, paced by wpm).
 */
export type Settings = { inkStyle: InkStyle; inkColor: string; highlight: HighlightStyle; wpm: number; shortcuts: boolean; speed: number; voice: VoiceSetting };
/** The tutor's page highlight: a light violet wash (default) or the yellow marker. */
export type HighlightStyle = 'violet' | 'yellow';
/**
 * How each highlight is painted. Both sit in a multiply-blended layer, so glyphs stay crisp black.
 * Violet: the accent at 0.17 → about rgb(236,226,246) on white, a wash behind a whole clause.
 * Yellow: the marker look from before (#FFD60A at 0.5).
 */
export const HIGHLIGHTS: Record<HighlightStyle, { label: string; color: string; opacity: number }> = {
  violet: { label: 'Violet wash', color: '#8E4EC6', opacity: 0.17 },
  yellow: { label: 'Yellow marker', color: '#FFD60A', opacity: 0.5 },
};
export const HIGHLIGHT_STYLES = Object.keys(HIGHLIGHTS) as HighlightStyle[];
/** The voices offered (OpenAI's two recommended ones first); 'off' = silent captions. */
export const VOICE_OPTIONS = ['off', 'marin', 'cedar'] as const;
export type VoiceSetting = (typeof VOICE_OPTIONS)[number];

/** Playback speeds offered in the answer's controls (< and > step through them). */
export const SPEEDS = [0.75, 1, 1.25, 1.5] as const;
/** The speed one step slower (dir -1) or faster (+1) than `s`, clamped to SPEEDS. */
export function stepSpeed(s: number, dir: -1 | 1): number {
  let i = SPEEDS.findIndex((v) => v === s);
  if (i < 0) i = SPEEDS.indexOf(1);
  return SPEEDS[Math.max(0, Math.min(SPEEDS.length - 1, i + dir))];
}
/**
 * The default ink is violet: lecture slides use red, orange, yellow, green and blue for their own
 * content (titles, boxes, figures), and violet sits in the widest gap of that wheel, so the tutor's
 * ink never reads as part of the slide. 5.2:1 on a white page, 4.2:1 on the desk.
 */
export const DEFAULTS: Settings = { inkStyle: 'live', inkColor: '#8E4EC6', highlight: 'violet', wpm: 170, shortcuts: true, speed: 1, voice: 'off' };
export const INK_COLORS = ['#8E4EC6', '#F2600C', '#E5484D', '#0A84FF', '#30A46C'];

const KEY = 'pdf-tutor.settings';
/** v2: the default ink moved from orange to violet. */
const VERSION = 2;
/** Before v2 every save wrote the whole state, so a stored orange is the old default, not a choice. */
const OLD_DEFAULT_INK = '#F2600C';
let state: Settings = load();
const subs = new Set<() => void>();

function load(): Settings {
  try {
    // highlightColor (≤ v2) was always written with the whole state, so a stored yellow is the old
    // default, not a choice; the other old swatches are gone. Every legacy value lands on the default.
    const { v, highlightColor: _legacy, ...saved } = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<Settings> & { v?: number; highlightColor?: string };
    if ((v ?? 1) < 2 && saved.inkColor?.toUpperCase() === OLD_DEFAULT_INK) delete saved.inkColor;
    const out = { ...DEFAULTS, ...saved };
    if (!SPEEDS.some((v) => v === out.speed)) out.speed = 1;
    if (!HIGHLIGHT_STYLES.includes(out.highlight)) out.highlight = DEFAULTS.highlight;
    if (!VOICE_OPTIONS.includes(out.voice)) out.voice = DEFAULTS.voice;
    return out;
  } catch { return DEFAULTS; }
}
export const getSettings = () => state;
export function setSettings(patch: Partial<Settings>) {
  state = { ...state, ...patch };
  try { localStorage.setItem(KEY, JSON.stringify({ ...state, v: VERSION })); } catch { /* private mode */ }
  subs.forEach((f) => f());
}
export const useSettings = () => useSyncExternalStore((f) => (subs.add(f), () => subs.delete(f)), getSettings);
