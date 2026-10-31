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
  afterEach(() => { act(() => root.unmount()); host.remove(); });

  it('an aside: "Aside" (sentence case) and "Back to answer" with the return key icon; paused one-part answers say so', () => {
    const base = { titles: [], label: 'Why?', current: 0, progress: 0, speed: 1, onJump: vi.fn(), onTogglePause: vi.fn(), onReplay: vi.fn(), onSpeed: vi.fn(), onStop: vi.fn() };
    const onResume = vi.fn();
    act(() => root.render(createElement(PartsBar, { ...base, paused: true, aside: { title: 'Answer paused', onResume } })));
    expect(host.querySelector('.pb-aside')!.textContent).toBe('Aside');
    const back = host.querySelector<HTMLButtonElement>('.pb-resume')!;
    expect(back.textContent).toBe('Back to answer ');
    expect(back.querySelector('svg')).not.toBeNull();
    act(() => back.click());
    expect(onResume).toHaveBeenCalled();
    act(() => root.render(createElement(PartsBar, { ...base, paused: true })));
    expect(host.querySelector('.pb')!.classList.contains('is-paused')).toBe(true);
    expect(host.querySelector('.pb-title')!.textContent).toBe('Paused');
  });

  it('F01: the check question stays pinned ("Check yourself: …") once the narration has gone', () => {
    act(() => root.render(createElement(Caption, { words: [], visible: false, check: 'Would a ceiling of $650 bind?' })));
    expect(host.querySelector('.caption')!.classList.contains('is-visible')).toBe(true);
    expect(host.querySelector('.caption-check')!.textContent).toBe('Check yourself:Would a ceiling of $650 bind?');
  });

  it('F03: the cap is a status row in the bar (wraps), no clipped placeholder; Esc on the pinned check dismisses it', () => {
    const onDismissCheck = vi.fn();
    const line = "Today's answer budget is used up. It resets tomorrow.";
    act(() => root.render(createElement(AskBar, { onAsk: vi.fn(), onStop: vi.fn(), busy: false, blocked: line })));
    expect(host.querySelector('.askbar-status')!.textContent).toBe(line);
    expect(host.querySelector<HTMLInputElement>('.askbar-input')!.hidden).toBe(true);
    act(() => root.render(createElement(AskBar, { onAsk: vi.fn(), onStop: vi.fn(), busy: false, mode: 'check', onDismissCheck })));
    expect(host.querySelector('.askbar-status')).toBeNull();
    act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', cancelable: true })); });
    expect(onDismissCheck).toHaveBeenCalledOnce();
  });
});
