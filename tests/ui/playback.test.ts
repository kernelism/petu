// The answer's playback row (PartsBar) and its keys (playbackKeys).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { playbackKey, type PlaybackContext, type PlaybackHandlers } from '../../src/ui/playbackKeys';
import { PartsBar, speedLabel, type PartsView } from '../../src/ui/PartsBar';
import { Caption } from '../../src/ui/Caption';
import { AskBar } from '../../src/ui/AskBar';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function handlers(): PlaybackHandlers & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    togglePause: () => calls.push('pause'),
    stepPart: (d) => calls.push(`part${d}`),
    closeAside: () => calls.push('close'),
    replay: () => calls.push('replay'),
    skip: () => calls.push('skip'),
    speed: (d) => calls.push(`speed${d}`),
  };
}
const PLAYING: PlaybackContext = { aside: false, playing: true, parts: 3, popover: false };
const key = (k: string, o: Partial<KeyboardEvent> & { target?: EventTarget | null } = {}) =>
  ({ key: k, shiftKey: false, metaKey: false, ctrlKey: false, altKey: false, defaultPrevented: false, target: document.body, ...o });

describe('playback keys', () => {
  it('Space pauses/resumes, R replays, ←/→ step parts, Shift+←/→ step sentences, < > change speed', () => {
    const h = handlers();
    for (const [k, shift] of [[' ', false], ['r', false], ['ArrowLeft', false], ['ArrowRight', false], ['ArrowLeft', true], ['ArrowRight', true], ['<', true], ['>', true]] as const) {
      expect(playbackKey(key(k, { shiftKey: shift }), PLAYING, h)).toBe(true);
    }
    expect(h.calls).toEqual(['pause', 'replay', 'part-1', 'part1', 'replay', 'skip', 'speed-1', 'speed1']);
  });

  it('never fires while typing in an input, textarea, select or contenteditable', () => {
    const h = handlers();
    const input = document.createElement('input');
    const area = document.createElement('textarea');
    const sel = document.createElement('select');
    const editable = document.createElement('div');
    editable.contentEditable = 'true';
    Object.defineProperty(editable, 'isContentEditable', { value: true });
    for (const t of [input, area, sel, editable]) for (const k of [' ', 'r', 'ArrowLeft', '>']) {
      expect(playbackKey(key(k, { target: t }), PLAYING, h)).toBe(false);
    }
    expect(h.calls).toEqual([]);
  });

  it('leaves Shift+R to Report, modified keys to the browser, and does nothing when no answer plays', () => {
    const h = handlers();
    expect(playbackKey(key('R', { shiftKey: true }), PLAYING, h)).toBe(false);
    expect(playbackKey(key(' ', { metaKey: true }), PLAYING, h)).toBe(false);
    expect(playbackKey(key('r', { ctrlKey: true }), PLAYING, h)).toBe(false);
    expect(playbackKey(key(' ', { defaultPrevented: true }), PLAYING, h)).toBe(false);
    expect(playbackKey(key(' '), { ...PLAYING, playing: false }, h)).toBe(false);
    expect(playbackKey(key(' '), { ...PLAYING, popover: true }, h)).toBe(false);
    expect(h.calls).toEqual([]);
  });

  it('←/→ belong to the slides when the answer has one part (Shift+←/→ still step sentences)', () => {
    const h = handlers();
    const one = { ...PLAYING, parts: 1 };
    expect(playbackKey(key('ArrowRight'), one, h)).toBe(false);
    expect(playbackKey(key('ArrowRight', { shiftKey: true }), one, h)).toBe(true);
    expect(h.calls).toEqual(['skip']);
  });

  it('with an aside open, Esc (even from the bar) and Return close it; ←/→ do not step the paused answer', () => {
    const h = handlers();
    const aside = { ...PLAYING, aside: true };
    expect(playbackKey(key('Escape', { target: document.createElement('input') }), aside, h)).toBe(true);
    expect(playbackKey(key('Enter'), aside, h)).toBe(true);
    expect(playbackKey(key('Enter', { target: document.createElement('input') }), aside, h)).toBe(false);
    expect(playbackKey(key('ArrowRight'), aside, h)).toBe(false);
    expect(playbackKey(key(' '), aside, h)).toBe(true);
    expect(playbackKey(key('Escape'), PLAYING, h)).toBe(false);
    expect(h.calls).toEqual(['close', 'close', 'pause']);
  });
});

