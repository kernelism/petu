// The ask bar's dictation (src/ui/AskBar.tsx with src/agent/dictation.ts mocked): what the mic does to
// the field, the send, the stop button, Esc and the spending-cap block.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { DictationEvents } from '../../src/agent/dictation';

const dict = vi.hoisted(() => ({ ev: null as DictationEvents | null, start: vi.fn(async () => {}), stop: vi.fn(), cancel: vi.fn(), hold: vi.fn() }));
vi.mock('../../src/agent/dictation', () => ({
  Dictation: class {
    constructor(ev: DictationEvents) { dict.ev = ev; }
    start = dict.start;
    stop = dict.stop;
    cancel = dict.cancel;
    hold = dict.hold;
  },
}));
import { AskBar } from '../../src/ui/AskBar';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Props = Parameters<typeof AskBar>[0];
let root: Root | null = null, host: HTMLDivElement | null = null;
afterEach(() => {
  act(() => root?.unmount()); host?.remove(); root = null; host = null; document.body.innerHTML = '';
  dict.ev = null; dict.start.mockClear(); dict.stop.mockClear(); dict.cancel.mockClear(); dict.hold.mockClear();
  vi.restoreAllMocks();
});
function mount(over: Partial<Props> = {}) {
  const props: Props = { onAsk: vi.fn(), onStop: vi.fn(), busy: false, ...over };
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root!.render(createElement(AskBar, props)));
  const input = host.querySelector('textarea')!;
  const mic = () => host!.querySelector<HTMLButtonElement>('.askbar-mic');
  return {
    props, input, mic,
    rerender: (more: Partial<Props>) => { Object.assign(props, more); act(() => root!.render(createElement(AskBar, { ...props }))); },
    clickMic: () => act(() => { mic()!.click(); }),
    heard: (t: string) => act(() => dict.ev!.onText(t)),
    end: (r: Parameters<DictationEvents['onEnd']>[0]) => act(() => dict.ev!.onEnd(r)),
    key: (el: Element, key: string) => act(() => { el.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })); }),
    type: (v: string) => act(() => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(input, v);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }),
  };
}

