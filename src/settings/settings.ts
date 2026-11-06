import { useSyncExternalStore } from 'react';
import type { InkStyle } from '../ink/agent/marks';
import { ANSWER_QUALITIES, type AnswerQuality } from '../agent/protocol';

/**
 * What the engine reads. The student chooses `highlight`, `speed`, `voice` and `quality` (the
 * Settings popover); those four are stored. `inkStyle` and `inkColor` are fixed for the student
 * (one drawing style; violet ink, which the visual grammar enforces): they stay on the object only
 * because the renderers read them, and the dev `?style=` review aid and the gate's shadow pass set
 * `inkStyle` for one run. Neither is ever stored.
 * speed: playback speed, one of SPEEDS (the narration's rate is BASE_WPM × speed).
 * voice: the narration read aloud by that voice (server/voice.ts), or 'off' (captions only).
 * quality: 'standard' (the server's default model) or 'best' (server/quality.ts maps it; the browser never names a model).
 * predict: once an answer's window has worked two positions, it stops and asks the student for the next output
 *   (teaching-engine §3.4, optional; off by default until the pacing decision in §7).
 */
export type Settings = { inkStyle: InkStyle; inkColor: string; highlight: HighlightStyle; speed: number; voice: VoiceSetting; quality: AnswerQuality; predict: boolean };
/** The student's choices: the stored part of Settings. */
type Stored = Pick<Settings, 'highlight' | 'speed' | 'voice' | 'quality' | 'predict'>;
const STORED: (keyof Stored)[] = ['highlight', 'speed', 'voice', 'quality', 'predict'];
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
export { ANSWER_QUALITIES, type AnswerQuality };

/**
 * The narration's words per minute at 1× (the clock's base rate; speed multiplies it). 155 since
 * 2026-10-30 (founder: "drawing races, explanation races": a calmer default, with the drawing paced to
 * the words); was 170.
 */
export const BASE_WPM = 155;
/** The base rate ≤ v2 saves were made against: a stored wpm is read relative to it (170 = the default, 1×). */
const LEGACY_BASE_WPM = 170;
/** Playback speeds: the Settings control and the answer's own controls (< and > step through them). */
export const SPEEDS = [0.75, 1, 1.25, 1.5] as const;
/** The speed one step slower (dir -1) or faster (+1) than `s`, clamped to SPEEDS. */
export function stepSpeed(s: number, dir: -1 | 1): number {
  let i = SPEEDS.findIndex((v) => v === s);
  if (i < 0) i = SPEEDS.indexOf(1);
  return SPEEDS[Math.max(0, Math.min(SPEEDS.length - 1, i + dir))];
}
/** The step nearest `x` (ties go to the slower one). */
export const nearestSpeed = (x: number): number =>
  SPEEDS.reduce((best, v) => (Math.abs(v - x) < Math.abs(best - x) - 1e-9 ? v : best), SPEEDS[0] as number);
/**
 * The ink is violet: lecture slides use red, orange, yellow, green and blue for their own content
 * (titles, boxes, figures), and violet sits in the widest gap of that wheel, so the tutor's ink never
 * reads as part of the slide. 5.2:1 on a white page, 4.2:1 on the desk.
 */
export const INK_COLOR = '#8E4EC6';
export const DEFAULTS: Settings = { inkStyle: 'hand', inkColor: INK_COLOR, highlight: 'violet', speed: 1, voice: 'off', quality: 'standard', predict: false };

const KEY = 'pdf-tutor.settings';
/**
 * v2: the default ink moved from orange to violet. v3: the drawing style, ink colour, reading-speed
 * slider (wpm) and shortcuts toggle are gone; a stored wpm folds into the speed step.
 */
const VERSION = 3;
let state: Settings = load();
const subs = new Set<() => void>();

/** Reads a stored blob (any version) into the student's choices; anything unknown falls back to its default. */
export function migrate(raw: unknown): Stored {
  const saved = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const out: Stored = { highlight: DEFAULTS.highlight, speed: DEFAULTS.speed, voice: DEFAULTS.voice, quality: DEFAULTS.quality, predict: saved.predict === true };
  // highlightColor (≤ v2) was always written with the whole state, so a stored yellow was the old
  // default, not a choice: every legacy value lands on the default (only `highlight` is read).
  if (HIGHLIGHT_STYLES.includes(saved.highlight as HighlightStyle)) out.highlight = saved.highlight as HighlightStyle;
  if (VOICE_OPTIONS.includes(saved.voice as VoiceSetting)) out.voice = saved.voice as VoiceSetting;
  if (ANSWER_QUALITIES.includes(saved.quality as AnswerQuality)) out.quality = saved.quality as AnswerQuality;
  const speed = SPEEDS.some((v) => v === saved.speed) ? (saved.speed as number) : 1;
  // ≤ v2: the narration played at wpm × speed; keep that rate relative to the old default, on the nearest step.
  const wpm = typeof saved.wpm === 'number' && Number.isFinite(saved.wpm) && saved.wpm > 0 ? saved.wpm : LEGACY_BASE_WPM;
  out.speed = nearestSpeed((wpm / LEGACY_BASE_WPM) * speed);
  return out;
}

function load(): Settings {
  try {
    return { ...DEFAULTS, ...migrate(JSON.parse(localStorage.getItem(KEY) ?? '{}')) };
  } catch { return DEFAULTS; }
}
export const getSettings = () => state;
export function setSettings(patch: Partial<Settings>) {
  state = { ...state, ...patch };
  const stored = Object.fromEntries(STORED.map((k) => [k, state[k]]));
  try { localStorage.setItem(KEY, JSON.stringify({ ...stored, v: VERSION })); } catch { /* private mode */ }
  subs.forEach((f) => f());
}
export const useSettings = () => useSyncExternalStore((f) => (subs.add(f), () => subs.delete(f)), getSettings);
