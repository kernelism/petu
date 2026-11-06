// The chrome's logic (UX audit 2026-10-29, batch B2): shortcut gating, the one way back, the page
// field, the settings radios, the shortcuts card's placement, the large-window step and the glides.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { keysActive } from '../../src/ui/CanvasToolbar';
import { backControl, RouteChip } from '../../src/ui/RouteChip';
import { FollowPill } from '../../src/ui/FollowPill';
import { isGoToPageKey, parsePage } from '../../src/ui/pageNav';
import { BEST_HINT, BEST_OFF_NOTE, radioStep, SettingsPopover } from '../../src/ui/SettingsPopover';
import { cardPlace, shortcutRows } from '../../src/ui/ShortcutsOverlay';
import { tipPlace } from '../../src/ui/Tip';
import { glideOffset } from '../../src/ui/glide';
import { dockMax, dockPlacement, DOCK_MAX, DOCK_MAX_LARGE } from '../../src/ui/layout';
import { TopBar } from '../../src/ui/TopBar';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null, host: HTMLDivElement | null = null;
afterEach(() => { act(() => root?.unmount()); host?.remove(); root = null; host = null; document.body.innerHTML = ''; });
const mount = (el: ReturnType<typeof createElement>) => {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root!.render(el));
  return host;
};

describe('keysActive (D / P / H / E)', () => {
  it('acts at load, when focus is on the body', () => {
    expect(keysActive(false, document.body)).toBe(true);
    expect(keysActive(false, null)).toBe(true);
  });
  it('acts on the page, the board and the toolbar; not on other controls', () => {
    const stage = document.createElement('main');
    stage.className = 'stage';
    const inner = document.createElement('div');
    stage.appendChild(inner);
    const other = document.createElement('button');
    document.body.append(stage, other);
    expect(keysActive(false, inner)).toBe(true);
    expect(keysActive(false, other)).toBe(false);
    expect(keysActive(true, other)).toBe(true);
  });
  it('never with a popover or the shortcuts card open', () => {
    const pop = document.createElement('div');
    pop.className = 'keys';
    document.body.appendChild(pop);
    expect(keysActive(false, document.body)).toBe(false);
    expect(keysActive(true, document.body)).toBe(false);
  });
});

describe('the one way back (route row)', () => {
  it('offers the answer while the student has the view, else the page the answer started on', () => {
    expect(backControl(true, 9)).toEqual({ kind: 'answer' });
    expect(backControl(false, 9)).toEqual({ kind: 'page', page: 9 });
    expect(backControl(false, null)).toBeNull();
  });
  it('never shows "Back to pN" and "Back to answer" together', () => {
    const onResume = vi.fn();
    const el = mount(createElement('div', null,
      createElement(FollowPill, { visible: true, onResume }),
      createElement(RouteChip, { route: null, backTo: 9, onBack: () => {}, x: 500 })));
    const buttons = [...el.querySelectorAll('button')].map((b) => b.textContent);
    expect(buttons).toEqual(['Back to answer']);
    act(() => el.querySelector('button')!.click());
    expect(onResume).toHaveBeenCalledOnce();
  });
  it('shows "Back to pN" once follow is back on', () => {
    const el = mount(createElement('div', null,
      createElement(FollowPill, { visible: false, onResume: () => {} }),
      createElement(RouteChip, { route: null, backTo: 9, onBack: () => {}, x: 500 })));
    expect([...el.querySelectorAll('button')].map((b) => b.textContent)).toEqual(['Back to p9']);
  });
});