describe('AskBar dictation', () => {
  it('no mic when dictation is not set up on the server (no SPEECHMATICS_API_KEY)', () => {
    const b = mount({ dictation: false });
    expect(b.mic()).toBeNull();
    expect(dict.start).not.toHaveBeenCalled();
  });
  it('fills the field as the student speaks and sends at the pause', () => {
    const b = mount();
    b.clickMic();
    expect(dict.start).toHaveBeenCalledTimes(1);
    expect(b.input.placeholder).toBe('Listening…');
    b.heard('what is elasticity');
    expect(b.input.value).toBe('what is elasticity');
    b.end({ text: 'what is elasticity', auto: true });
    expect(b.props.onAsk).toHaveBeenCalledWith('what is elasticity');
    expect(b.input.value).toBe('');
  });

  it('Enter while listening sends once: dictation is dropped, not sent again', () => {
    const b = mount();
    b.clickMic();
    b.heard('what is elasticity');
    b.key(b.input, 'Enter');
    expect(b.props.onAsk).toHaveBeenCalledTimes(1);
    expect(dict.cancel).toHaveBeenCalled();
    b.heard('what is elasticity');
    b.end({ text: 'what is elasticity', auto: true });
    expect(b.props.onAsk).toHaveBeenCalledTimes(1);
    expect(b.input.value).toBe('');
  });

  it('typing while listening takes over the field', () => {
    const b = mount();
    b.clickMic();
    b.heard('what is');
    b.type('what is a demand curve');
    expect(dict.cancel).toHaveBeenCalled();
    b.heard('what is elastic');
    b.end({ text: 'what is elastic', auto: true });
    expect(b.input.value).toBe('what is a demand curve');
    expect(b.props.onAsk).not.toHaveBeenCalled();
  });

  it('the spending cap drops a dictation in progress: nothing is sent', () => {
    const b = mount();
    b.clickMic();
    b.heard('why');
    b.rerender({ blocked: 'Spending cap reached' });
    expect(dict.cancel).toHaveBeenCalled();
    b.heard('why');
    b.end({ text: 'why', auto: true });
    expect(b.props.onAsk).not.toHaveBeenCalled();
    expect(b.input.value).toBe('');
    // B1 F03: the cap line shows as a status row in the field's place (the field is hidden).
    expect(b.input.hidden).toBe(true);
    expect(b.input.closest('.askbar')!.querySelector('.askbar-status')!.textContent).toBe('Spending cap reached');
  });

  it('an error mid-question puts what was heard back in the field with the note: nothing is sent', () => {
    const b = mount();
    b.clickMic();
    b.heard('why does the demand');
    b.end({ text: 'why does the demand', auto: false, error: 'Dictation lost its connection.' });
    expect(b.props.onAsk).not.toHaveBeenCalled();
    expect(b.input.value).toBe('why does the demand');
    expect(b.input.title).toBe('Dictation lost its connection.');
    b.key(b.input, 'Enter');
    expect(b.props.onAsk).toHaveBeenCalledWith('why does the demand');
  });

  it('an error before anything was heard shows in the placeholder', () => {
    const b = mount();
    b.clickMic();
    b.end({ text: '', auto: false, error: 'Microphone access was blocked.' });
    expect(b.input.placeholder).toBe('Microphone access was blocked.');
    expect(b.props.onAsk).not.toHaveBeenCalled();
  });

  it('Esc on the mic button drops the dictation, and does not stop the answer', () => {
    const b = mount({ busy: true });
    b.clickMic();
    b.mic()!.focus();
    b.key(b.mic()!, 'Escape');
    expect(dict.cancel).toHaveBeenCalled();
    expect(b.props.onStop).not.toHaveBeenCalled();
    expect(b.input.placeholder).not.toBe('Listening…');
    b.key(b.mic()!, 'Escape');
    expect(b.props.onStop).toHaveBeenCalledTimes(1); // not listening: Esc stops the answer again
  });

  it('the stop-answer button stays while listening during an answer', () => {
    const b = mount({ busy: true, showStop: true });
    b.clickMic();
    expect(host!.querySelector('[aria-label="Stop answer"]')).not.toBeNull();
    b.heard('and why');
    expect(host!.querySelector('[aria-label="Stop answer"]')).not.toBeNull();
  });

  it('the mic again stops (once: a double click does not start a second dictation); its end sends', () => {
    const b = mount();
    b.clickMic();
    b.heard('what is');
    b.clickMic();
    expect(dict.stop).toHaveBeenCalledTimes(1);
    expect(dict.start).toHaveBeenCalledTimes(1);
    b.end({ text: 'what is elasticity', auto: false });
    expect(b.props.onAsk).toHaveBeenCalledWith('what is elasticity');
    expect(b.input.placeholder).not.toBe('Listening…');
  });

  it('Esc in the field drops what was heard; unmounting cancels the dictation', () => {
    const b = mount();
    b.clickMic();
    b.heard('oops');
    b.key(b.input, 'Escape');
    expect(dict.cancel).toHaveBeenCalledTimes(1);
    expect(b.input.value).toBe('');
    b.clickMic();
    act(() => root!.unmount());
    root = null;
    expect(dict.cancel).toHaveBeenCalledTimes(2);
  });
});

