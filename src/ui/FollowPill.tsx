// src/ui/FollowPill.tsx
import { useEffect, useRef, useSyncExternalStore } from 'react';
import './ui.css';

/**
 * Rule 6: the student has taken over the view during an answer. The way back is "Back to answer",
 * and it lives in the route chip's row at the top of the slide column (RouteChip renders it), so
 * there is never a second "back" control stacked over the page. This component only reports
 * whether it shows and what it does; it draws nothing itself.
 */
export type FollowBack = { visible: boolean; onResume(): void };

const HIDDEN: FollowBack = { visible: false, onResume: () => {} };
let state: FollowBack = HIDDEN;
const subs = new Set<() => void>();
function set(next: FollowBack) {
  if (next.visible === state.visible && next.onResume === state.onResume) return;
  state = next;
  subs.forEach((f) => f());
}

/** What the route chip shows for "Back to answer". */
export const useFollowBack = () => useSyncExternalStore((f) => (subs.add(f), () => subs.delete(f)), () => state, () => HIDDEN);

/** `x` is kept for the call site's sake: the route chip already sits on the slide column's centre. */
export function FollowPill({ visible, onResume }: { visible: boolean; onResume(): void; x?: number }) {
  const resume = useRef(onResume);
  resume.current = onResume;
  const stable = useRef(() => resume.current()).current;
  useEffect(() => { set({ visible, onResume: stable }); }, [visible, stable]);
  useEffect(() => () => set(HIDDEN), []);
  return null;
}
