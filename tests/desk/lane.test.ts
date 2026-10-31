import { describe, expect, it } from 'vitest';
import { frameFor, laneFrame, LANE_MIN_W, pageFrameTop, SAFE_TOP } from '../../src/desk/layout';
import { dockTop, LANE_GAP, LEADER_MAX, leaderFrom, leaderPath, packLane, stickyInsets, wantFor, walkSplit } from '../../src/desk/lane';
import { dockPlacement } from '../../src/ui/layout';

describe('laneFrame (layout C geometry)', () => {
  it('1440: the mockup sheet — page 800, lane 544, margins 48, page and lane joined', () => {
    const f = laneFrame(1440)!;
    expect(f.page.pageW).toBe(800);
    expect(f.lane.x).toBe(f.page.pageX + f.page.pageW);
    expect(f.page.pageX).toBe(48);
    expect(1440 - (f.lane.x + f.lane.w)).toBe(48);
  });
  it('2560: the lane caps at 1000, the page at 1100, the sheet centred with desk either side', () => {
    const f = laneFrame(2560)!;
    expect(f.lane.w).toBe(1000);
    expect(f.page.pageW).toBe(1100);
    expect(f.page.pageX).toBe(2560 - (f.lane.x + f.lane.w));
  });
  it('below 1200 there is no lane: the split board (B) takes over', () => {
    expect(laneFrame(LANE_MIN_W - 1)).toBeNull();
    expect(frameFor(1100, 800, 'normal', 0.75).lane).toBeUndefined();
    expect(frameFor(1440, 900, 'normal', 0.75).lane).toEqual(laneFrame(1440)!.lane);
  });
  it('the page column never moves when drawings arrive (reading and drawing frames agree)', () => {
    expect(frameFor(1440, 900, 'none', 1.3).page).toEqual(frameFor(1440, 900, 'wide', 1.3).page);
  });
  it('page framing in the lane is the reading framing (no split offset)', () => {
    const page = { top: 1000, h: 300 };
    expect(pageFrameTop(page, 1440, 900, 'normal', 1.3)).toBe(pageFrameTop(page, 1440, 900, 'none', 1.3));
    expect(page.top - pageFrameTop(page, 1440, 900, 'normal', 1.3, false)).toBe(SAFE_TOP);
  });
});

describe('lane placement', () => {
  it('a group sits at its anchor; one whose slot is taken stacks below with a gap; earlier ones never move', () => {
    const tops = packLane([{ want: 100, h: 300 }, { want: 200, h: 100 }, { want: 1000, h: 50 }]);
    expect(tops).toEqual([100, 100 + 300 + LANE_GAP, 1000]);
  });
  it('a leader goes only to a real mark: the live page ink, or a marked anchor; never to an unmarked page', () => {
    expect(leaderFrom(320, 500, true)).toEqual([320, 500]);
    expect(leaderFrom(null, 500, true)).toEqual([500]);
    // Asked on a title page the answer never marks: the anchor is only the reading line there.
    expect(leaderFrom(null, 500, false)).toEqual([]);
    expect(leaderFrom(320, 500, false)).toEqual([320]);
  });
  it('the head sits just above the anchor so the drawing starts level with it', () => {
    expect(wantFor(500, 44)).toBe(448);
    expect(wantFor(10, 44)).toBe(0);
  });
  it('docking keeps the group where it is when the anchor is inside it, else moves the least', () => {
    expect(dockTop(300, 400, 500, 44)).toBe(300);
    expect(dockTop(0, 200, 800, 44)).toBe(800 - 200 + 18);
    expect(dockTop(900, 200, 500, 44)).toBe(500 - 44 - 8);
  });
  it('a leader is level when the anchor is inside the item, curves when near, and is dropped when far', () => {
    expect(leaderPath(300, { top: 200, h: 300 }, 18)!.d).toBe('M0 300.0H18.0');
    const near = leaderPath(150, { top: 200, h: 300 }, 18)!;
    expect(near.y1).toBe(218);
    expect(near.d.startsWith('M0 150.0C')).toBe(true);
    expect(leaderPath(200 - LEADER_MAX - 40, { top: 200, h: 300 }, 18)).toBeNull();
  });
  it('a live group sticks under the chrome; taller than the band, its newest part stays in view', () => {
    expect(stickyInsets(300, 900, 80, 160)).toEqual({ top: 80, bottom: 160 });
    expect(stickyInsets(800, 900, 80, 160)).toEqual({ top: 900 - 160 - 800, bottom: 160 });
  });
  it('taller than the band, the group follows the pen: the part being drawn comes into view, moving least', () => {
    // A part near the top of a 1200 px group: the group's top comes down to show it (under the chrome).
    expect(stickyInsets(1200, 900, 80, 160, { top: 100, h: 200 })).toEqual({ top: -20, bottom: 900 + 20 - 1200 });
    // Already in view from the last inset: nothing moves.
    expect(stickyInsets(1200, 900, 80, 160, { top: 300, h: 100 }, -20).top).toBe(-20);
    // Further down: just enough to bring its bottom above the dock, never past the group's bottom.
    expect(stickyInsets(1200, 900, 80, 160, { top: 900, h: 100 }, -20).top).toBe(900 - 160 - 1000);
    expect(stickyInsets(1200, 900, 80, 160, { top: 1150, h: 50 }, -20).top).toBe(900 - 160 - 1200);
    // A short group ignores the pen.
    expect(stickyInsets(300, 900, 80, 160, { top: 10, h: 10 })).toEqual({ top: 80, bottom: 160 });
  });
  it('the dock centres under the column the pen is in, with air either side', () => {
    const lane = laneFrame(1440)!.lane;
    const d = dockPlacement(1440, { split: 'normal', stacked: false, following: true, sketching: true, column: { x: lane.x, w: lane.w }, lane: true });
    expect(d.x).toBe(lane.x + lane.w / 2);
    expect(d.w).toBe(lane.w - 44);
  });
});

