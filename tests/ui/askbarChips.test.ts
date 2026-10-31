// The ask bar's chips (spec "Student ink"): one per mark since the last question, each removable;
// with a "?" chip, Enter on the empty bar asks "explain this".
import { describe, it, expect, vi, afterEach } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { AskBar, EMPTY_ASK_HINT } from '../../src/ui/AskBar';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
type Props = Parameters<typeof AskBar>[0];
let root: Root | null = null, host: HTMLDivElement | null = null;
afterEach(() => { act(() => root?.unmount()); host?.remove(); root = null; host = null; });
function mount(over: Partial<Props> = {}) {
  const props: Props = { onAsk: vi.fn(), onStop: vi.fn(), busy: false, dictation: false, ...over };
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root!.render(createElement(AskBar, props)));
  const input = host.querySelector('input')!;
  const enter = () => act(() => { input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); });
  return { props, input, enter, chips: () => [...host!.querySelectorAll('.askbar-about-text')].map((e) => e.textContent) };
}

describe('ask bar chips', () => {
  it('shows one chip per mark, "about:" once, and × removes that one', () => {
    const onClearAbout = vi.fn();
    const { chips } = mount({ about: [{ key: 'm1', label: 'your underline · p.88' }, { key: 'm2', label: 'your circle · board' }], onClearAbout });
    expect(chips()).toEqual(['about: your underline · p.88', 'your circle · board']);
    act(() => { host!.querySelectorAll<HTMLButtonElement>('.askbar-about-x')[1].click(); });
    expect(onClearAbout).toHaveBeenCalledWith('m2');
  });

  it('a selection chip keeps its page', () => {
    const { chips } = mount({ about: [{ key: 'sel', label: 'shaded triangle', page: 4 }] });
    expect(chips()).toEqual(['about: shaded triangle · p.4']);
  });

  it('with a "?" chip, Enter on the empty bar asks "explain this"; typed text still wins', () => {
    const onAsk = vi.fn();
    const { input, enter } = mount({ onAsk, emptyAsk: 'Explain this.', about: [{ key: 'm1', label: 'your ? · p.3' }] });
    expect(input.placeholder).toBe(EMPTY_ASK_HINT);
    enter();
    expect(onAsk).toHaveBeenLastCalledWith('Explain this.');
    act(() => { const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!; set.call(input, 'why convex?'); input.dispatchEvent(new Event('input', { bubbles: true })); });
    enter();
    expect(onAsk).toHaveBeenLastCalledWith('why convex?');
  });

  it('without one, Enter on the empty bar sends nothing', () => {
    const onAsk = vi.fn();
    const { enter } = mount({ onAsk });
    enter();
    expect(onAsk).not.toHaveBeenCalled();
  });
});
