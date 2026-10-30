// src/ui/BoardPen.tsx
import { useEffect, useRef, useState } from 'react';
import { bboxOf, isLoop } from '../agent/moment';
import './ui.css';

type Rect = { x: number; y: number; w: number; h: number };

/**
 * Point-to-ask on the board: while the pen is out, a loop drawn over the board (in the student's
 * blue) reports the screen rect it encloses; anything else fades. The loop stays while `keep` is set
 * (the chip it made is on the bar). Board strokes are pointing, not notes: they are not stored.
 */
export function BoardPen({ rect, color, keep, onLoop, onWheel }: { rect: Rect; color: string; keep: boolean; onLoop(r: Rect): void; /** The board's own wheel (scroll, pinch-zoom): the pen covers it. */ onWheel(e: WheelEvent): void }) {
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
  const [pts, setPts] = useState<{ x: number; y: number }[]>([]);
  const [done, setDone] = useState(false);
  const drawing = useRef(false);
  const shown = drawing.current || (done && keep);
  const d = pts.length ? `M${pts.map((p) => `${(p.x - rect.x).toFixed(1)} ${(p.y - rect.y).toFixed(1)}`).join('L')}` : '';
  return (
    <svg
      className="board-pen"
      style={{ left: rect.x, top: rect.y, width: rect.w, height: rect.h }}
      aria-label="Circle something on the board to ask about it"
      ref={svgRef}
      onPointerDown={(e) => { drawing.current = true; setDone(false); (e.target as Element).setPointerCapture?.(e.pointerId); setPts([{ x: e.clientX, y: e.clientY }]); }}
      onPointerMove={(e) => { if (drawing.current) setPts((p) => [...p, { x: e.clientX, y: e.clientY }]); }}
      onPointerUp={() => {
        drawing.current = false;
        if (isLoop(pts)) { setDone(true); onLoop(bboxOf(pts)); } else setPts([]);
      }}
    >
      {shown && d && <path d={d} fill="none" stroke={color} strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" opacity={0.9} />}
    </svg>
  );
}