describe('zoomedInsets (sticky under the overview zoom)', () => {
  it('a group stuck at 80 px stays at 80 px on screen at any zoom and scroll', async () => {
    const { zoomedInsets } = await import('../../src/desk/lane');
    const H = 900;
    for (const z of [0.5, 0.96, 1, 1.18, 2]) for (const st of [0, 1200, 5400]) {
      const ins = zoomedInsets({ top: 80, bottom: 120 }, H, st, z);
      // Stuck at its top: sheet y = st + top'; on screen (sheet scaled about its top) y·z − st.
      expect((st + ins.top) * z - st).toBeCloseTo(80, 6);
      // Its bottom limit: sheet bottom ≤ st + H − bottom' → on screen ≤ H − 120.
      expect((st + H - ins.bottom) * z - st).toBeCloseTo(H - 120, 6);
    }
  });
});

describe('visibleLane (the lane part the window shows under the overview zoom)', () => {
  it('is the whole lane at 100% and when zoomed out', async () => {
    const { visibleLane } = await import('../../src/desk/lane');
    expect(visibleLane({ x: 848, w: 544 }, 1440, 1, 0)).toEqual({ x: 848, w: 544 });
    const out = visibleLane({ x: 848, w: 544 }, 1440, 0.9, 0);
    expect(out.w).toBeCloseTo(544);
  });
  it('zoomed in, ends at the window edge: what is laid out there shows whole', async () => {
    const { visibleLane } = await import('../../src/desk/lane');
    for (const z of [1.1, 1.25, 1.5]) {
      const v = visibleLane({ x: 848, w: 544 }, 1440, z, 0);
      const right = 720 + (v.x + v.w - 720) * z;
      expect(right).toBeLessThanOrEqual(1440 - 12 + 1e-6);
      expect(v.x).toBeCloseTo(848);
      expect(v.w).toBeGreaterThanOrEqual(272);
    }
  });
});

describe('walkSplit (a multi-page svg answer leaves each stretch beside its page)', () => {
  it('the first mark places the groups begun so far; nothing stays behind', () => {
    expect(walkSplit([null], 0, 4)).toEqual({ placed: [0], runs: null, at: 0 });
  });

  it('a mark on a new page after a new group: the earlier groups stay beside their page', () => {
    // strip (p4), then averages begins, then the narration marks p21.
    expect(walkSplit([4, null], 0, 21)).toEqual({ placed: [1], runs: [[0]], at: 1 });
    // Later: median begins, p33 is marked; the live drawing shows from averages (index 1).
    expect(walkSplit([4, 21, null], 1, 33)).toEqual({ placed: [2], runs: [[1]], at: 2 });
  });

  it('consecutive groups on one page stay together; a mark on the same page moves nothing', () => {
    expect(walkSplit([4, 4, 21, null], 0, 33)).toEqual({ placed: [3], runs: [[0, 1], [2]], at: 3 });
    expect(walkSplit([4, null], 0, 4)).toEqual({ placed: [1], runs: null, at: 0 });
  });

  it('a mark with no new group (pointing mid-beat) places nothing and moves nothing', () => {
    expect(walkSplit([4, 21], 0, 33)).toEqual({ placed: [], runs: null, at: 0 });
  });
});
