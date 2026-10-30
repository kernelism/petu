// The ask bar's dictation (src/ui/AskBar.tsx with src/agent/dictation.ts mocked): what the mic does to
// the field, the send, the stop button, Esc and the spending-cap block.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { DictationEvents } from '../../src/agent/dictation';

const dict = vi.hoisted(() => ({ ev: null as DictationEvents | null, start: vi.fn(async () => {}), stop: vi.fn(), cancel: vi.fn() }));
vi.mock('../../src/agent/dictation', () => ({
  Dictation: class {
    constructor(ev: DictationEvents) { dict.ev = ev; }
    start = dict.start;
    stop = dict.stop;
    cancel = dict.cancel;
  },
}));
import { AskBar } from '../../src/ui/AskBar';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Props = Parameters<typeof AskBar>[0];
let root: Root | null = null, host: HTMLDivElement | null = null;
afterEach(() => {
  act(() => root?.unmount()); host?.remove(); root = null; host = null; document.body.innerHTML = '';
  dict.ev = null; dict.start.mockClear(); dict.stop.mockClear(); dict.cancel.mockClear();
});
function mount(over: Partial<Props> = {}) {
  const props: Props = { onAsk: vi.fn(), onStop: vi.fn(), busy: false, ...over };
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root!.render(createElement(AskBar, props)));
  const input = host.querySelector('input')!;
  const mic = () => host!.querySelector<HTMLButtonElement>('.askbar-mic');
  return {
    props, input, mic,
    rerender: (more: Partial<Props>) => { Object.assign(props, more); act(() => root!.render(createElement(AskBar, { ...props }))); },
    clickMic: () => act(() => { mic()!.click(); }),
    heard: (t: string) => act(() => dict.ev!.onText(t)),
    end: (r: Parameters<DictationEvents['onEnd']>[0]) => act(() => dict.ev!.onEnd(r)),
    key: (el: Element, key: string) => act(() => { el.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })); }),
    type: (v: string) => act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, v);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }),
  };
}

describe('AskBar dictation', () => {
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
    expect(b.input.placeholder).toBe('Spending cap reached');
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
});