describe('the page field', () => {
  it('reads a typed page, clamped into the document', () => {
    expect(parsePage('12', 40)).toBe(12);
    expect(parsePage(' p7 ', 40)).toBe(7);
    expect(parsePage('99', 40)).toBe(40);
    expect(parsePage('0', 40)).toBe(1);
    expect(parsePage('', 40)).toBeNull();
    expect(parsePage('abc', 40)).toBeNull();
  });
  it('G opens it: not while typing, with a modifier or a popover open', () => {
    const ev = (o: Partial<KeyboardEvent> = {}, target: EventTarget | null = document.body) =>
      ({ key: 'g', shiftKey: false, metaKey: false, ctrlKey: false, altKey: false, defaultPrevented: false, target, ...o }) as KeyboardEvent;
    expect(isGoToPageKey(ev())).toBe(true);
    expect(isGoToPageKey(ev({ metaKey: true }))).toBe(false);
    expect(isGoToPageKey(ev({}, document.createElement('input')))).toBe(false);
    const pop = document.createElement('div');
    pop.className = 'popover';
    document.body.appendChild(pop);
    expect(isGoToPageKey(ev())).toBe(false);
  });
  it('Enter goes to the typed page; Esc puts the current page back', () => {
    const onGoToPage = vi.fn();
    const el = mount(createElement(TopBar, { fileName: 'a.pdf', page: 3, numPages: 12, pageTick: 0, onOpenSettings: () => {}, onOpenFile: () => {}, onGoToPage }));
    const input = el.ownerDocument.querySelector<HTMLInputElement>('.topbar-num')!;
    expect(input.value).toBe('3');
    const type = (v: string) => {
      act(() => { input.focus(); });
      const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
      act(() => { set.call(input, v); input.dispatchEvent(new Event('input', { bubbles: true })); });
    };
    type('9');
    act(() => { input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); });
    expect(onGoToPage).toHaveBeenCalledWith(9);
    type('5');
    act(() => { input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); });
    expect(onGoToPage).toHaveBeenCalledTimes(1);
    expect(input.value).toBe('3');
  });
});

describe('settings', () => {
  it('arrow keys move a radio group, wrapping; Home/End jump', () => {
    expect(radioStep('ArrowRight', 0, 3)).toBe(1);
    expect(radioStep('ArrowDown', 2, 3)).toBe(0);
    expect(radioStep('ArrowLeft', 0, 3)).toBe(2);
    expect(radioStep('Home', 2, 3)).toBe(0);
    expect(radioStep('End', 0, 3)).toBe(2);
    expect(radioStep('a', 0, 3)).toBeNull();
  });
  it('is a titled dialog; each radio group is one tab stop; five controls and the shortcuts link', () => {
    mount(createElement(SettingsPopover, { open: true, onClose: () => {}, bestAvailable: true }));
    const pop = document.querySelector('.popover')!;
    expect(pop.getAttribute('aria-labelledby')).toBe('pop-title');
    expect(pop.querySelector('#pop-title')!.textContent).toBe('Settings');
    for (const g of pop.querySelectorAll('[role="radiogroup"]')) {
      expect([...g.querySelectorAll('[role="radio"]')].filter((r) => r.getAttribute('tabindex') === '0')).toHaveLength(1);
    }
    expect([...pop.querySelectorAll('.pop-label')].map((l) => l.textContent)).toEqual(['Highlight', 'Speed', 'Voice', 'Answer quality', 'Predict a step']);
    // No drawing style, no ink colour, no slider, no shortcuts switch.
    expect(pop.querySelector('.swatch, input[type="range"], [role="switch"]')).toBeNull();
    const radios = (id: string) => [...pop.querySelectorAll(`[aria-labelledby="${id}"] [role="radio"]`)].map((r) => r.textContent);
    // The highlight is a style (violet wash or yellow marker, layout C), a two-way radio group.
    expect(radios('pop-highlight')).toEqual(['Violet wash', 'Yellow marker']);
    expect(radios('pop-speed')).toEqual(['0.75×', '1×', '1.25×', '1.5×']);
    expect(radios('pop-voice')).toEqual(['Off', 'Marin', 'Cedar']);
    expect(radios('pop-quality')).toEqual(['Standard', 'Best']);
    expect(radios('pop-predict')).toEqual(['Off', 'Ask me']); // off by default (teaching-engine §3.4, §7 pacing)
    expect(pop.textContent).toContain(BEST_HINT);
    expect(pop.querySelector('.pop-show-keys')!.textContent).toBe('Keyboard shortcuts ?');
  });
  it('a speed pick goes through onSpeed; an arrow key moves to the next step and focus with it', () => {
    const picks: number[] = [];
    mount(createElement(SettingsPopover, { open: true, onClose: () => {}, onSpeed: (v: number) => picks.push(v) }));
    const group = document.querySelector('[aria-labelledby="pop-speed"]')!;
    const r = group.querySelectorAll<HTMLElement>('[role="radio"]');
    expect(r[1].getAttribute('aria-checked')).toBe('true');
    act(() => { r[3].click(); });
    act(() => { r[1].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })); });
    expect(picks).toEqual([1.5, 1.25]);
    expect(document.activeElement).toBe(r[2]);
  });
  it('without the server saying Best can run: Best is disabled, Standard shown, a note; arrows skip it', () => {
    mount(createElement(SettingsPopover, { open: true, onClose: () => {} }));
    const group = document.querySelector('[aria-labelledby="pop-quality"]')!;
    const [std, best] = group.querySelectorAll<HTMLButtonElement>('[role="radio"]');
    expect(best.disabled).toBe(true);
    expect(std.getAttribute('aria-checked')).toBe('true');
    expect(document.querySelector('.popover')!.textContent).toContain(BEST_OFF_NOTE);
    act(() => { std.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })); });
    expect(std.getAttribute('aria-checked')).toBe('true');
  });
  it('the shortcuts link closes the popover and opens the sheet', () => {
    let closed = 0, shown = 0;
    mount(createElement(SettingsPopover, { open: true, onClose: () => { closed++; }, onShowShortcuts: () => { shown++; } }));
    act(() => { document.querySelector<HTMLElement>('.pop-show-keys')!.click(); });
    expect([closed, shown]).toEqual([1, 1]);
  });
});

