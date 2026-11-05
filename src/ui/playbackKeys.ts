// src/ui/playbackKeys.ts
/**
 * Keyboard control of a playing answer (pure, so it is testable without the app):
 *
 *   Space         pause / resume
 *   R             replay the sentence being spoken (again at once: the sentence before)
 *   Shift+←       the same as R          Shift+→   on to the next sentence
 *   ← / →         previous / next part (answers with two or more parts)
 *   <  /  >       slower / faster (0.75× · 1× · 1.25× · 1.5×)
 *   E             explain this step again (an aside), once a process step has played
 *   Esc / Return  close the aside (the paused answer resumes where it stopped)
 *
 * Never while typing (inputs, textareas, selects, contenteditable, or a draft held in the ask bar), with ⌘/Ctrl/Alt held, while a
 * popover is open, or when nothing is playing. Shift+R stays the Report shortcut.
 */
export type PlaybackHandlers = {
  togglePause(): void;
  stepPart(dir: -1 | 1): void;
  closeAside(): void;
  replay(): void;
  skip(): void;
  speed(dir: -1 | 1): void;
  /** Ask for the step on the board explained again (teaching-engine Phase 2): an aside over the paused answer. */
  explainStep?(): void;
};

export type PlaybackContext = {
  /** An aside is open (the answer is paused under it): Space, R and speed act on the aside. */
  aside: boolean;
  /** An answer is in progress. */
  playing: boolean;
  /** How many parts the answer has. */
  parts: number;
  /** A popover (settings) is open: keys belong to it. */
  popover: boolean;
  /** A process step has played in this answer (E explains it again). */
  stepped?: boolean;
};

type KeyLike = Pick<KeyboardEvent, 'key' | 'shiftKey' | 'metaKey' | 'ctrlKey' | 'altKey' | 'defaultPrevented' | 'target'> & { isComposing?: boolean };

export const isTypingTarget = (t: EventTarget | null): boolean =>
  !!t && typeof (t as HTMLElement).tagName === 'string' && ((t as HTMLElement).isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test((t as HTMLElement).tagName));

/**
 * The ask bar holds a question being written (a non-empty draft, `.askbar.has-draft`), even with the
 * field blurred: single-key shortcuts stand down, so a stray key never acts on the answer the student
 * is about to interrupt (and the draft is never lost to one).
 */
export const draftHeld = (doc: ParentNode | undefined = typeof document !== 'undefined' ? document : undefined): boolean =>
  !!doc?.querySelector('.askbar.has-draft');

/** Keys belong to the student's typing: focus is in a text field, or the ask bar holds a draft. */
export const isTyping = (t: EventTarget | null): boolean => isTypingTarget(t) || draftHeld();

/** Runs the key's command. True when the key was handled (the caller swallows it). */
export function playbackKey(e: KeyLike, c: PlaybackContext, h: PlaybackHandlers): boolean {
  if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || e.isComposing) return false;
  if (e.key === 'Escape' && c.aside) { h.closeAside(); return true; }
  if (isTyping(e.target) || c.popover) return false;
  if (e.key === 'Enter' && c.aside) { h.closeAside(); return true; }
  if (!c.playing && !c.aside) return false;
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
      if (c.parts < 2 || c.aside) return false;
      h.stepPart(dir); return true;
    }
    case 'e':
    case 'E':
      if (e.shiftKey || c.aside || !c.stepped || !h.explainStep) return false;
      h.explainStep(); return true;
    case '<':
    case '>':
      h.speed(e.key === '<' ? -1 : 1); return true;
    default:
      return false;
  }
}

/** The question E asks: the step on the board, again, more slowly (any subject; the aside sees the board's numbers). */
export const EXPLAIN_STEP_QUESTION = 'Explain the step on the board again, more slowly: what it takes in, what it does, and how its number comes out.';
