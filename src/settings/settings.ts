import { useSyncExternalStore } from 'react';
import type { InkStyle } from '../ink/agent/marks';

export type Settings = { inkStyle: InkStyle; inkColor: string; highlightColor: string; wpm: number };
export const DEFAULTS: Settings = { inkStyle: 'live', inkColor: '#F2600C', highlightColor: '#FFD60A', wpm: 170 };
export const INK_COLORS = ['#F2600C', '#E5484D', '#0A84FF', '#30A46C', '#8E4EC6'];
export const HIGHLIGHT_COLORS = ['#FFD60A', '#7EE787', '#7CC4FF', '#FF9ECF'];

const KEY = 'pdf-tutor.settings';
let state: Settings = load();
const subs = new Set<() => void>();

function load(): Settings {
  try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) ?? '{}') }; } catch { return DEFAULTS; }
}
export const getSettings = () => state;
export function setSettings(patch: Partial<Settings>) {
  state = { ...state, ...patch };
  try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* private mode */ }
  subs.forEach((f) => f());
}
export const useSettings = () => useSyncExternalStore((f) => (subs.add(f), () => subs.delete(f)), getSettings);
