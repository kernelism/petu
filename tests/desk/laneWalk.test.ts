// tests/desk/laneWalk.test.ts — a walking answer reads as one thread in the lane (founder 2026-10-31:
// "why is only the last slide's drawings under 3? … when i scroll up, they are isolated and i don't
// know what question they correspond to"; "why is 2 right above 3?").
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Desk, type DeskHost } from '../../src/desk/Desk';
import { computeLayout, frameFor, type Split } from '../../src/desk/layout';
import { answerHead } from '../../src/ui/trail';

const NS = 'http://www.w3.org/2000/svg';

/** A viewer stand-in with a lane (as tests/desk/deskTrail.test.ts): real layout math, no pdf.js. */
function laneHost(lane: HTMLElement, W = 1440, H = 900, pages = 8) {
  const aspects = new Float64Array(pages).fill(9 / 16);
  const s = { W, H, top: 0, split: 'none' as Split };
  const none = () => () => {};
  const layout = () => computeLayout(frameFor(s.W, s.H, s.split, 9 / 16, true).page, aspects, s.H);
  const host = {
    viewport: () => ({ W: s.W, H: s.H }),
    layout,
    scrollTop: () => s.top,
    maxScroll: () => Math.max(0, layout().total - s.H),
    aspect: () => 9 / 16,
    setSplit: vi.fn(async (split: Split) => { s.split = split; }),
    glideTo: vi.fn(async (top: () => number) => { s.top = top(); }),
    cancelGlide: vi.fn(),
    scrollToPage: vi.fn(async () => {}),
    onLayout: none,
    onScroll: none,
    onUserIntent: none,
    laneEl: () => lane,
  };
  return host as unknown as DeskHost & { glideTo: ReturnType<typeof vi.fn> };
}

const settle = () => vi.advanceTimersByTimeAsync(1500);

/**
 * Answer 3 walks p.2 → p.4 → p.5: one svg board, a group drawn and then a page marked, per page.
 * Returns the desk, the answer's head and the lane.
 */
async function walking(num = '3') {
  const lane = document.createElement('div');
  const stage = document.createElement('div');
  document.body.append(lane, stage);
  const host = laneHost(lane);
  const d = new Desk(host, stage);
  const head = answerHead({ num, question: 'explain each filter one by one', onReplay: () => {} });
  head.setMeta('p.1 · 1:51');
  d.headNext(head.el, head.h);
  const p = d.addRegion({ id: 'b', page: 1, size: 'l', svg: true, h: 900 });
  await settle();
  const r = await p;
  if (typeof r === 'string') throw new Error(r);
  const root = r.layers.agent.appendChild(document.createElementNS(NS, 'svg'));
  root.setAttribute('data-svgboard', 'b');
  const step = (y: number, page: number) => {
    const g = root.appendChild(document.createElementNS(NS, 'g'));
    g.appendChild(document.createElementNS(NS, 'rect'));
    d.noteInk({ region: 'b' }, { x: 0, y, w: 800, h: 150 }, g);
    d.noteInk({ page }, { x: 100, y: 200, w: 300, h: 30 });
  };
  return { d, host, lane, head: head.el, step };
}

