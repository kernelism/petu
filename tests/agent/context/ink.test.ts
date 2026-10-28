import { describe, it, expect } from 'vitest';
import { inkSummary } from '../../../src/agent/context/ink';
import type { PageGround } from '../../../src/agent/context/types';
import type { StudentStroke } from '../../../src/ink/student/store';

// A 4:3 page (aspect 0.75): stroke y is page space (model y · 0.75).
const A = 0.75;
const g: PageGround = {
  page: 3, aspect: A, noText: false,
  lines: [
    { id: 't1', text: 'Epipolar Constraint', rect: { x: 50, y: 50, w: 300, h: 40 }, runs: [], math: false },
    { id: 't2', text: 'A point x in image 1 back-projects to a ray in 3D', rect: { x: 50, y: 150, w: 460, h: 30 }, runs: [], math: false },
  ],
  marks: [
    { id: '#d1', kind: 'dot', at: { x: 600, y: 600 }, label: 'x' },
    { id: '#d2', kind: 'dot', at: { x: 900, y: 900 } },
  ],
};
let id = 0;
const S = (pts: [number, number][], page = 3): StudentStroke => ({ id: ++id, page, tool: 'pen', color: '#E5484D', points: pts.map(([x, y]) => [x, y * A, 0.5]) });
const loop = (cx: number, cy: number, r: number) => S(Array.from({ length: 25 }, (_, i) => [cx + r * Math.cos((i / 24) * 2 * Math.PI * 0.97), cy + r * Math.sin((i / 24) * 2 * Math.PI * 0.97)] as [number, number]));

describe('inkSummary', () => {
  it('describes a loop by what it encloses', () => {
    expect(inkSummary([loop(600, 600, 60)], g)).toBe('- a loop around #d1 "x"');
  });
  it('describes an underline by the text line above it', () => {
    expect(inkSummary([S([[60, 188], [200, 190], [330, 189]])], g)).toBe('- an underline under t2 "A point x in image 1 back-projects to a…"');
  });
  it('otherwise gives the stroke ends and the nearest mark', () => {
    expect(inkSummary([S([[850, 700], [870, 760], [880, 850]])], g)).toBe('- a stroke from 850,700 to 880,850 near #d2');
  });
  it('keeps the 3 newest strokes on this page, newest first, and is undefined without any', () => {
    const old = S([[850, 700], [880, 850]]);
    const other = S([[100, 100], [200, 200]], 4);
    const s = inkSummary([old, loop(600, 600, 60), S([[60, 188], [330, 189]]), S([[850, 700], [870, 760], [880, 850]]), other], g)!;
    expect(s.split('\n')).toHaveLength(3);
    expect(s.split('\n')[0]).toMatch(/^- a stroke from/);
    expect(s.split('\n')[2]).toMatch(/^- a loop/);
    expect(inkSummary([other], g)).toBeUndefined();
  });
});
