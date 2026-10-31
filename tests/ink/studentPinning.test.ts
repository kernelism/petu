// Student ink is pinned to what it is drawn on (spec "Student ink"): a board stroke lives in its section
// (src/ink/student/BoardInk.tsx) in the section's units, so the Desk's own viewBox changes (crop,
// growth) and the sheet's zoom and scroll carry it; a page stroke lives in the page's space.
import { afterEach, describe, expect, it } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { createSection } from '../../src/desk/Desk';
import { BoardInk, studentLayer } from '../../src/ink/student/BoardInk';
import { StudentInkLayer } from '../../src/ink/student/StudentInkLayer';
import { ink, PEN_COLORS } from '../../src/ink/student/store';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | null = null;
afterEach(() => { act(() => root?.unmount()); root = null; document.body.innerHTML = ''; ink.reset(); });
const render = (el: ReturnType<typeof createElement>) => { const host = document.body.appendChild(document.createElement('div')); root = createRoot(host); act(() => root!.render(el)); return host; };

describe('student ink pinning', () => {
  it('a board stroke is drawn in its section, in section units, beside the agent layers', () => {
    const sec = createSection({ id: 's1', page: 3, size: 'm' } as Parameters<typeof createSection>[0]);
    document.body.appendChild(sec.el);
    render(createElement(BoardInk));
    act(() => { ink.add({ page: 0, on: 's1', w: 4, tool: 'pen', color: PEN_COLORS[0], points: [[100, 100, 0.5], [200, 120, 0.5], [300, 100, 0.5], [400, 130, 0.5]] }); });
    const layer = sec.el.querySelector(':scope > svg.desk-region-student')!;
    expect(layer).toBeTruthy();
    expect(layer.getAttribute('viewBox')).toBe(sec.el.querySelector('svg.desk-region-ink')!.getAttribute('viewBox'));
    expect(layer.querySelectorAll('path')).toHaveLength(1);
    // The Desk re-frames every section layer by this selector (crop, growth): the student's is among them.
    expect([...sec.el.querySelectorAll('svg:not([data-svgboard])')]).toContain(layer);
    expect(layer.querySelector('path')!.getAttribute('d')).toMatch(/^M1\d\d\./);
  });

  it('one layer per section, made once; undo and clear take the strokes away', () => {
    const sec = createSection({ id: 's2', page: 1, size: 'm' } as Parameters<typeof createSection>[0]);
    document.body.appendChild(sec.el);
    render(createElement(BoardInk));
    act(() => { for (let i = 0; i < 2; i++) ink.add({ page: 0, on: 's2', w: 4, tool: 'pen', color: PEN_COLORS[0], points: [[10, 10, 0.5], [60, 40, 0.5], [90, 10, 0.5], [120, 30, 0.5]] }); });
    expect(studentLayer(sec.el).querySelectorAll('path')).toHaveLength(2);
    expect(sec.el.querySelectorAll('svg.desk-region-student')).toHaveLength(1);
    act(() => ink.undoLast());
    expect(studentLayer(sec.el).querySelectorAll('path')).toHaveLength(1);
    act(() => ink.clear());
    expect(studentLayer(sec.el).querySelectorAll('path')).toHaveLength(0);
  });

  it('a page stroke is drawn in the page space (0–1000 across), so it scales and scrolls with the page', () => {
    const host = render(createElement(StudentInkLayer, { page: 5, spaceH: 1294 }));
    act(() => { ink.add({ page: 5, tool: 'pen', color: PEN_COLORS[0], points: [[500, 600, 0.5], [600, 620, 0.5], [700, 600, 0.5], [800, 640, 0.5]] }); ink.add({ page: 6, tool: 'pen', color: PEN_COLORS[0], points: [[1, 1, 0.5], [9, 9, 0.5]] }); });
    const svg = host.querySelector('svg.student-ink')!;
    expect(svg.getAttribute('viewBox')).toBe('0 0 1000 1294');
    expect(svg.getAttribute('preserveAspectRatio')).toBe('none');
    expect(svg.querySelectorAll('path')).toHaveLength(1); // page 6's stroke is on page 6
  });
});
