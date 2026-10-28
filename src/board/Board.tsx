import { forwardRef, useImperativeHandle, useRef } from 'react';
import { X } from 'lucide-react';
import type { ViewerApi } from '../pdf/viewerApi';
import type { SPt } from '../geometry/space';
import { StudentInkLayer } from '../ink/student/StudentInkLayer';
import { BOARD_H, BOARD_INK, BOARD_W, boardRuns, type BoardHandle, type WriteOpts } from './boardText';
import { BOARD_PAGE } from '../script/types';
import { prefersReducedMotion } from '../ink/agent/animate';
import './board.css';

export type { BoardHandle } from './boardText';

const SVG = 'http://www.w3.org/2000/svg';
/** Font sizes in board-space units. */
const SIZES = { s: 22, m: 30, l: 40 } as const;
const CHARS_PER_SEC = 34;
/** A single write never takes longer than this. */
const WRITE_MAX_MS = 900;
const FADE_MS = 250;
const SYSTEM = '-apple-system, BlinkMacSystemFont, "SF Pro Text", system-ui, sans-serif';
const HAND = '"Bradley Hand", "Segoe Print", "Comic Sans MS", cursive';


const frame = () => new Promise<number>((r) => requestAnimationFrame(r));
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
let clipSeq = 0;

/** Writes `text` into its own group in `g`. Letters reveal left to right (or fade in, in clean style). */
async function writeText(g: SVGGElement, at: SPt, text: string, size: 's' | 'm' | 'l', o: WriteOpts): Promise<void> {
  const own = g.appendChild(document.createElementNS(SVG, 'g'));
  const t = document.createElementNS(SVG, 'text');
  const hand = o.style === 'hand';
  Object.entries({
    x: at.x, y: at.y, 'font-size': SIZES[size] * (hand ? 1.12 : 1), 'font-family': hand ? HAND : SYSTEM,
    'font-weight': hand ? 700 : 500, fill: BOARD_INK, 'dominant-baseline': 'middle', 'data-run': '',
  }).forEach(([k, v]) => t.setAttribute(k, String(v)));
  t.textContent = text;
  own.appendChild(t);

  const speed = o.speed ?? 1;
  if (o.style === 'clean' || o.fadeMs != null || prefersReducedMotion()) {
    const ms = o.fadeMs ?? FADE_MS;
    own.style.opacity = '0';
    own.style.transition = `opacity ${ms}ms ease-out`;
    await frame();
    own.style.opacity = '1';
    if (!o.signal?.aborted) await wait(ms);
    return;
  }

  // Reveal through a clip rect that grows left to right at writing pace.
  const b = t.getBBox();
  const id = `bw${++clipSeq}`;
  const clip = document.createElementNS(SVG, 'clipPath');
  clip.setAttribute('id', id);
  const r = document.createElementNS(SVG, 'rect');
  Object.entries({ x: b.x - 6, y: b.y - 12, height: b.height + 24, width: 0 }).forEach(([k, v]) => r.setAttribute(k, String(v)));
  clip.appendChild(r);
  own.insertBefore(clip, t);
  t.setAttribute('clip-path', `url(#${id})`);
  const full = b.width + 12;
  const dur = Math.min(WRITE_MAX_MS, Math.max(220, (Array.from(text).length / CHARS_PER_SEC) * 1000)) * speed;
  const t0 = performance.now();
  for (;;) {
    const k = o.signal?.aborted ? 1 : Math.min(1, (performance.now() - t0) / dur);
    r.setAttribute('width', String(full * k));
    if (k >= 1) break;
    await frame();
  }
  t.removeAttribute('clip-path');
  clip.remove();
}

type Props = { open: boolean; onClose(): void };

/** The board: a blank 1000 × 700 sheet beside the PDF. Always mounted so it can be measured and drawn on. */
export const Board = forwardRef<BoardHandle, Props>(function Board({ open, onClose }, ref) {
  const hlRef = useRef<SVGGElement>(null);
  const agRef = useRef<SVGGElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);

  useImperativeHandle(ref, () => ({
    layers: () => (hlRef.current && agRef.current ? { highlight: hlRef.current, agent: agRef.current } : null),
    textRuns: () => boardRuns(agRef.current),
    scale: () => (svgRef.current?.getBoundingClientRect().width ?? BOARD_W) / BOARD_W,
    write: (at, text, size, o) => (agRef.current ? writeText(agRef.current, at, text, size, o) : Promise.resolve()),
  }), []);

  const viewBox = `0 0 ${BOARD_W} ${BOARD_H}`;
  return (
    <aside className={`board${open ? ' is-open' : ''}`} aria-label="Board" aria-hidden={!open}>
      <header className="board-head">
        <span className="board-title">Board</span>
        <button type="button" className="board-close" onClick={onClose} aria-label="Close board">
          <X size={15} strokeWidth={2} />
        </button>
      </header>
      <div className="board-body">
        <div className="board-sheet">
          <svg className="board-layer board-highlight" viewBox={viewBox} aria-hidden="true"><g ref={hlRef} /></svg>
          <div className="board-overlay"><StudentInkLayer page={BOARD_PAGE} spaceH={BOARD_H} /></div>
          <svg ref={svgRef} className="board-layer" viewBox={viewBox} aria-hidden="true"><g ref={agRef} /></svg>
        </div>
      </div>
    </aside>
  );
});

/** The viewer API with page 0 routed to the board. */
export function withBoard(v: ViewerApi, b: BoardHandle | null): ViewerApi {
  if (!b) return v;
  const isBoard = (p: number) => p === BOARD_PAGE;
  return {
    ...v,
    spaceHeight: (p) => (isBoard(p) ? BOARD_H : v.spaceHeight(p)),
    scale: (p) => (p != null && isBoard(p) ? b.scale() : v.scale(p)),
    layers: (p) => (isBoard(p) ? b.layers() : v.layers(p)),
    allLayers: () => {
      const L = b.layers();
      const hasInk = L && (L.highlight.firstChild || L.agent.firstChild);
      return hasInk ? [...v.allLayers(), L] : v.allLayers();
    },
    textRuns: (p) => (isBoard(p) ? Promise.resolve(b.textRuns()) : v.textRuns(p)),
    scrollToPage: (p, y) => (isBoard(p) ? Promise.resolve() : v.scrollToPage(p, y)),
    ensureVisible: (p, y) => (isBoard(p) ? Promise.resolve(false) : v.ensureVisible(p, y)),
  };
}
