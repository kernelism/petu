// tests/desk/laneWalk.test.ts — an answer whose board explains several pages stays one board in the lane
// (the walk's per-page slicing is off for display, founder 2026-10-31). Earlier: (founder 2026-10-31:
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

describe('Desk lane: an answer that explains several pages keeps one whole board', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.stubGlobal('matchMedia', () => ({ matches: true })); });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); document.body.replaceChildren(); });

  // Founder 2026-10-31: the left half of a board vanished as the narration moved to the next page (the
  // walk's slicing). The board stays one composition: nothing is left behind, nothing is hidden.
  it('marks on new pages never slice the board: one group, its head on top, every svg group shown, no tags', async () => {
    const { d, lane, head, step } = await walking();
    step(0, 2);
    step(200, 4);
    step(400, 5);
    const check = () => {
      const items = [...lane.querySelectorAll<HTMLElement>('.lane-item')];
      expect(items).toHaveLength(1);
      expect(items[0].firstElementChild).toBe(head);
      expect(lane.querySelectorAll('.desk-region')).toHaveLength(1);
      expect(lane.querySelectorAll('.is-slice, .trail-head.is-cont')).toHaveLength(0);
      const gs = [...lane.querySelectorAll<SVGGElement>('svg[data-svgboard] > g')];
      expect(gs).toHaveLength(3);
      expect(gs.every((g) => g.style.visibility !== 'hidden')).toBe(true);
    };
    check();
    // The whole canvas shows while it plays (never only the newest stretch).
    expect(lane.querySelector('.desk-region svg:not([data-svgboard])')?.getAttribute('viewBox')?.split(' ')[1]).toBe('0');
    await d.overview();
    await settle();
    check();
  });

  it('a follow-up that extends it draws on into the same one board', async () => {
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
    expect(lane.querySelectorAll('.lane-group')).toHaveLength(1);
    expect(lane.querySelector('.lane-item')!.firstElementChild).toBe(head);
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

describe('clearOfDocked (the live group never sits over a docked card)', async () => {
  const { clearOfDocked } = await import('../../src/desk/lane');
  it('clears a card under its top, chaining past a stack, and stops at the band', () => {
    expect(clearOfDocked(80, 300, [], 600)).toBe(80);
    expect(clearOfDocked(80, 300, [{ top: 70, h: 36 }], 600)).toBe(114);
    expect(clearOfDocked(80, 300, [{ top: 70, h: 36 }, { top: 118, h: 36 }], 600)).toBe(162);
    expect(clearOfDocked(80, 300, [{ top: 400, h: 36 }], 600)).toBe(80); // below the band: not in the way
    expect(clearOfDocked(80, 300, [{ top: 70, h: 36 }], 100)).toBe(100);
    expect(clearOfDocked(80, 300, [{ top: 300, h: 36 }], 600)).toBe(344); // crossing its lower part: still cleared
  });
});