describe('AskBar: the pause countdown, the V shortcut, a field that grows', () => {
  const winKey = (key: string, type: 'keydown' | 'keyup' = 'keydown', o: KeyboardEventInit = {}) =>
    act(() => { document.body.dispatchEvent(new KeyboardEvent(type, { key, bubbles: true, cancelable: true, ...o })); });

  it('a pause shows "Sending…" until it sends; a key holds it (listening goes on); the send clears it', () => {
    const b = mount();
    b.clickMic();
    b.heard('why does the curve bend');
    act(() => dict.ev!.onCountdown!(1000));
    const sending = host!.querySelector('.askbar-sending');
    expect(sending?.textContent).toBe('Sending…');
    expect(sending?.getAttribute('role')).toBe('status');
    winKey('ArrowDown');
    expect(dict.hold).toHaveBeenCalledTimes(1);
    act(() => dict.ev!.onCountdown!(null));
    expect(host!.querySelector('.askbar-sending')).toBeNull();
    act(() => dict.ev!.onCountdown!(1000));
    b.end({ text: 'why does the curve bend down', auto: true });
    expect(host!.querySelector('.askbar-sending')).toBeNull();
    expect(b.props.onAsk).toHaveBeenCalledWith('why does the curve bend down');
  });

  it('Enter outside the field sends at once while listening; Esc outside drops it without stopping the answer', () => {
    const b = mount({ busy: true });
    b.clickMic();
    b.heard('and the tax');
    winKey('Enter');
    expect(dict.stop).toHaveBeenCalledTimes(1);
    b.end({ text: 'and the tax', auto: false });
    b.clickMic();
    winKey('Escape');
    expect(dict.cancel).toHaveBeenCalledTimes(1);
    expect(b.props.onStop).not.toHaveBeenCalled();
  });

  it('V taps start and stop (stop sends); typing V in the field types', () => {
    const b = mount();
    winKey('v');
    expect(dict.start).toHaveBeenCalledTimes(1);
    winKey('v', 'keyup');
    expect(dict.stop).not.toHaveBeenCalled(); // a tap: still listening
    b.heard('what is elasticity');
    winKey('v');
    expect(dict.stop).toHaveBeenCalledTimes(1);
    winKey('v', 'keyup');
    b.end({ text: 'what is elasticity', auto: false });
    expect(b.props.onAsk).toHaveBeenCalledWith('what is elasticity');
    act(() => { b.input.dispatchEvent(new KeyboardEvent('keydown', { key: 'v', bubbles: true, cancelable: true })); });
    expect(dict.start).toHaveBeenCalledTimes(1);
  });

  it('holding V is hold-to-talk: the release sends', () => {
    let t = 1000;
    vi.spyOn(performance, 'now').mockImplementation(() => t);
    mount();
    winKey('v');
    winKey('v', 'keydown', { repeat: true });
    expect(dict.start).toHaveBeenCalledTimes(1);
    t += 900;
    winKey('v', 'keyup');
    expect(dict.stop).toHaveBeenCalledTimes(1);
  });

  it('V mid-answer pauses the answer and listens; the spoken question goes the usual way (onAsk: an aside)', () => {
    const onTyping = vi.fn();
    const b = mount({ busy: true, onTyping });
    winKey('v');
    expect(onTyping).toHaveBeenLastCalledWith(true);
    expect(dict.start).toHaveBeenCalledTimes(1);
    b.heard('wait why');
    b.end({ text: 'wait why is it seven', auto: true });
    expect(b.props.onAsk).toHaveBeenCalledWith('wait why is it seven');
  });

  it('V mid-answer, then dropped: the answer resumes', () => {
    const onTyping = vi.fn();
    mount({ busy: true, onTyping });
    winKey('v');
    winKey('Escape');
    expect(onTyping.mock.calls.map((c) => c[0])).toEqual([true, false]);
  });

  it('without dictation set up, V only shows a short note', () => {
    const b = mount({ dictation: false });
    winKey('v');
    expect(dict.start).not.toHaveBeenCalled();
    expect(b.input.placeholder).toMatch(/not set up/);
  });

  it('the field grows with the question to five lines, then scrolls (newest words in view); it shrinks back once sent', () => {
    const b = mount();
    let lines = 1;
    Object.defineProperty(b.input, 'scrollHeight', { configurable: true, get: () => lines * 22 });
    lines = 3; b.type('a question long enough to wrap onto three lines of the bar');
    expect(b.input.style.height).toBe('66px');
    expect(b.input.style.overflowY).toBe('hidden');
    expect(host!.querySelector('.askbar')!.classList.contains('is-tall')).toBe(true);
    lines = 8; b.type('a very long question '.repeat(20));
    expect(b.input.style.height).toBe('110px');
    expect(b.input.style.overflowY).toBe('auto');
    b.key(b.input, 'Enter');
    lines = 1;
    expect(b.input.value).toBe('');
    expect(b.input.style.height).toBe('22px');
    expect(host!.querySelector('.askbar')!.classList.contains('is-tall')).toBe(false);
  });

  it('dictated words keep the field scrolled to its end', () => {
    const b = mount();
    Object.defineProperty(b.input, 'scrollHeight', { configurable: true, get: () => 9 * 22 });
    b.clickMic();
    b.heard('a long dictated question '.repeat(30));
    expect(b.input.scrollTop).toBe(9 * 22);
  });
});

// QA M1: after Enter the field kept focus, so Space, < >, D, S, Z, M and ⌘± typed into it (pausing the
// answer as an aside draft and leaking ">", "/" or "d" into the next question).
import { playbackKey, draftHeld } from '../../src/ui/playbackKeys';
import { overviewKey, boardZoomKey } from '../../src/ui/zoomKeys';
import { keysActive } from '../../src/ui/CanvasToolbar';
import { isGoToPageKey } from '../../src/ui/pageNav';

