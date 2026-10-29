// The shortcuts card (?) and its key.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { isShortcutsKey, shortcutRows, ShortcutsOverlay } from '../../src/ui/ShortcutsOverlay';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const ev = (key: string, o: Partial<KeyboardEvent> = {}, target: EventTarget | null = document.body) =>
  ({ key, shiftKey: key === '?', metaKey: false, ctrlKey: false, altKey: false, defaultPrevented: false, target, ...o }) as KeyboardEvent;

describe('isShortcutsKey', () => {
  it('is ? (typed with Shift), never with ⌘/Ctrl/Alt or while typing', () => {
    expect(isShortcutsKey(ev('?'))).toBe(true);
    expect(isShortcutsKey(ev('/'))).toBe(false);
    expect(isShortcutsKey(ev('?', { metaKey: true }))).toBe(false);
    expect(isShortcutsKey(ev('?', { ctrlKey: true }))).toBe(false);
    expect(isShortcutsKey(ev('?', { altKey: true }))).toBe(false);
    expect(isShortcutsKey(ev('?', { defaultPrevented: true }))).toBe(false);
    expect(isShortcutsKey(ev('?', {}, document.createElement('textarea')))).toBe(false);
  });
});

describe('shortcutRows', () => {
  const labels = (dev: boolean) => shortcutRows({ dev, mac: true }).flat().map((r) => r.label);
  it('lists Report only on the dev server', () => {
    expect(labels(true)).toContain('Report a problem');
    expect(labels(false)).not.toContain('Report a problem');
  });
  it('uses ⌘ on a Mac, Ctrl elsewhere', () => {
    const zoom = (mac: boolean) => shortcutRows({ mac }).flat().find((r) => r.label === 'Fit the board')!.keys[0][0];
    expect(zoom(true)).toBe('⌘');
    expect(zoom(false)).toBe('Ctrl');
  });
});

describe('ShortcutsOverlay', () => {
  let root: Root | null = null, host: HTMLDivElement | null = null;
  afterEach(() => { act(() => root?.unmount()); host?.remove(); root = null; host = null; });
  const mount = (open: boolean, onClose = vi.fn()) => {
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => root!.render(createElement(ShortcutsOverlay, { open, onClose, x: 600, bottom: 100 })));
    return onClose;
  };
  it('renders nothing while closed', () => {
    mount(false);
    expect(document.querySelector('.keys')).toBeNull();
  });
  it('is a focused dialog; Esc and ? close it and do not reach the window', () => {
    const onClose = mount(true);
    const card = document.querySelector('.keys') as HTMLElement;
    expect(card.getAttribute('role')).toBe('dialog');
    expect(document.activeElement).toBe(card);
    expect(card.querySelectorAll('.keys-row').length).toBeGreaterThan(10);
    const win = vi.fn();
    window.addEventListener('keydown', win);
    card.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    card.dispatchEvent(new KeyboardEvent('keydown', { key: '?', shiftKey: true, bubbles: true }));
    window.removeEventListener('keydown', win);
    expect(onClose).toHaveBeenCalledTimes(2);
    expect(win).not.toHaveBeenCalled();
  });
  it('a click outside closes it', () => {
    const onClose = mount(true);
    document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    expect(onClose).toHaveBeenCalledOnce();
  });
});
