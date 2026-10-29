// Board zoom: the step math, Fit, the keys (zoomKeys) and the Desk's control.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { boardLayout, fitZoom, zoomStepFrom, ZOOM_MAX, ZOOM_MIN, ZOOM_STEPS, BOARD_HEAD, computeLayout, frameFor, type Split } from '../../src/desk/layout';
import { boardZoomKey } from '../../src/ui/zoomKeys';
import { Desk, type DeskHost } from '../../src/desk/Desk';

describe('zoom steps', () => {
  it('steps through the list from 100%', () => {
    expect(zoomStepFrom(1, 1)).toBe(1.25);
    expect(zoomStepFrom(1, -1)).toBe(0.8);
    expect(zoomStepFrom(0.8, -1)).toBe(0.67);
  });
  it('clamps at the ends', () => {
    expect(zoomStepFrom(ZOOM_MAX, 1)).toBe(ZOOM_MAX);
    expect(zoomStepFrom(ZOOM_MIN, -1)).toBe(ZOOM_MIN);
    expect(ZOOM_STEPS).toContain(1);
  });
  it('an off-step zoom (after Fit) goes to its neighbours', () => {
    expect(zoomStepFrom(0.6, 1)).toBe(0.67);
    expect(zoomStepFrom(0.6, -1)).toBe(0.5);
  });
});

describe('boardLayout with zoom', () => {
  it('scales every section, keeps the head row and pads', () => {
    const a = boardLayout(666, [{ body: 20 }, { body: 20, span: 300 }]);
    const b = boardLayout(666, [{ body: 20 }, { body: 20, span: 300 }], 0.5);
    expect(b.boxes[0].s).toBeCloseTo(a.boxes[0].s * 0.5);
    expect(b.boxes[0].h).toBeCloseTo(a.boxes[0].h * 0.5);
    expect(b.boxes[0].y).toBe(BOARD_HEAD);
    expect(b.pad).toBe(a.pad);
    expect(b.width).toBe(666);
  });
  it('zoomed past the width: sections start at the pad and the content widens', () => {
    const z = boardLayout(666, [{ body: 40 }], 1.5);
    expect(z.boxes[0].x).toBe(z.pad);
    expect(z.width).toBeCloseTo(z.boxes[0].w + 2 * z.pad);
    expect(z.width).toBeGreaterThan(666);
  });
});

describe('fitZoom', () => {
  it('is 1 when everything already fits', () => {
    expect(fitZoom(2000, boardLayout(666, [{ body: 20 }]))).toBe(1);
    expect(fitZoom(500, boardLayout(666, []))).toBe(1);
  });
  it('fits tall content into the board height', () => {
    const secs = [{ body: 20 }, { body: 20 }, { body: 20 }];
    const H = 700;
    const z = fitZoom(H, boardLayout(666, secs));
    expect(z).toBeLessThan(1);
    expect(boardLayout(666, secs, z).height).toBeLessThanOrEqual(H + 0.01);
    expect(boardLayout(666, secs, z + 0.02).height).toBeGreaterThan(H);
  });
  it('never goes below the smallest step', () => {
    const lay = boardLayout(666, Array.from({ length: 40 }, () => ({ body: 20 })));
    expect(fitZoom(300, lay)).toBe(ZOOM_MIN);
  });
});

describe('boardZoomKey', () => {
  const ev = (key: string, o: Partial<KeyboardEvent> = {}, target: EventTarget | null = document.body) =>
    ({ key, metaKey: false, ctrlKey: false, altKey: false, defaultPrevented: false, target, ...o }) as KeyboardEvent;
  const mac = { boardOpen: true, mac: true }, pc = { boardOpen: true, mac: false };
  it('maps ⌘+ ⌘= ⌘− ⌘0 on a Mac', () => {
    expect(boardZoomKey(ev('+', { metaKey: true }), mac)).toBe('in');
    expect(boardZoomKey(ev('=', { metaKey: true }), mac)).toBe('in');
    expect(boardZoomKey(ev('-', { metaKey: true }), mac)).toBe('out');
    expect(boardZoomKey(ev('0', { metaKey: true }), mac)).toBe('fit');
  });
  it('uses Ctrl elsewhere, and not the other modifier', () => {
    expect(boardZoomKey(ev('-', { ctrlKey: true }), pc)).toBe('out');
    expect(boardZoomKey(ev('-', { metaKey: true }), pc)).toBeNull();
    expect(boardZoomKey(ev('-', { ctrlKey: true }), mac)).toBeNull();
  });
  it('needs the modifier, an open board, no Alt, no text field', () => {
    expect(boardZoomKey(ev('-'), mac)).toBeNull();
    expect(boardZoomKey(ev('-', { metaKey: true }), { boardOpen: false, mac: true })).toBeNull();
    expect(boardZoomKey(ev('-', { metaKey: true, altKey: true }), mac)).toBeNull();
    expect(boardZoomKey(ev('-', { metaKey: true, defaultPrevented: true }), mac)).toBeNull();
    expect(boardZoomKey(ev('-', { metaKey: true }, document.createElement('input')), mac)).toBeNull();
    expect(boardZoomKey(ev('z', { metaKey: true }), mac)).toBeNull();
  });
});

function fakeHost(W = 1440, H = 900, pages = 5) {
  const aspects = new Float64Array(pages).fill(9 / 16);
  const s = { W, H, top: 0, split: 'none' as Split };
  const layout = () => computeLayout(frameFor(s.W, s.H, s.split, 9 / 16).page, aspects, s.H);
  const none = () => () => {};
  const host: DeskHost = {
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
  };
  return host;
}

describe('Desk zoom', () => {
  let stage: HTMLDivElement;
  beforeEach(() => { vi.useFakeTimers(); stage = document.createElement('div'); });
  afterEach(() => vi.useRealTimers());

  it('has a control in the board; the buttons step and the readout follows', async () => {
    const d = new Desk(fakeHost(), stage);
    const r = await d.addRegion({ id: 's', page: 2, size: 'm' });
    if (typeof r === 'string') throw new Error(r);
    const ctl = stage.querySelector('.desk-board .desk-zoom')!;
    expect(ctl).toBeTruthy();
    const pct = ctl.querySelector('.desk-zoom-pct')!;
    expect(pct.textContent).toBe('100%');
    const sec = stage.querySelector('.desk-region') as HTMLElement;
    const w0 = parseFloat(sec.style.width);
    (ctl.querySelector('.desk-zoom-out') as HTMLButtonElement).click();
    expect(d.zoom()).toBe(0.8);
    expect(pct.textContent).toBe('80%');
    expect(parseFloat(sec.style.width)).toBeCloseTo(w0 * 0.8);
    expect(d.state().zoom).toBe(0.8);
    // The section's own scale (for sizing ink) does not change with the zoom.
    expect(r.scale()).toBeCloseTo(w0 / 1000);
    d.zoomStep(1); d.zoomStep(1); d.zoomStep(1);
    expect(d.zoom()).toBe(ZOOM_MAX);
    expect((ctl.querySelector('.desk-zoom-in') as HTMLButtonElement).disabled).toBe(true);
    d.setZoom(9);
    expect(d.zoom()).toBe(ZOOM_MAX);
    d.setZoom('fit');
    expect(d.zoom()).toBeLessThanOrEqual(1);
  });
  it('the board keeps data-petu-board on its scroller', () => {
    new Desk(fakeHost(), stage);
    expect(stage.querySelector('.desk-board-scroll')!.hasAttribute('data-petu-board')).toBe(true);
  });
});