describe('PartsBar', () => {
  let host: HTMLDivElement, root: Root;
  beforeEach(() => { host = document.createElement('div'); document.body.append(host); root = createRoot(host); });
  afterEach(() => { act(() => root.unmount()); host.remove(); });

  const view = (o: Partial<PartsView> = {}): PartsView => ({
    titles: ['Elasticity Changes Along a Straight Line', 'The Law of Demand', 'Back to p9'], current: 1, progress: 0.4,
    paused: false, speed: 1, onJump: vi.fn(), onTogglePause: vi.fn(), onReplay: vi.fn(), onSpeed: vi.fn(), onStop: vi.fn(), ...o,
  });
  const render = (v: PartsView) => act(() => root.render(createElement(PartsBar, v)));

  it('one marker style per state: done, current (with its progress), upcoming', () => {
    render(view());
    const segs = [...host.querySelectorAll<HTMLButtonElement>('.pb-seg')];
    expect(segs.map((s) => s.className.split(' ')[1])).toEqual(['is-done', 'is-current', 'is-next']);
    expect(segs[1].getAttribute('aria-current')).toBe('step');
    const fills = [...host.querySelectorAll<HTMLElement>('.pb-fill')].map((f) => f.style.transform);
    expect(fills).toEqual(['scaleX(1)', 'scaleX(0.4)', 'scaleX(0)']);
  });

  it('shows the current part\'s title and count; hovering or focusing a segment previews its full title', () => {
    render(view());
    expect(host.querySelector('.pb-count')!.textContent).toBe('2/3');
    expect(host.querySelector('.pb-title')!.textContent).toBe('The Law of Demand');
    const first = host.querySelectorAll<HTMLButtonElement>('.pb-seg')[0];
    expect(first.getAttribute('aria-label')).toBe('Part 1 of 3: Elasticity Changes Along a Straight Line');
    act(() => { first.focus(); });
    expect(host.querySelector('.pb-title')!.textContent).toBe('Elasticity Changes Along a Straight Line');
    expect(host.querySelector('.pb-title')!.getAttribute('title')).toBe('Elasticity Changes Along a Straight Line');
    expect(host.querySelector('.pb-count')!.textContent).toBe('1/3');
    act(() => { first.blur(); });
    expect(host.querySelector('.pb-title')!.textContent).toBe('The Law of Demand');
  });

  it('a one-part answer has no rail: the question fills the title slot', () => {
    render(view({ titles: [], label: 'Why does elasticity change?' }));
    expect(host.querySelector('.pb-rail')).toBeNull();
    expect(host.querySelector('.pb-count')).toBeNull();
    expect(host.querySelector('.pb-title')!.textContent).toBe('Why does elasticity change?');
  });

  it('buttons run their commands; speed shows its label', () => {
    const v = view({ speed: 1.25, paused: true });
    render(v);
    const btn = (label: RegExp) => [...host.querySelectorAll('button')].find((b) => label.test(b.getAttribute('aria-label') ?? ''))!;
    act(() => btn(/^Resume/).click());
    act(() => btn(/^Replay/).click());
    act(() => btn(/^Speed/).click());
    act(() => btn(/^Stop/).click());
    act(() => (host.querySelectorAll('.pb-seg')[2] as HTMLButtonElement).click());
    expect(v.onTogglePause).toHaveBeenCalled();
    expect(v.onReplay).toHaveBeenCalled();
    expect(v.onSpeed).toHaveBeenCalled();
    expect(v.onStop).toHaveBeenCalled();
    expect(v.onJump).toHaveBeenCalledWith(2);
    expect(host.querySelector('.pb-speed')!.textContent).toBe('1.25×');
    expect(speedLabel(0.75)).toBe('0.75×');
  });
});