describe('AskBar focus after asking (QA M1)', () => {
  const winKey = (key: string, o: KeyboardEventInit = {}) => {
    const e = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...o });
    act(() => { (document.activeElement ?? document.body).dispatchEvent(e); });
    return e;
  };
  /** The app's playback handler, as App mounts it (capture phase on window). */
  function playback() {
    const calls: string[] = [];
    const h = { togglePause: () => calls.push('pause'), stepPart: () => calls.push('part'), closeAside: () => calls.push('close'), replay: () => calls.push('replay'), skip: () => calls.push('skip'), speed: (d: number) => calls.push(`speed${d}`) };
    const on = (e: KeyboardEvent) => { if (playbackKey(e, { aside: false, playing: true, parts: 2, popover: false }, h)) { e.preventDefault(); e.stopImmediatePropagation(); } };
    window.addEventListener('keydown', on, true);
    return { calls, off: () => window.removeEventListener('keydown', on, true) };
  }
  const ask = (b: ReturnType<typeof mount>, q: string) => { act(() => b.input.focus()); b.type(q); b.key(b.input, 'Enter'); };

  it('Enter sends and focus leaves the field: Space and > act on the answer, nothing lands in the field', () => {
    const p = playback();
    const onTyping = vi.fn();
    const b = mount({ onTyping });
    ask(b, 'I missed this lecture, explain it');
    onTyping.mockClear();
    expect(b.props.onAsk).toHaveBeenCalledWith('I missed this lecture, explain it');
    expect(document.activeElement).not.toBe(b.input);
    b.rerender({ busy: true });
    expect(winKey(' ').defaultPrevented).toBe(true);
    winKey('>');
    expect(p.calls).toEqual(['pause', 'speed1']);
    expect(b.input.value).toBe('');
    expect(onTyping).not.toHaveBeenCalled(); // no aside draft, the answer is not paused by a keystroke
    p.off();
  });

  it('after sending, Z, D, S, M and ⌘± are live (not a typing target, no draft)', () => {
    const b = mount();
    ask(b, 'why a constant factor');
    const t = document.activeElement;
    expect(draftHeld()).toBe(false);
    expect(keysActive(false)).toBe(true);
    expect(overviewKey({ key: 'z', metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, defaultPrevented: false, target: t }, { lane: true, mac: true, popover: false })).toBe('toggle');
    expect(boardZoomKey({ key: '=', metaKey: true, ctrlKey: false, altKey: false, defaultPrevented: false, target: t }, { boardOpen: true, mac: true })).toBe('in');
  });

  it('/ brings the field back; the next question is typed whole ("/" never lands in it)', () => {
    const b = mount();
    ask(b, 'first question');
    const e = winKey('/');
    expect(e.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(b.input);
    expect(b.input.value).toBe('');
  });

  it('a held draft stands every shortcut down, even with the field blurred', () => {
    const p = playback();
    const b = mount({ busy: true });
    act(() => b.input.focus());
    b.type('wait, what does sigma');
    act(() => b.input.blur());
    expect(draftHeld()).toBe(true);
    winKey(' ');
    winKey('>');
    expect(p.calls).toEqual([]);
    expect(keysActive(false)).toBe(false);
    expect(keysActive(true)).toBe(false);
    expect(overviewKey({ key: 'z', metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, defaultPrevented: false, target: document.body }, { lane: true, mac: true, popover: false })).toBeNull();
    expect(boardZoomKey({ key: '=', metaKey: true, ctrlKey: false, altKey: false, defaultPrevented: false, target: document.body }, { boardOpen: true, mac: true })).toBeNull();
    expect(isGoToPageKey({ key: 'g', metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, defaultPrevented: false, target: document.body })).toBe(false);
    // V is a letter of the draft, never a dictation that would replace it.
    winKey('v');
    expect(dict.start).not.toHaveBeenCalled();
    expect(b.input.value).toBe('wait, what does sigma');
    p.off();
  });

  it('a dictated question sent: focus leaves the bar (the mic button), V still starts the next one', () => {
    const b = mount();
    act(() => { b.mic()!.focus(); });
    b.clickMic();
    b.heard('what is elasticity');
    b.end({ text: 'what is elasticity', auto: true });
    expect(b.props.onAsk).toHaveBeenCalledWith('what is elasticity');
    expect(host!.querySelector('.askbar')!.contains(document.activeElement)).toBe(false);
    winKey('v');
    expect(dict.start).toHaveBeenCalledTimes(2);
  });

  it('V while listening still stops (the heard words are not a typed draft)', () => {
    const b = mount();
    winKey('v');
    winKey('v', { repeat: false });
    b.heard('what is');
    act(() => { document.body.dispatchEvent(new KeyboardEvent('keyup', { key: 'v', bubbles: true })); });
    winKey('v');
    expect(dict.stop).toHaveBeenCalled();
  });

  it('the check question: the answer sent, focus leaves the field', () => {
    const b = mount({ mode: 'check', onDismissCheck: vi.fn(), focusSeq: 1 });
    expect(document.activeElement).toBe(b.input);
    b.type('the kernel sums to one');
    b.key(b.input, 'Enter');
    expect(b.props.onAsk).toHaveBeenCalledWith('the kernel sums to one');
    expect(document.activeElement).not.toBe(b.input);
  });

  it('Enter on an empty bar in an aside: back to the answer, focus leaves the field', () => {
    const onResume = vi.fn();
    const b = mount({ busy: true, mode: 'aside', onResume });
    act(() => b.input.focus());
    b.key(b.input, 'Enter');
    expect(onResume).toHaveBeenCalled();
    expect(document.activeElement).not.toBe(b.input);
  });
});
