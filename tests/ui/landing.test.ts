// The landing (src/ui/EmptyState.tsx + the lazy src/ui/landing/Landing.tsx, no PDF open): every "Start
// with your notes" and the drop zone open the hidden file picker, a dropped or picked non-PDF is answered
// on the error line, the sample lecture, window-level drop with its veil, and unmounting the landing
// (opening a PDF) leaves no timer, observer or listener behind.
import { describe, it, expect, vi, afterEach, beforeAll } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { EmptyState } from '../../src/ui/EmptyState';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// Warm the lazy chunk once so each mount resolves it within act().
beforeAll(async () => { await import('../../src/ui/landing/Landing'); });

let root: Root | null = null, host: HTMLDivElement | null = null;
afterEach(() => {
  act(() => root?.unmount());
  host?.remove(); root = null; host = null; document.body.innerHTML = '';
  vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers();
});
const flush = async () => { for (let i = 0; i < 5; i++) await act(async () => { await Promise.resolve(); }); };
async function mount(error?: string) {
  const onFile = vi.fn(), onSample = vi.fn();
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root!.render(createElement(EmptyState, { onFile, onSample, error })));
  await flush();
  const h = host;
  expect(h.querySelector('.pl')).not.toBeNull();
  const input = h.querySelector('input[type=file]') as HTMLInputElement;
  const buttons = (name: string) => Array.from(h.querySelectorAll('button')).filter((b) => b.textContent?.trim() === name);
  return { h, onFile, onSample, input, buttons, alert: () => h.querySelector('[role=alert]')!.textContent };
}
const pdf = () => new File(['%PDF-1.4'], 'slides.pdf', { type: 'application/pdf' });
const txt = () => new File(['hi'], 'notes.txt', { type: 'text/plain' });
const pick = (input: HTMLInputElement, f: File) => act(() => {
  Object.defineProperty(input, 'files', { value: [f], configurable: true });
  input.dispatchEvent(new Event('change', { bubbles: true }));
});
// jsdom has no DragEvent: a plain event carrying a dataTransfer.
const drag = (type: string, f?: File) => act(() => {
  const e = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(e, 'dataTransfer', { value: { types: ['Files'], files: f ? [f] : [], dropEffect: 'none' } });
  window.dispatchEvent(e);
});

describe('the landing', () => {
  it('every Start with your notes and the drop zone open the hidden PDF picker', async () => {
    const { input, buttons, h } = await mount();
    const click = vi.spyOn(input, 'click').mockImplementation(() => {});
    const starts = buttons('Start with your notes');
    expect(starts).toHaveLength(3); // nav, hero, close
    starts.forEach((b) => act(() => b.click()));
    act(() => (h.querySelector('.pl-drop') as HTMLButtonElement).click());
    expect(click).toHaveBeenCalledTimes(4);
    expect(input.hidden).toBe(true);
    expect(input.accept).toBe('application/pdf');
  });
  it('a picked PDF opens; a picked non-PDF is answered on the error line and opens nothing', async () => {
    const { input, onFile, alert } = await mount();
    pick(input, txt());
    expect(onFile).not.toHaveBeenCalled();
    expect(alert()).toBe("That doesn't look like a PDF.");
    const f = pdf();
    pick(input, f);
    expect(onFile).toHaveBeenCalledWith(f);
    expect(alert()).toBe('');
  });
  it('the picker is reset after each pick (the same file can be picked again)', async () => {
    const { input } = await mount();
    const set = vi.fn();
    Object.defineProperty(input, 'value', { set, get: () => '', configurable: true });
    pick(input, pdf());
    expect(set).toHaveBeenCalledWith('');
  });
  it('Try a sample lecture asks for the sample', async () => {
    const { buttons, onSample } = await mount();
    act(() => buttons('Try a sample lecture')[0].click());
    expect(onSample).toHaveBeenCalledOnce();
  });
  it('a load error from the app shows on the error line', async () => {
    expect((await mount('Could not open that PDF.')).alert()).toBe('Could not open that PDF.');
  });
  it('a file dragged over the window raises the veil; dropping a non-PDF lowers it and says so', async () => {
    const { h, onFile, alert } = await mount();
    drag('dragenter');
    expect(h.querySelector('.landing')!.classList.contains('is-dragging')).toBe(true);
    expect(h.querySelector('.dropveil')!.classList.contains('is-visible')).toBe(true);
    drag('drop', txt());
    expect(h.querySelector('.dropveil')!.classList.contains('is-visible')).toBe(false);
    expect(onFile).not.toHaveBeenCalled();
    expect(alert()).toBe("That doesn't look like a PDF.");
  });
  it('a PDF dropped anywhere on the page opens', async () => {
    const { onFile } = await mount();
    const f = pdf();
    drag('dragenter');
    drag('drop', f);
    expect(onFile).toHaveBeenCalledWith(f);
  });
  it('the lesson is decorative motion with a text alternative', async () => {
    const { h } = await mount();
    const stage = h.querySelector('[data-pl="hero-stage"]')!;
    expect(stage.getAttribute('role')).toBe('img');
    expect(stage.getAttribute('aria-label')).toMatch(/divides by 2/);
    expect(stage.querySelector('.pl-stage')).not.toBeNull();
  });
  it('unmounting the landing clears its timers, observer and listeners', async () => {
    const disconnect = vi.fn();
    vi.stubGlobal('IntersectionObserver', class { observe() {} disconnect() { disconnect(); } });
    vi.useFakeTimers();
    const added = vi.spyOn(window, 'addEventListener'), removed = vi.spyOn(window, 'removeEventListener');
    const { h } = await mount();
    await flush();
    expect(vi.getTimerCount()).toBeGreaterThan(0); // the swash and the hero lesson are scheduled
    vi.advanceTimersByTime(3000);
    expect(h.querySelector('.pl-dock .pl-t')!.textContent).not.toBe('Ask about this…'); // the question is being typed
    expect(document.documentElement.classList.contains('pl-page')).toBe(true);
    act(() => root!.unmount()); root = null;
    expect(vi.getTimerCount()).toBe(0);
    expect(disconnect).toHaveBeenCalled();
    const kinds = ['scroll', 'resize'];
    for (const k of kinds) {
      const a = added.mock.calls.filter((c) => c[0] === k).length, r = removed.mock.calls.filter((c) => c[0] === k).length;
      expect(r).toBe(a);
    }
    expect(document.documentElement.classList.contains('pl-page')).toBe(false);
  });
});
