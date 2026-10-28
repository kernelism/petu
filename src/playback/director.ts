import type { Action } from '../script/types';
import type { ViewerApi } from '../pdf/viewerApi';
import { toSpace, rectToSpace } from '../geometry/space';
import { circleStroke, lineStroke, arrowStrokes, boxStroke, rng, type Stroke } from '../ink/agent/strokes';
import { drawStrokes } from '../ink/agent/animate';
import { drawLabel, drawHighlight, fadeOut } from '../ink/agent/marks';
import { locateQuote } from '../locate/locateQuote';
import type { Settings } from '../settings/settings';

const SVG = 'http://www.w3.org/2000/svg';

/** Timing of one action, for the ?debug panel. All times are performance.now() ms. */
export type ActionTiming = { action: Action; firedAt: number; startedAt: number; endedAt?: number; skipped?: string };

type Deps = {
  viewer: () => ViewerApi | null;
  settings: () => Settings;
  onScrolledTo(page: number): void;
  /** Debug hook: called when an action starts executing and again when it ends. */
  onTiming?(t: ActionTiming): void;
};

/** Executes actions one after another against the viewer. Highlights don't block the queue for long. */
export class Director {
  private chain: Promise<void> = Promise.resolve();
  private ctrl = new AbortController();
  private seed = 1;
  constructor(private d: Deps) {}

  run(a: Action): void {
    const signal = this.ctrl.signal;
    const firedAt = performance.now();
    this.chain = this.chain
      .then(async () => {
        if (signal.aborted) return;
        const t: ActionTiming = { action: a, firedAt, startedAt: performance.now() };
        this.d.onTiming?.(t);
        const skipped = await this.exec(a, signal);
        this.d.onTiming?.({ ...t, endedAt: performance.now(), skipped: skipped || undefined });
      })
      .catch((e) => console.warn('[director]', e));
  }

  /** Warms the text-run cache for an action's page as soon as it is parsed, so anchors resolve instantly when it fires. */
  prefetch(a: Action): void {
    if (a.kind === 'clear' || !('quote' in a)) return;
    const v = this.d.viewer();
    if (v && a.page >= 1 && a.page <= v.numPages()) void v.textRuns(a.page).catch(() => {});
  }

  stop(): void { this.ctrl.abort(); this.ctrl = new AbortController(); this.chain = Promise.resolve(); }

  /**
   * Starts a new answer: stops the old one and fades its ink out. The fade sits at the head of the
   * queue, so the caller can start streaming right away and the first action still waits for it.
   */
  begin(ms = 300): Promise<void> {
    this.stop();
    const cleared = this.clear(ms).catch(() => {});
    this.chain = cleared;
    return cleared;
  }

  async clear(ms = 300): Promise<void> {
    const v = this.d.viewer();
    if (!v) return;
    const groups = v.allLayers().flatMap((l) => [l.highlight, l.agent]);
    if (groups.length) await fadeOut(groups, ms);
  }

  private async reveal(v: ViewerApi, page: number, y: number) {
    if (await v.ensureVisible(page, y)) this.d.onScrolledTo(page);
  }