describe('Desk lane: a walking answer reads as one thread', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.stubGlobal('matchMedia', () => ({ matches: true })); });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); document.body.replaceChildren(); });

  it('the head stays over the first stretch; each later stretch carries "cont. i", then "i/n" once it ends', async () => {
    const { d, lane, head, step } = await walking();
    step(0, 2);
    step(200, 4);
    step(400, 5);
    const items = [...lane.querySelectorAll<HTMLElement>('.lane-item')];
    expect(items).toHaveLength(3);
    // The first stretch (p.2) holds the head, above its drawing.
    expect(items[0].firstElementChild).toBe(head);
    expect(items[0].querySelector('.desk-region')).not.toBeNull();
    // The later ones a tag in the head's style: the number chip and "cont. i" (the total once it ends).
    const tag = (i: number) => items[i].querySelector(':scope > .trail-head.is-cont');
    expect(tag(1)?.querySelector('.trail-num')?.textContent).toBe('3');
    expect(tag(1)?.querySelector('.trail-cont-n')?.textContent).toBe('cont. 2');
    expect(tag(2)?.querySelector('.trail-cont-n')?.textContent).toBe('cont. 3');
    expect(tag(2)?.querySelector('.trail-cont-q')?.textContent).toBe('explain each filter one by one');
    expect(items[2].contains(head)).toBe(false);
    await d.overview();
    await settle();
    expect(tag(1)?.querySelector('.trail-cont-n')?.textContent).toBe('cont. 2/3');
    expect(tag(2)?.querySelector('.trail-cont-n')?.textContent).toBe('cont. 3/3');
    expect(d.spanOf(head)).toBe('p.2–5');
  });

  it('a tag goes to the head (where the answer began)', async () => {
    const { d, host, head, lane, step } = await walking();
    step(0, 2);
    step(200, 4);
    await d.overview();
    await settle();
    host.glideTo.mockClear();
    lane.querySelector<HTMLButtonElement>('.trail-head.is-cont .trail-row')!.click();
    await settle();
    expect(host.glideTo).toHaveBeenCalled();
    expect(head.isConnected).toBe(true);
  });

  it('folds to one card at its first page that says the pages it spans; a click opens the whole thread', async () => {
    const { d, lane, head, step } = await walking();
    step(0, 2);
    step(200, 4);
    step(400, 5);
    await d.overview();
    await settle();
    await d.reset(0);
    const groups = [...lane.querySelectorAll<HTMLElement>('.lane-group')];
    const shown = groups.filter((g) => !g.classList.contains('is-away'));
    expect(shown).toHaveLength(1);
    expect(shown[0].classList.contains('is-folded')).toBe(true);
    expect(shown[0].contains(head)).toBe(true);
    expect(head.querySelector('.trail-fmeta')?.textContent).toBe('p.2–5 · 1:51');
    shown[0].querySelector<HTMLElement>('.lane-item')!.click();
    expect(groups.filter((g) => g.classList.contains('is-away') || g.classList.contains('is-folded'))).toHaveLength(0);
  });

  it('replaying it (the trail forgets its head) takes every stretch with it', async () => {
    const { d, lane, head, step } = await walking();
    step(0, 2);
    step(200, 4);
    await d.overview();
    await settle();
    d.forget(head);
    expect(lane.querySelectorAll('.lane-group')).toHaveLength(0);
    expect(lane.querySelectorAll('.trail-head')).toHaveLength(0);
  });

  it('a follow-up that extends a folded walk undoes it: one drawing again, its head on top, no tags', async () => {
    const { d, lane, head, step } = await walking();
    step(0, 2);
    step(200, 4);
    await d.overview();
    await settle();
    await d.reset(0);
    const next = answerHead({ num: '4', question: 'and the median?', onReplay: () => {} });
    d.headNext(next.el, next.h);
    const p = d.addRegion({ id: 'b', page: 4, size: 'l', svg: true, extend: true, h: 1400 });
    await settle();
    expect(typeof (await p)).not.toBe('string');
    const groups = [...lane.querySelectorAll<HTMLElement>('.lane-group')];
    expect(groups).toHaveLength(1);
    expect(groups[0].classList.contains('is-away')).toBe(false);
    expect(groups[0].querySelector('.lane-item')!.firstElementChild).toBe(head);
    expect(lane.querySelectorAll('.trail-head.is-cont')).toHaveLength(0);
  });

  it('an answer that docked beside a later page folds to a card at its first page mark', async () => {
    const { d, host, lane, head } = await walking('2');
    const L = computeLayout(frameFor(1440, 900, 'none', 9 / 16, true).page, new Float64Array(8).fill(9 / 16), 900);
    const p2 = L.tops[1], p6 = L.tops[5];
    // Not an svg walk: marks on p.2, then p.6 (no new group in between); it ends with p.6 in view.
    d.noteInk({ page: 2 }, { x: 100, y: 200, w: 300, h: 30 });
    d.noteInk({ page: 6 }, { x: 100, y: 200, w: 300, h: 30 });
    await host.glideTo(() => p6 - 100);
    await d.overview();
    await settle();
    const top = () => parseFloat(lane.querySelector<HTMLElement>('.lane-spacer')!.style.height);
    expect(top()).toBeGreaterThan(p6 - 400);
    await d.reset(0);
    expect(head.isConnected).toBe(true);
    expect(Math.abs(top() - p2)).toBeLessThan(300);
  });
});
