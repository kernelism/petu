// src/ui/playbackKeys.ts
/**
 * Keyboard control of a playing answer (pure, so it is testable without the app):
 *
 *   Space         pause / resume
 *   R             replay the sentence being spoken (again at once: the sentence before)
 *   Shift+←       the same as R          Shift+→   on to the next sentence
 *   ← / →         previous / next part (answers with two or more parts)
 *   <  /  >       slower / faster (0.75× · 1× · 1.25× · 1.5×)
 *   Esc           closes the Go deeper inset (the answer resumes)
 *
 * Never while typing (inputs, textareas, selects, contenteditable), with ⌘/Ctrl/Alt held, while a
 * popover is open, or when nothing is playing. Shift+R stays the Report shortcut.
 */
export type PlaybackHandlers = {
  togglePause(): void;
  stepPart(dir: -1 | 1): void;
  closeDeeper(): void;
  replay(): void;
  skip(): void;
  speed(dir: -1 | 1): void;
};

export type PlaybackContext = {
  /** The Go deeper inset is open (the answer is paused under it). */
  deeper: boolean;
  /** An answer is in progress. */
  playing: boolean;
  /** How many parts the answer has. */
  parts: number;
  /** A popover (settings) is open: keys belong to it. */
  popover: boolean;
};

type KeyLike = Pick<KeyboardEvent, 'key' | 'shiftKey' | 'metaKey' | 'ctrlKey' | 'altKey' | 'defaultPrevented' | 'target'> & { isComposing?: boolean };

export const isTypingTarget = (t: EventTarget | null): boolean =>
  !!t && typeof (t as HTMLElement).tagName === 'string' && ((t as HTMLElement).isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test((t as HTMLElement).tagName));

/** Runs the key's command. True when the key was handled (the caller swallows it). */
export function playbackKey(e: KeyLike, c: PlaybackContext, h: PlaybackHandlers): boolean {
  if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || e.isComposing) return false;
  if (e.key === 'Escape' && c.deeper) { h.closeDeeper(); return true; }
  if (isTypingTarget(e.target) || c.deeper || !c.playing || c.popover) return false;
  switch (e.key) {
    case ' ':
    case 'Spacebar':
      h.togglePause(); return true;
    case 'r':
    case 'R':
      if (e.shiftKey) return false; // Shift+R: Report
      h.replay(); return true;
    case 'ArrowLeft':
    case 'ArrowRight': {
      const dir = e.key === 'ArrowLeft' ? -1 : 1;
      if (e.shiftKey) { if (dir < 0) h.replay(); else h.skip(); return true; }
      if (c.parts < 2) return false;
      h.stepPart(dir); return true;
    }
    case '<':
    case '>':
      h.speed(e.key === '<' ? -1 : 1); return true;
    default:
      return false;
  }
}
