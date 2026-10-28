import { memo, useMemo, useRef, useState, type CSSProperties, type PointerEvent } from 'react';
import { getStroke, type StrokeOptions } from 'perfect-freehand';
import { ink, useInk, type StudentStroke } from './store';

type P3 = [number, number, number];

const PEN: StrokeOptions = { size: 3.4, thinning: 0.55, smoothing: 0.5, streamline: 0.45 };
const HIGHLIGHTER: StrokeOptions = { size: 18, thinning: 0, smoothing: 0.6, streamline: 0.6 };
const ERASE_R = 10;
const HL_ATTRS = { opacity: 0.35, style: { mixBlendMode: 'multiply' } } as const;

const average = (a: number, b: number) => (a + b) / 2;

/** Standard perfect-freehand outline → SVG path (average quadratic). */
export function getSvgPathFromStroke(points: number[][], closed = true): string {
  const len = points.length;
  if (len < 4) return '';
  let a = points[0];
  let b = points[1];
  const c = points[2];
  let d = `M${a[0].toFixed(2)},${a[1].toFixed(2)} Q${b[0].toFixed(2)},${b[1].toFixed(2)} ${average(b[0], c[0]).toFixed(2)},${average(b[1], c[1]).toFixed(2)} T`;
  for (let i = 2, max = len - 1; i < max; i++) {
    a = points[i];
    b = points[i + 1];
    d += `${average(a[0], b[0]).toFixed(2)},${average(a[1], b[1]).toFixed(2)} `;
  }
  if (closed) d += 'Z';
  return d;
}

function strokePath(tool: StudentStroke['tool'], points: P3[], last: boolean) {
  // Mouse and trackpad report a flat 0.5; simulate pressure from velocity in that case.
  const flat = points.every((p) => p[2] === 0.5);
  return getSvgPathFromStroke(getStroke(points, { ...(tool === 'pen' ? PEN : HIGHLIGHTER), simulatePressure: flat, last }));
}

function distToSeg(px: number, py: number, a: P3, b: P3) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const l2 = dx * dx + dy * dy;
  const t = l2 ? Math.max(0, Math.min(1, ((px - a[0]) * dx + (py - a[1]) * dy) / l2)) : 0;
  return Math.hypot(px - (a[0] + t * dx), py - (a[1] + t * dy));
}

/** A stroke is hit if the pointer is within ERASE_R of any point (or the segment between two points). */
function hits(s: StudentStroke, x: number, y: number) {
  const pts = s.points;
  if (pts.length === 1) return Math.hypot(x - pts[0][0], y - pts[0][1]) <= ERASE_R;
  for (let i = 1; i < pts.length; i++) if (distToSeg(x, y, pts[i - 1], pts[i]) <= ERASE_R) return true;
  return false;
}

const StrokePath = memo(function StrokePath({ s }: { s: StudentStroke }) {
  const d = useMemo(() => strokePath(s.tool, s.points, true), [s]);
  return <path d={d} fill={s.color} {...(s.tool === 'highlighter' ? HL_ATTRS : null)} />;
});

const dotCursor = (color: string) =>
  `url("data:image/svg+xml,${encodeURIComponent(
    `<svg xmlns='http://www.w3.org/2000/svg' width='12' height='12'><circle cx='6' cy='6' r='2.5' fill='${color}' stroke='white' stroke-width='1.25'/></svg>`,
  )}") 6 6, crosshair`;
const ERASER_CURSOR = `url("data:image/svg+xml,${encodeURIComponent(
  `<svg xmlns='http://www.w3.org/2000/svg' width='22' height='22'><circle cx='11' cy='11' r='9' fill='rgba(255,255,255,.55)' stroke='#1D1D1F' stroke-width='1.25'/></svg>`,
)}") 11 11, cell`;
const hlCursor = (color: string) =>
  `url("data:image/svg+xml,${encodeURIComponent(
    `<svg xmlns='http://www.w3.org/2000/svg' width='10' height='22'><rect x='2' y='2' width='6' height='18' rx='1.5' fill='${color}' fill-opacity='.55' stroke='#1D1D1F' stroke-width='1'/></svg>`,
  )}") 5 11, crosshair`;

export function StudentInkLayer({ page, spaceH }: { page: number; spaceH: number }) {
  const { canvasOn, tool, color, strokes } = useInk();
  const svgRef = useRef<SVGSVGElement>(null);
  const [live, setLive] = useState<P3[] | null>(null);
  const drawing = useRef<{ id: number; points: P3[]; tool: 'pen' | 'highlighter'; color: string } | null>(null);
  const erasing = useRef<number | null>(null);

  const mine = useMemo(() => strokes.filter((s) => s.page === page), [strokes, page]);

  const toSpace = (e: { clientX: number; clientY: number; pressure: number }): P3 => {
    const r = svgRef.current!.getBoundingClientRect();
    return [((e.clientX - r.left) / r.width) * 1000, ((e.clientY - r.top) / r.height) * spaceH, e.pressure || 0.5];
  };

  const eraseAt = (p: P3) => {
    const ids = ink.get().strokes.filter((s) => s.page === page && hits(s, p[0], p[1])).map((s) => s.id);
    ink.erase(ids);
  };

  const onPointerDown = (e: PointerEvent<SVGSVGElement>) => {
    if (!canvasOn || (e.pointerType === 'mouse' && e.button !== 0)) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    const p = toSpace(e);
    if (tool === 'eraser') {
      erasing.current = e.pointerId;
      eraseAt(p);
      return;
    }
    drawing.current = { id: e.pointerId, points: [p], tool, color };
    setLive([p]);
  };

  const onPointerMove = (e: PointerEvent<SVGSVGElement>) => {
    if (erasing.current === e.pointerId) {
      eraseAt(toSpace(e));
      return;
    }
    const d = drawing.current;
    if (!d || d.id !== e.pointerId) return;
    const evs = e.nativeEvent.getCoalescedEvents?.() ?? [];
    for (const ev of evs.length ? evs : [e]) d.points.push(toSpace(ev));
    setLive([...d.points]);
  };

  const finish = (e: PointerEvent<SVGSVGElement>) => {
    if (erasing.current === e.pointerId) erasing.current = null;
    const d = drawing.current;
    if (!d || d.id !== e.pointerId) return;
    drawing.current = null;
    setLive(null);
    ink.add({ page, tool: d.tool, color: d.color, points: d.points });
  };

  const style: CSSProperties = {
    position: 'absolute',
    inset: 0,
    width: '100%',
    height: '100%',
    overflow: 'visible',
    // Multiply the whole layer too, so highlighter strokes darken the page text instead of veiling it.
    mixBlendMode: 'multiply',
    pointerEvents: canvasOn ? 'auto' : 'none',
    touchAction: canvasOn ? 'none' : 'auto',
    cursor: !canvasOn ? undefined : tool === 'eraser' ? ERASER_CURSOR : tool === 'highlighter' ? hlCursor(color) : dotCursor(color),
  };

  const d = drawing.current;
  return (
    <svg
      ref={svgRef}
      className="student-ink"
      viewBox={`0 0 1000 ${spaceH}`}
      preserveAspectRatio="none"
      style={style}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={finish}
      onPointerCancel={finish}
      onLostPointerCapture={finish}
    >
      {mine.map((s) => <StrokePath key={s.id} s={s} />)}
      {live && d && (
        <path d={strokePath(d.tool, live, false)} fill={d.color} {...(d.tool === 'highlighter' ? HL_ATTRS : null)} />
      )}
    </svg>
  );
}
