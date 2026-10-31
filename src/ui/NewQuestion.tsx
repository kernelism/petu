// src/ui/NewQuestion.tsx — the ask bar's + (founder 2026-10-31): saves the question on the board (with
// its follow-ups and asides) to the session list and starts the next one on a clean board. It sits just
// left of the bar, outside the dock's width, so the caption and bar keep their one card. Shown once the
// board holds a question.
import { Plus } from 'lucide-react';

export function NewQuestion({ shown, onClick }: { shown: boolean; onClick(): void }) {
  return (
    <button
      type="button"
      className={`dock-new${shown ? ' is-shown' : ''}`}
      onClick={onClick}
      tabIndex={shown ? 0 : -1}
      aria-hidden={!shown}
      aria-label="New question"
      title="New question"
    >
      <Plus size={18} strokeWidth={2} aria-hidden="true" />
    </button>
  );
}