describe('B1: the dock in its moments', () => {
  let host: HTMLDivElement, root: Root;
  beforeEach(() => { host = document.createElement('div'); document.body.append(host); root = createRoot(host); });
  // jsdom has no ResizeObserver; the caption only needs one to measure its reading window.
  beforeEach(() => { vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} }); });
  afterEach(() => { vi.unstubAllGlobals(); });
  afterEach(() => { act(() => root.unmount()); host.remove(); });

  it('a finished aside: nothing left to pause or replay, only the way back', () => {
    const base = { titles: [], label: 'Why?', current: 0, progress: 1, speed: 1, onJump: vi.fn(), onTogglePause: vi.fn(), onReplay: vi.fn(), onSpeed: vi.fn(), onStop: vi.fn() };
    act(() => root.render(createElement(PartsBar, { ...base, paused: false, aside: { onResume: vi.fn(), done: true } })));
    expect(host.querySelector('.pb-more')).toBeNull();
    expect(host.querySelector('.pb-resume')).not.toBeNull();
  });

  it('an aside: a quiet strip, "Side question" and "Back to answer" (return key icon); its controls fold away, no stop', () => {
    const base = { titles: ['One', 'Two', 'Three', 'Four'], label: 'Why?', current: 3, progress: 0.5, speed: 1.25, onJump: vi.fn(), onTogglePause: vi.fn(), onReplay: vi.fn(), onSpeed: vi.fn(), onStop: vi.fn() };
    const onResume = vi.fn();
    act(() => root.render(createElement(PartsBar, { ...base, paused: true, aside: { onResume } })));
    const pb = host.querySelector('.pb')!;
    expect(pb.classList.contains('is-aside')).toBe(true);
    expect(pb.getAttribute('aria-label')).toBe('Side question playback');
    expect(host.querySelector('.pb-side')!.textContent).toBe('Side question');
    // Nothing of the paused answer: no tag, no "n/N", no title, no rail, no stop.
    for (const sel of ['.pb-aside', '.pb-where', '.pb-count', '.pb-rail', '.pb-stop']) expect(host.querySelector(sel)).toBeNull();
    expect(pb.textContent).not.toMatch(/paused|4\/4|Aside/);
    // Pause, replay and speed sit in the fold (shown on hover / focus-within), still buttons Tab reaches; Back stays out of it, last.
    const more = [...host.querySelectorAll<HTMLButtonElement>('.pb-more button')].map((b) => b.getAttribute('aria-label'));
    expect(more).toEqual(['Resume (Space)', 'Replay this sentence (R)', 'Speed 1.25×; change speed (< >)']);
    const buttons = [...pb.querySelectorAll('button')];
    expect(buttons.map((b) => b.getAttribute('tabindex'))).toEqual(['0', '0', '0', '0']); // Safari tabs to them too
    const back = host.querySelector<HTMLButtonElement>('.pb-resume')!;
    expect(buttons.at(-1)).toBe(back);
    expect(back.closest('.pb-more')).toBeNull();
    expect(back.textContent).toBe('Back to answer ');
    expect(back.querySelector('svg')).not.toBeNull();
    act(() => back.click());
    act(() => host.querySelector<HTMLButtonElement>('.pb-play')!.click());
    expect(onResume).toHaveBeenCalledOnce();
    expect(base.onTogglePause).toHaveBeenCalledOnce();
    expect(pb.classList.contains('is-paused')).toBe(true);
    act(() => root.render(createElement(PartsBar, { ...base, titles: [], paused: true })));
    expect(host.querySelector('.pb')!.classList.contains('is-paused')).toBe(true);
    expect(host.querySelector('.pb-title')!.textContent).toBe('Paused');
  });

  it('an aside offers "Answer instead" before the way back: the student overrides the route (src/agent/route.ts)', () => {
    const base = { titles: [], label: 'Why?', current: 0, progress: 0, speed: 1, paused: false, onJump: vi.fn(), onTogglePause: vi.fn(), onReplay: vi.fn(), onSpeed: vi.fn(), onStop: vi.fn() };
    const onResume = vi.fn(), onInstead = vi.fn();
    act(() => root.render(createElement(PartsBar, { ...base, aside: { onResume, onInstead } })));
    const instead = host.querySelector<HTMLButtonElement>('.pb-instead')!;
    expect(instead.textContent).toBe('Answer instead');
    expect(instead.closest('.pb-more')).toBeNull(); // always shown, not folded away
    const buttons = [...host.querySelectorAll('.pb button')];
    expect(buttons.at(-2)).toBe(instead);
    expect(buttons.at(-1)).toBe(host.querySelector('.pb-resume'));
    act(() => instead.click());
    expect(onInstead).toHaveBeenCalledOnce();
    expect(onResume).not.toHaveBeenCalled();
    // Without it (no handler), the strip is as before.
    act(() => root.render(createElement(PartsBar, { ...base, aside: { onResume } })));
    expect(host.querySelector('.pb-instead')).toBeNull();
  });

  it('an aside never echoes its question in the dock: the caption shows the strip and the narration only', () => {
    const parts: PartsView = { titles: [], label: 'Why?', current: 0, progress: 0, paused: false, speed: 1, onJump: vi.fn(), onTogglePause: vi.fn(), onReplay: vi.fn(), onSpeed: vi.fn(), onStop: vi.fn(), aside: { onResume: vi.fn() } };
    const question = 'Get. How you set up the arrows and the gradients. Like I think I need a basic understanding';
    // Before its first word (the moment the echo used to show) and once it speaks a sentence.
    for (const words of [[], ['Think', 'of', 'brightness', 'as', 'height.']]) {
      act(() => root.render(createElement(Caption, { words, visible: true, question, waiting: !words.length, parts })));
      expect(host.querySelector('.caption-q')).toBeNull();
      expect(host.querySelector('.caption')!.textContent).not.toContain('arrows');
      expect(host.querySelector('.pb-side')!.textContent).toBe('Side question');
    }
  });

  it('F01: an opened check question stays pinned ("Test yourself: …") once the narration has gone; × puts it away', () => {
    const onDismissCheck = vi.fn();
    act(() => root.render(createElement(Caption, { words: [], visible: false, check: 'Would a ceiling of $650 bind?', onDismissCheck })));
    expect(host.querySelector('.caption')!.classList.contains('is-visible')).toBe(true);
    expect(host.querySelector('.caption-check')!.textContent).toBe('Test yourself:Would a ceiling of $650 bind?');
    act(() => host.querySelector<HTMLButtonElement>('.caption-check-x')!.click());
    expect(onDismissCheck).toHaveBeenCalledOnce();
  });

  it('p6.2: the answer offers its check as a quiet "Test yourself" chip; opening it is the caller\'s (the bar then takes the answer)', () => {
    const onTestYourself = vi.fn();
    act(() => root.render(createElement(AskBar, { onAsk: vi.fn(), onStop: vi.fn(), busy: false, mode: 'follow', onTestYourself })));
    const chip = host.querySelector<HTMLButtonElement>('.askbar-test')!;
    expect(chip.textContent).toBe('Test yourself');
    expect(host.querySelector('.caption-check')).toBeNull(); // collapsed: the question is not shown
    act(() => chip.click());
    expect(onTestYourself).toHaveBeenCalledOnce();
    // Never while an answer plays, and gone once there is nothing to offer.
    act(() => root.render(createElement(AskBar, { onAsk: vi.fn(), onStop: vi.fn(), busy: true, onTestYourself })));
    expect(host.querySelector('.askbar-test')).toBeNull();
    act(() => root.render(createElement(AskBar, { onAsk: vi.fn(), onStop: vi.fn(), busy: false, mode: 'follow' })));
    expect(host.querySelector('.askbar-test')).toBeNull();
  });

  it('item 4: the transcript opens mid-answer, lights the spoken sentence, seeks on click, and Esc closes it before stopping', () => {
    const onSeek = vi.fn(), onStop = vi.fn();
    const live = (current: number) => ({ question: 'Why upstream?', current, onSeek, sentences: [{ start: 0, words: ['It', 'drifts.'] }, { start: 2, words: ['So', 'aim', 'up.'] }] });
    const bar = (current: number) => createElement(AskBar, { onAsk: vi.fn(), onStop, busy: true, mode: 'during', live: live(current) });
    act(() => root.render(bar(0)));
    const toggle = host.querySelector<HTMLButtonElement>('.askbar-transcript')!;
    expect(toggle.textContent).toBe('Transcript');
    act(() => toggle.click());
    const ss = () => [...host.querySelectorAll<HTMLElement>('.transcript-s')];
    expect(ss().map((e) => e.textContent)).toEqual(['It drifts.', 'So aim up.']);
    expect(ss()[0].classList.contains('is-current')).toBe(true);
    act(() => root.render(bar(1)));
    expect(ss()[1].classList.contains('is-current')).toBe(true);
    expect(ss()[0].classList.contains('is-current')).toBe(false);
    act(() => ss()[0].click());
    expect(onSeek).toHaveBeenCalledWith(0);
    act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', cancelable: true })); });
    expect(host.querySelector('.transcript')).toBeNull();
    expect(onStop).not.toHaveBeenCalled();
    // The answer ends: the same toggle opens the finished answer (and stays open across the change).
    act(() => toggle.click());
    act(() => root.render(createElement(AskBar, { onAsk: vi.fn(), onStop, busy: false, mode: 'follow', transcript: { question: 'Why upstream?', answer: 'It drifts. So aim up.' } })));
    expect(host.querySelector('.transcript-a')!.textContent).toBe('It drifts. So aim up.');
    // A new question closes it.
    act(() => root.render(createElement(AskBar, { onAsk: vi.fn(), onStop, busy: true, mode: 'during', live: { ...live(0), question: 'And downstream?' } })));
    expect(host.querySelector('.transcript')).toBeNull();
  });

  it('F03: the cap is a status row in the bar (wraps), no clipped placeholder; Esc on the pinned check dismisses it', () => {
    const onDismissCheck = vi.fn();
    const line = "Today's answer budget is used up. It resets tomorrow.";
    act(() => root.render(createElement(AskBar, { onAsk: vi.fn(), onStop: vi.fn(), busy: false, blocked: line })));
    expect(host.querySelector('.askbar-status')!.textContent).toBe(line);
    expect(host.querySelector<HTMLTextAreaElement>('.askbar-input')!.hidden).toBe(true);
    act(() => root.render(createElement(AskBar, { onAsk: vi.fn(), onStop: vi.fn(), busy: false, mode: 'check', onDismissCheck })));
    expect(host.querySelector('.askbar-status')).toBeNull();
    act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', cancelable: true })); });
    expect(onDismissCheck).toHaveBeenCalledOnce();
  });
});
