// src/ui/FollowPill.tsx
import './ui.css';

/** Rule 6: shown while the student has taken over the view during an answer. Centered at `x` (the dock's column). */
export function FollowPill({ visible, onResume, x }: { visible: boolean; onResume(): void; x?: number }) {
  return (
    <button
      type="button"
      className={`follow-pill${visible ? ' is-visible' : ''}`}
      onClick={onResume}
      style={x != null ? { left: x } : undefined}
      aria-hidden={!visible}
      tabIndex={visible ? 0 : -1}
    >
      Back to answer
    </button>
  );
}
