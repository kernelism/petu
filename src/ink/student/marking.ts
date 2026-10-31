// src/ink/student/marking.ts — reads each new stroke as a gesture (gesture.ts), finds its target
// (target.ts) and records the mark (marks.ts). Strokes are read one at a time, in order, so a "?"'s
// dot or an arrow's head always meets the stroke it completes. The DOM and the PDF come in as deps.
import { joins, kindOf, shapeOf, type Pt, type Seen } from './gesture';
import { marks } from './marks';
import { pageTarget, type BoardTarget, type Figure, type Line, type Target } from './target';
import type { StudentStroke } from './store';

export type MarkingDeps = {
  /** A page's text lines and figures (model coords), and its space height (stroke y → model y). */
  page(page: number): Promise<{ lines: Line[]; figures: Figure[]; spaceH: number }>;
  /** What a board stroke covers: `pts` in its section's units; an arrow's ends as `from`/`to`. */
  board(on: string, pts: Pt[], kind: ReturnType<typeof kindOf>, ends?: { from: Pt; to: Pt }): { target: BoardTarget; to?: BoardTarget };
  /** A mark was made or changed (the "?"-and-pause watcher). */
  onMark?(id: number): void;
};

type Last = { seen: Seen; mark: number; stroke: number; surface: string; tool: StudentStroke['tool'] };

export class Marking {
  private chain: Promise<void> = Promise.resolve();
  private last: Last | null = null;
  constructor(private deps: MarkingDeps) {}

  /** Reads `st` after every stroke before it; resolves when its mark is recorded. */
  stroke(st: StudentStroke): Promise<void> {
    this.chain = this.chain.then(() => this.read(st)).catch((e) => { console.warn('[marks]', e); });
    return this.chain;
  }

  reset() { this.last = null; }

  private async read(st: StudentStroke): Promise<void> {
    const pts: Pt[] = st.points.map(([x, y]) => ({ x, y }));
    if (!pts.length) return;
    const seen: Seen = { shape: shapeOf(pts), pts, t: st.t ?? Date.now() };
    const surface = st.on != null ? `b:${st.on}` : `p:${st.page}`;
    const last = this.last;
    const joined = last && last.surface === surface && st.tool === 'pen' && last.tool === 'pen' ? joins(last.seen, seen) : null;
    const prev = joined && marks.all().find((m) => m.id === last!.mark);
    if (joined && prev) {
      const all = [...last!.seen.pts, ...pts];
      const r = await this.target(st, joined.kind, joined.kind === 'arrow' ? last!.seen.pts : all, joined.kind === 'arrow' ? joined : undefined);
      marks.update(prev.id, { kind: joined.kind, strokes: [...prev.strokes, st.id], target: r.target, ...(r.to ? { to: r.to } : { to: undefined }), alone: { kind: prev.kind, target: prev.target, ...(prev.to ? { to: prev.to } : {}) } });
      this.last = null; // a gesture is two strokes at most
      this.deps.onMark?.(prev.id);
      return;
    }
    const kind = kindOf(seen.shape, st.tool);
    const ends = seen.shape.kind === 'arrow' ? { from: seen.shape.from, to: seen.shape.to } : undefined;
    const r = await this.target(st, kind, pts, ends);
    const id = marks.add({ kind, tool: st.tool, strokes: [st.id], target: r.target, ...(r.to ? { to: r.to } : {}), round: st.round ?? 0 });
    this.last = { seen, mark: id, stroke: st.id, surface, tool: st.tool };
    this.deps.onMark?.(id);
  }

  private async target(st: StudentStroke, kind: ReturnType<typeof kindOf>, pts: Pt[], ends?: { from: Pt; to: Pt }): Promise<{ target: Target; to?: Target }> {
    if (st.on != null) return this.deps.board(st.on, pts, kind, ends);
    const g = await this.deps.page(st.page).catch(() => ({ lines: [], figures: [], spaceH: 1000 }));
    const k = 1000 / (g.spaceH || 1000);
    const m = (p: Pt): Pt => ({ x: p.x, y: p.y * k });
    return pageTarget(kind, st.page, pts.map(m), g.lines, g.figures, { tool: st.tool, ...(ends ? { from: m(ends.from), to: m(ends.to) } : {}) });
  }
}