describe('the shortcuts card', () => {
  const rows = shortcutRows({ mac: true }).flat();
  it('lists Esc once, has no row for its own key, and lists G', () => {
    expect(rows.filter((r) => r.keys.some((k) => k.includes('Esc')))).toHaveLength(1);
    expect(rows.find((r) => r.keys.some((k) => k.includes('?')))).toBeUndefined();
    expect(rows.find((r) => r.label === 'Go to page')!.keys).toEqual([['G']]);
  });
  it('says Return on a Mac, Enter elsewhere', () => {
    const resume = (mac: boolean) => shortcutRows({ mac }).flat().find((r) => r.label === 'Resume after an aside')!.keys[0][0];
    expect(resume(true)).toBe('Return');
    expect(resume(false)).toBe('Enter');
  });
  it('fits a short window: capped height, two columns below 720px', () => {
    expect(cardPlace(1440, 900, 700, 100)).toMatchObject({ wide: false, maxHeight: 900 - 100 - 10 - 16 });
    const short = cardPlace(1280, 640, 400, 120);
    expect(short.wide).toBe(true);
    expect(short.maxHeight).toBe(640 - 120 - 26);
    expect(short.left).toBeGreaterThanOrEqual(660 / 2 + 8);
  });
});

describe('placement', () => {
  it('keeps a tip inside the window', () => {
    expect(tipPlace({ left: 1420, width: 28, bottom: 54 }, 120, 1440).left).toBe(1440 - 60 - 8);
    expect(tipPlace({ left: 600, width: 28, bottom: 54 }, 120, 1440)).toEqual({ top: 64, left: 614 });
  });
  it('gives the dock its large step from 2000px', () => {
    expect(dockMax(1440)).toBe(DOCK_MAX);
    expect(dockMax(2560)).toBe(DOCK_MAX_LARGE);
    expect(dockPlacement(2560, null).w).toBe(DOCK_MAX_LARGE);
  });
  it('a glide starts where the element showed, including an offset still gliding out', () => {
    expect(glideOffset(400, 300)).toBe(100);
    expect(glideOffset(400, 300, -20)).toBe(80);
  });
});
