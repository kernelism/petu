// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { installTypeAhead, shortcutLetters } from '../../src/ui/typeAhead';

const press = (key: string, o: KeyboardEventInit = {}) => document.body.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...o }));

describe('typing with the bar unfocused', () => {
  let typed: string[], shortcuts: string[], off: () => void, off2: () => void;
  beforeEach(() => {
    vi.useFakeTimers();
    typed = []; shortcuts = [];
    off = installTypeAhead(window, () => (t) => { typed.push(t); return true; });
    // An app shortcut handler, added after (as App's are).
    const h = (e: KeyboardEvent) => shortcuts.push(e.key);
    window.addEventListener('keydown', h, true);
    off2 = () => window.removeEventListener('keydown', h, true);
  });
  afterEach(() => { off(); off2(); vi.useRealTimers(); });

  it('knows the card\'s letters, V aside', () => {
    const L = shortcutLetters();
    for (const k of ['d', 'h', 'g', 's', 'm', 'r', 'z', 'R']) expect(L.has(k)).toBe(true);
    expect(L.has('v')).toBe(false);
    expect(L.has('w')).toBe(false);
  });

  it('a lone shortcut letter still acts, after a short wait', () => {
    press('d');
    expect(shortcuts).toEqual([]);
    vi.advanceTimersByTime(300);
    expect(shortcuts).toEqual(['d']);
    expect(typed).toEqual([]);
  });

  it('"hmm" typed mid-answer goes to the bar, never the highlighter (round 6 in Chrome)', () => {
    press('h'); vi.advanceTimersByTime(90); press('m');
    vi.advanceTimersByTime(300);
    expect(typed).toEqual(['hm']);
    expect(shortcuts).toEqual([]);
  });

  it('G then a page number is still go-to-page: a digit lets the shortcut act first (round 7: "g430" was asked)', () => {
    press('g'); vi.advanceTimersByTime(40); press('4');
    expect(shortcuts).toEqual(['g', '4']);
    expect(typed).toEqual([]);
  });

  it('a letter that is no shortcut starts the question at once', () => {
    press('w');
    expect(typed).toEqual(['w']);
    expect(shortcuts).toEqual([]);
  });

  it('Space, arrows and modified keys are untouched; a held letter acts before the next key', () => {
    press(' ');
    press('ArrowRight');
    press('z', { metaKey: true });
    expect(shortcuts).toEqual([' ', 'ArrowRight', 'z']);
    press('g'); press('Escape');
    expect(shortcuts.slice(-2)).toEqual(['g', 'Escape']);
  });

  it('V is never held (hold-to-talk times its press)', () => {
    press('v');
    expect(shortcuts).toEqual(['v']);
  });
});
