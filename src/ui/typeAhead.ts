// src/ui/typeAhead.ts — typing with the ask bar not focused (it lets go after each question, so Space,
// R and the arrows reach the answer). A student who starts typing a follow-up mid-answer without
// clicking the bar used to set off shortcuts: "hmm" turned the highlighter on (H) and past marks (M),
// "good" opened go-to-page. Words and shortcuts differ in time: a shortcut is one key, a word is a run
// of keys a typist presses within a few hundred ms. So, ahead of every other key handler:
//   - a letter that is no shortcut starts the question in the bar at once;
//   - a shortcut letter waits TYPE_GAP_MS: alone, it is replayed to the handlers as the shortcut;
//     followed by a letter or space in time, both go to the bar as text (a digit is G's page number).
// V (hold to talk) is never held back: its press and release time the hold.
import { isTypingTarget } from './playbackKeys';
import { shortcutRows } from './ShortcutsOverlay';

/** How long a lone shortcut letter waits for a next key before it acts. Typists' key gaps are mostly under it. */
export const TYPE_GAP_MS = 250;

/** The letters the shortcuts card lists ("R", and "⇧ R" as "R" uppercase), V excepted (see above). */
export function shortcutLetters(): Set<string> {
  const out = new Set<string>();
  for (const rows of [shortcutRows({ mac: true, lane: true, dev: true }), shortcutRows({ mac: true, lane: false, dev: true })])
    for (const g of rows) for (const r of g) for (const k of r.keys) {
      if (k.length === 1 && /^[A-Z]$/.test(k[0])) out.add(k[0].toLowerCase());
      else if (k.length === 2 && k[0] === '⇧' && /^[A-Z]$/.test(k[1])) out.add(k[1]);
    }
  out.delete('v');
  return out;
}

/** Where typed text goes: the bar takes it (focused, the text appended). False when it can't (no bar, blocked). */
export type TypeSink = (text: string) => boolean;

/** A key that types: one printable character, no modifier but Shift. */
const typed = (e: KeyboardEvent) => e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey;

/**
 * Installs the interceptor on `win` (capture, before any handler added later; call it before the app
 * mounts). `sink()` is read per key: the bar registers itself (AskBar) and may be absent.
 */
export function installTypeAhead(win: Window, sink: () => TypeSink | null, letters = shortcutLetters(), gap = TYPE_GAP_MS): () => void {
  let held: KeyboardEvent | null = null;
  let timer = 0;
  const replaying = new WeakSet<Event>();
  const replay = (e: KeyboardEvent) => {
    const ev = new KeyboardEvent('keydown', { key: e.key, code: e.code, shiftKey: e.shiftKey, bubbles: true, cancelable: true });
    replaying.add(ev);
    (win.document.activeElement ?? win.document.body).dispatchEvent(ev);
  };
  const release = () => { win.clearTimeout(timer); const h = held; held = null; if (h) replay(h); };
  const onKey = (e: KeyboardEvent) => {
    if (replaying.has(e) || e.isComposing) return;
    const s = sink();
    if (!s || isTypingTarget(e.target) || isTypingTarget(win.document.activeElement)) { if (held) release(); return; }
    if (held) {
      // A second letter (or a space) in time: the two were the start of a question. A digit is what a
      // shortcut asks for next (G, then the page number): the shortcut acts and the digit goes on to it.
      if (typed(e) && !/^\d$/.test(e.key)) {
        win.clearTimeout(timer);
        const text = held.key + e.key;
        held = null;
        if (s(text)) { e.preventDefault(); e.stopImmediatePropagation(); }
        return;
      }
      release();
      return;
    }
    if (!typed(e) || e.repeat || !/^[A-Za-z]$/.test(e.key) || e.key.toLowerCase() === 'v') return;
    if (!letters.has(e.key) && !letters.has(e.key.toLowerCase())) {
      // No shortcut: the student is writing.
      if (s(e.key)) { e.preventDefault(); e.stopImmediatePropagation(); }
      return;
    }
    e.preventDefault();
    e.stopImmediatePropagation();
    held = e;
    timer = win.setTimeout(release, gap);
  };
  win.addEventListener('keydown', onKey, true);
  return () => { win.clearTimeout(timer); win.removeEventListener('keydown', onKey, true); };
}

let current: TypeSink | null = null;
/** The ask bar's registration (null on unmount). */
export const setTypeSink = (s: TypeSink | null) => { current = s; };
export const typeSink = () => current;