  /** Returns a reason string when the action was skipped. */
  private async exec(a: Action, signal: AbortSignal): Promise<string | void> {
    const v = this.d.viewer();
    if (!v) return 'no viewer';
    if (a.kind === 'clear') return this.clear();
    if (a.page < 1 || a.page > v.numPages()) { console.warn('[director] page out of range', a); return 'page out of range'; }
    const L = v.layers(a.page);
    if (!L) return 'no layers';
    const H = v.spaceHeight(a.page);
    const s = this.d.settings();
    const r = s.inkStyle === 'hand' ? rng(this.seed++) : null;
    // Each action draws into its own group. clear() detaches these, so a mark still animating
    // from a stopped answer keeps writing into a detached node instead of reappearing.
    const own = (parent: SVGGElement) => parent.appendChild(document.createElementNS(SVG, 'g'));
    const ink = (strokes: Stroke[]) =>
      drawStrokes(own(L.agent), strokes, { color: s.inkColor, width: s.inkStyle === 'hand' ? 3.4 : 3, mode: s.inkStyle === 'clean' ? 'fade' : 'trace', scale: v.scale(), signal });
    const runs = async () => locateQuote(await v.textRuns(a.page), (a as { quote: string }).quote, (a as { near?: { x: number; y: number } }).near);

    switch (a.kind) {
      case 'scroll':
        this.d.onScrolledTo(a.page); // the pill names the destination as the glide starts
        await v.scrollToPage(a.page, a.y);
        return;
      case 'highlight':
      case 'underline': {
        const rects = await runs();
        if (signal.aborted) return;
        if (!rects.length) { console.warn('[director] quote not found', a.quote); return 'quote not found'; }
        await this.reveal(v, a.page, rects[0].y);
        if (signal.aborted) return;
        const sr = rects.map((x) => rectToSpace(x, H));
        if (a.kind === 'highlight') { void drawHighlight(own(L.highlight), sr, s.highlightColor); await new Promise((res) => setTimeout(res, 150)); }
        else await ink(sr.map((x) => lineStroke({ x: x.x, y: x.y + x.h + 2 }, { x: x.x + x.w, y: x.y + x.h + 2 }, r)));
        return;
      }
      case 'circle':
      case 'box': {
        // Anchored form: resolve text → bounding box in page space (exact). Otherwise use coordinates.
        let box: { x: number; y: number; w: number; h: number };
        if ('quote' in a) {
          const rects = await runs();
          if (signal.aborted) return;
          if (!rects.length) { console.warn('[director] anchor not found', a.quote); return 'anchor not found'; }
          const sr = rects.map((x) => rectToSpace(x, H));
          const x1 = Math.min(...sr.map((q) => q.x)), y1 = Math.min(...sr.map((q) => q.y));
          const x2 = Math.max(...sr.map((q) => q.x + q.w)), y2 = Math.max(...sr.map((q) => q.y + q.h));
          box = { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
          await this.reveal(v, a.page, rects[0].y);
        } else if (a.kind === 'circle') {
          const c = toSpace(a.at, H);
          box = { x: c.x - a.rx, y: c.y - a.ry, w: a.rx * 2, h: a.ry * 2 };
          await this.reveal(v, a.page, a.at.y);
        } else {
          const p = toSpace(a.at, H);
          box = { x: p.x, y: p.y, w: a.w, h: (a.h * H) / 1000 };
          await this.reveal(v, a.page, a.at.y + a.h / 2);
        }
        if (signal.aborted) return;
        const anchored = 'quote' in a;
        if (a.kind === 'circle') {
          // Pad anchored text so the loop sits around it, not on it; keep tiny targets readable.
          const rx = anchored ? Math.max(12, box.w / 2 + 8) : box.w / 2;
          const ry = anchored ? Math.max(12, box.h / 2 + 7) : box.h / 2;
          return ink([circleStroke({ x: box.x + box.w / 2, y: box.y + box.h / 2 }, rx, ry, r)]);
        }
        const pad = anchored ? 6 : 0;
        return ink([boxStroke(box.x - pad, box.y - pad, box.w + pad * 2, box.h + pad * 2, r)]);
      }
      case 'line':
        await this.reveal(v, a.page, (a.from.y + a.to.y) / 2);
        if (signal.aborted) return;
        return ink([lineStroke(toSpace(a.from, H), toSpace(a.to, H), r)]);
      case 'arrow':
        await this.reveal(v, a.page, (a.from.y + a.to.y) / 2);
        if (signal.aborted) return;
        return ink(arrowStrokes(toSpace(a.from, H), toSpace(a.to, H), r));
      case 'label':
        await this.reveal(v, a.page, a.at.y);
        if (signal.aborted) return;
        return drawLabel(own(L.agent), toSpace(a.at, H), a.text, s.inkStyle, s.inkColor);
    }
  }
}
