// src/agent/context/charts.ts — figure calibration: a page's chart axes, fitted to data → page maps.
import type { Pt } from '../../script/types';
import type { PageRect } from '../../geometry/space';

/**
 * One calibrated axis: data value `lo` sits at page coordinate `p0`, `hi` at `p1` (x axis: page x;
 * y axis: page y, so p0 > p1 when values grow upward). `log`: the map is linear in log10(value).
 */
export type ChartAxis = { name?: string; lo: number; hi: number; p0: number; p1: number; log?: boolean };
/** A calibrated chart (`#c1`): its plot box (the axes' extent, model coords) and one map per axis. */
export type Chart = { id: string; rect: PageRect; x: ChartAxis; y: ChartAxis };

const lin = (a: ChartAxis, v: number): number | null => {
  if (a.log) {
    if (!(v > 0) || !(a.lo > 0) || !(a.hi > 0)) return null;
    return a.p0 + ((Math.log10(v) - Math.log10(a.lo)) / (Math.log10(a.hi) - Math.log10(a.lo))) * (a.p1 - a.p0);
  }
  return a.p0 + ((v - a.lo) / (a.hi - a.lo)) * (a.p1 - a.p0);
};

/** Data → page (model coords). null when a log axis gets a value ≤ 0. */
export function chartToPage(c: Pick<Chart, 'x' | 'y'>, d: Pt): Pt | null {
  const x = lin(c.x, d.x), y = lin(c.y, d.y);
  return x == null || y == null || !Number.isFinite(x) || !Number.isFinite(y) ? null : { x, y };
}
