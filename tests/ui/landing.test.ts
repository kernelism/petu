// The landing (src/ui/EmptyState.tsx, no PDF open): Open a PDF through the hidden input, a dropped
// or picked non-PDF answered on the error line, the sample deck, window-level drop with its veil.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { EmptyState } from '../../src/ui/EmptyState';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null, host: HTMLDivElement | null = null;
afterEach(() => { act(() => root?.unmount()); host?.remove(); root = null; host = null; document.body.innerHTML = ''; vi.restoreAllMocks(); });
function mount(error?: string) {
  const onFile = vi.fn(), onSample = vi.fn();
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root!.render(createElement(EmptyState, { onFile, onSample, error })));
  const h = host;
  const input = h.querySelector('input[type=file]') as HTMLInputElement;
  const button = (name: string) => Array.from(h.querySelectorAll('button')).find((b) => b.textContent?.trim() === name)!;
  return { h, onFile, onSample, input, button, alert: () => h.querySelector('[role=alert]')!.textContent };
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
  it('Open a PDF opens the hidden file picker; the two actions come first in tab order, the input never', () => {
    const { input, button, h } = mount();
    const click = vi.spyOn(input, 'click').mockImplementation(() => {});
    act(() => button('Open a PDF').click());
    expect(click).toHaveBeenCalledOnce();
    expect(input.hidden).toBe(true);
    expect(input.accept).toBe('application/pdf');
    expect(Array.from(h.querySelectorAll('button')).map((b) => b.textContent?.trim())).toEqual(['Open a PDF', 'Try the sample deck']);
  });
  it('a picked PDF opens; a picked non-PDF is answered on the error line and opens nothing', () => {
    const { input, onFile, alert } = mount();
    pick(input, txt());
    expect(onFile).not.toHaveBeenCalled();
    expect(alert()).toBe("That doesn't look like a PDF.");
    const f = pdf();
    pick(input, f);
    expect(onFile).toHaveBeenCalledWith(f);
    expect(alert()).toBe('');
  });
  it('the picker is reset after each pick (the same file can be picked again)', () => {
    const { input } = mount();
    const set = vi.fn();
    Object.defineProperty(input, 'value', { set, get: () => '', configurable: true });
    pick(input, pdf());
    expect(set).toHaveBeenCalledWith('');
  });
  it('Try the sample deck asks for the sample', () => {
    const { button, onSample } = mount();
    act(() => button('Try the sample deck').click());
    expect(onSample).toHaveBeenCalledOnce();
  });
  it('a load error from the app shows on the same line', () => {
    expect(mount('Could not open that PDF.').alert()).toBe('Could not open that PDF.');
  });
  it('a file dragged over the window raises the veil; dropping a non-PDF lowers it and says so', () => {
    const { h, onFile, alert } = mount();
    drag('dragenter');
    expect(h.querySelector('.empty')!.classList.contains('is-dragging')).toBe(true);
    expect(h.querySelector('.dropveil')!.classList.contains('is-visible')).toBe(true);
    drag('drop', txt());
    expect(h.querySelector('.dropveil')!.classList.contains('is-visible')).toBe(false);
    expect(onFile).not.toHaveBeenCalled();
    expect(alert()).toBe("That doesn't look like a PDF.");
  });
  it('a PDF dropped anywhere on the page opens', () => {
    const { onFile } = mount();
    const f = pdf();
    drag('dragenter');
    drag('drop', f);
    expect(onFile).toHaveBeenCalledWith(f);
  });
});
