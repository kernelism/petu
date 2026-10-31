// src/ui/BoardPen.tsx
import { useEffect, useRef, useState } from 'react';
import { ink, type StudentStroke } from '../ink/student/store';
import { sectionAt, sectionEl, toSection } from '../ink/student/BoardInk';
import { ERASE_R, HIGHLIGHTER_SIZE, hits, inkCursor, PEN_SIZE, strokePath } from '../ink/student/StudentInkLayer';
import './ui.css';

type Rect = { x: number; y: number; w: number; h: number };
type P3 = [number, number, number];

/** A page's pen draws ~0.8 px per unit at 1440 × 900: board ink keeps that width on screen as it is drawn. */
const PX_PER_PAGE_UNIT = 0.8;

/**
 * The student's pen over the board: a stroke is kept, pinned to the drawing (section) it was made on
 * (src/ink/student/BoardInk.tsx), in the student's colour; the eraser takes board strokes away.
 * What a stroke means (a circle, an underline, an arrow, a "?") is read like a page stroke's (App).
 */
export function BoardPen({ rect, color, tool, onWheel }: { rect: Rect; color: string; tool: 'pen' | 'highlighter' | 'eraser'; /** The board's own wheel (scroll, pinch-zoom): the pen covers it. */ onWheel(e: WheelEvent): void }) {
  const svgRef = useRef<SVGSVGElement>(null);
  const wheelRef = useRef(onWheel);
  wheelRef.current = onWheel;
  // A native, non-passive listener: the board under the pen scrolls and pinch-zooms exactly as without
  // it (React's wheel handler is passive, so a pinch would zoom the browser's page instead).
  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const f = (e: WheelEvent) => wheelRef.current(e);
    el.addEventListener('wheel', f, { passive: false });
    return () => el.removeEventListener('wheel', f);
  }, []);
  const [live, setLive] = useState<P3[] | null>(null);
  const pts = useRef<P3[]>([]);
  const mode = useRef<'draw' | 'erase' | null>(null);

  const eraseAt = (x: number, y: number) => {
    const gone: number[] = [];
    const by = new Map<string, StudentStroke[]>();
    for (const s of ink.get().strokes) if (s.on != null) by.set(s.on, [...(by.get(s.on) ?? []), s]);
    for (const [id, ss] of by) {
      const el = sectionEl(id);
      const t = el && toSection(el);
      if (!t) continue;
      const p = t.map(x, y);
      for (const s of ss) if (hits(s, p.x, p.y, ERASE_R / t.scale)) gone.push(s.id);
    }
    ink.erase(gone);
  };

  const finish = () => {
    const was = mode.current;
    mode.current = null;
    if (was !== 'draw') return;
    const p = pts.current;
    pts.current = [];
    setLive(null);
    if (!p.length || tool === 'eraser') return;
    const el = sectionAt(p.map(([x, y]) => ({ x, y })));
    const t = el && toSection(el);
    if (!el || !t || !el.dataset.id) return; // nothing drawn there to pin it to
    const size = ((tool === 'pen' ? PEN_SIZE : HIGHLIGHTER_SIZE) * PX_PER_PAGE_UNIT) / t.scale;
    ink.add({ page: 0, on: el.dataset.id, w: size, tool, color, points: p.map(([x, y, pr]) => { const q = t.map(x, y); return [q.x, q.y, pr] as P3; }) });
  };

  return (
    <svg
      className="board-pen"
      style={{ left: rect.x, top: rect.y, width: rect.w, height: rect.h, cursor: inkCursor(tool, color) }}
      viewBox={`${rect.x} ${rect.y} ${rect.w} ${rect.h}`}
      aria-label="Draw on the board"
      ref={svgRef}
      onPointerDown={(e) => {
        if (e.pointerType === 'mouse' && e.button !== 0) return;
        e.preventDefault();
        (e.target as Element).setPointerCapture?.(e.pointerId);
        if (tool === 'eraser') { mode.current = 'erase'; eraseAt(e.clientX, e.clientY); return; }
        mode.current = 'draw';
        pts.current = [[e.clientX, e.clientY, e.pressure || 0.5]];
        setLive(pts.current.slice());
      }}
      onPointerMove={(e) => {
        if (mode.current === 'erase') { eraseAt(e.clientX, e.clientY); return; }
        if (mode.current !== 'draw') return;
        const evs = e.nativeEvent.getCoalescedEvents?.() ?? [];
        for (const ev of evs.length ? evs : [e]) pts.current.push([ev.clientX, ev.clientY, ev.pressure || 0.5]);
        setLive(pts.current.slice());
      }}
      onPointerUp={finish}
      onPointerCancel={finish}
      onLostPointerCapture={finish}
    >
      {live && tool !== 'eraser' && (
        <path d={strokePath(tool, live, false, (tool === 'pen' ? PEN_SIZE : HIGHLIGHTER_SIZE) * PX_PER_PAGE_UNIT)} fill={color} {...(tool === 'highlighter' ? { opacity: 0.35 } : null)} />
      )}
    </svg>
  );
}
