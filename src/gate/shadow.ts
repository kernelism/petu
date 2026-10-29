// src/gate/shadow.ts — the live gate's shadow board: a second Director in instant mode drawing into a
// hidden copy of the board (the same section factory as the live Desk, the same pixel width and body
// text size), so a unit's actions are built by the real toolkit, offscreen, before the unit is
// released. Its skip reasons are the live board's skip reasons (shadow fidelity is audited by
// liveSkipAfterPass). Page ink draws into hidden page layers; text runs come from the live viewer.
import { Director, type ActionTiming } from '../playback/director';
import { createSection, sceneSpaceOf, type DeskSection } from '../desk/Desk';
import { REGION_H, REGION_W, type RawAction } from '../script/types';
import { ScriptParser } from '../script/parser';
import type { DeskApi, RegionInfo, RegionSpec, SceneClaim, ConnectorHandle } from '../desk/types';
import type { PageLayers, ViewerApi } from '../pdf/viewerApi';
import type { Settings } from '../settings/settings';
import type { Grounding } from '../geometry/resolve';
import type { ElementEntry } from '../desk/registry';
import type { El } from './layout';
import { toEl } from './verdict';
import type { ShadowBoard } from './live';

const SVG = 'http://www.w3.org/2000/svg';
const WHOLE = { x: 0, y: 0, w: REGION_W, h: REGION_H };

/** A hidden host as wide as the live board: laid out (so text measures), never seen. */
function hiddenHost(widthPx: number): HTMLDivElement {
  const el = document.createElement('div');
  el.setAttribute('aria-hidden', 'true');
  el.dataset.petuShadow = '';
  Object.assign(el.style, { position: 'fixed', left: '-100000px', top: '0', visibility: 'hidden', contain: 'strict', width: `${Math.max(1, widthPx)}px`, height: '2000px', pointerEvents: 'none' });
  document.body.appendChild(el);
  return el;
}

/** The board, offscreen: sections from the live Desk's factory, no pans, no glides. */
export class ShadowDesk implements DeskApi {
  /** Every section on the board (they persist across answers), and this answer's ids. */
  private all: { sec: DeskSection; spec: RegionSpec; claims: SceneClaim[] }[] = [];
  private secs = new Map<string, { sec: DeskSection; spec: RegionSpec; claims: SceneClaim[] }>();
  constructor(private host: HTMLDivElement, private live: () => DeskApi | null) {}

  async reset(): Promise<void> { /* the board persists, as the live one does */ }
  clear(): void { this.secs.clear(); this.all = []; this.host.replaceChildren(); }
  /** A new answer: ids are freed, the sections stay (a scene tag with the same id continues its scene). */
  forgetIds(): void { this.secs.clear(); }

  metrics() {
    const m = this.live()?.metrics?.();
    return m && m.boardPx > 0 ? m : { boardPx: 666, bodyPx: m?.bodyPx ?? (() => 14) };
  }

  async addRegion(spec: RegionSpec): Promise<RegionInfo | string> {
    const prev = this.secs.get(spec.id);
    if (prev) return spec.scene && prev.spec.scene ? this.region(spec.id)! : 'duplicate region id';
    const scene = spec.scene ? [...this.all].reverse().find((s) => s.spec.scene && s.spec.id === spec.id) : undefined;
    if (scene) { this.secs.set(spec.id, scene); return this.region(spec.id)!; }
    const sec = createSection(spec);
    this.host.appendChild(sec.el);
    const s = { sec, spec, claims: [] };
    this.all.push(s);
    this.secs.set(spec.id, s);
    return this.region(spec.id)!;
  }

  region(id: string): RegionInfo | null {
    const s = this.secs.get(id);
    if (!s) return null;
    const m = this.metrics();
    // The live section's scale when it exists (it is the same section), else the board's width fit.
    const liveR = this.live()?.region(id);
    return {
      id, page: s.spec.page, size: s.spec.size, layers: s.sec.layers,
      scale: () => liveR?.scale() ?? m.boardPx / REGION_W,
      body: () => m.bodyPx(s.spec.body ?? null),
      ...(s.spec.scene ? { scene: sceneSpaceOf(s.claims, () => WHOLE) } : {}),
    };
  }

  async reveal(): Promise<boolean> { return false; }
  growRegion(): void {}
  centreRegion(): void {}
  noteInk(): void {}
  pageImage(page: number, r: { x: number; y: number; w: number; h: number }, pxW: number): Promise<string | null> {
    return this.live()?.pageImage?.(page, r, pxW) ?? Promise.resolve(null);
  }
  async overview(): Promise<void> {}
  isVisible(): boolean { return true; }
  async whenVisible(): Promise<boolean> { return true; }
  async frameBoth(): Promise<void> {}
  async scrollToPage(): Promise<void> {}
  addConnector(): ConnectorHandle | string {
    const g = document.createElementNS(SVG, 'g') as SVGGElement;
    this.host.appendChild(document.createElementNS(SVG, 'svg')).appendChild(g);
    return { group: g, stroke: [], scale: 1 };
  }
  following(): boolean { return true; }
  cancel(): void {}
  abort(): void {}
  state() { return this.live()?.state() ?? { split: 'normal' as const, stacked: false, following: true, sketching: true, column: { x: 0, w: 0 } }; }
  subscribe(): () => void { return () => {}; }

  /** Sections and their ids (the repair note's ON THE BOARD NOW). */
  sections(): string[] { return [...this.secs.keys()]; }
}

/** The ViewerApi subset the Director uses: page geometry and text runs from the live viewer, hidden layers. */
function shadowViewer(live: () => ViewerApi | null, host: HTMLDivElement): ViewerApi {
  const layers = new Map<number, PageLayers>();
  const layer = (page: number): PageLayers => {
    let l = layers.get(page);
    if (!l) {
      const svg = host.appendChild(document.createElementNS(SVG, 'svg'));
      l = { highlight: svg.appendChild(document.createElementNS(SVG, 'g')) as SVGGElement, agent: svg.appendChild(document.createElementNS(SVG, 'g')) as SVGGElement };
      layers.set(page, l);
    }
    return l;
  };
  const v = () => live();
  return {
    numPages: () => v()?.numPages() ?? 0,
    currentPage: () => v()?.currentPage() ?? 1,
    spaceHeight: (p) => v()?.spaceHeight(p) ?? 1294,
    scale: (p) => v()?.scale(p) ?? 1,
    layers: (p) => (p >= 1 && p <= (v()?.numPages() ?? 0) ? layer(p) : null),
    allLayers: () => [...layers.values()],
    textRuns: (p) => v()?.textRuns(p) ?? Promise.resolve([]),
    scrollToPage: async () => {},
    ensureVisible: async () => false,
    isVisible: () => true,
    whenVisible: async () => true,
    ensureSize: async (p) => { await v()?.ensureSize(p); },
    cancelScroll: () => {},
    deskHost: () => { throw new Error('shadow viewer: no desk host'); },
  } as ViewerApi;
}

/** ShadowStage: the gate's ShadowBoard over a hidden Desk + Viewer and an instant Director. */
export class ShadowStage implements ShadowBoard {
  private host: HTMLDivElement;
  private desk: ShadowDesk;
  private director: Director;
  private viewer: ViewerApi;
  private seedActs: RawAction[] = [];
  /** Skip reasons by action, as the director reports them. */
  private skips = new Map<RawAction, string>();
  private pendingLayout: RawAction[] = [];
  private chain: Promise<unknown> = Promise.resolve();

  constructor(o: { desk: () => DeskApi | null; viewer: () => ViewerApi | null; settings: () => Settings; grounding?: () => Grounding }) {
    this.host = hiddenHost(o.desk()?.metrics?.().boardPx ?? 666);
    this.desk = new ShadowDesk(this.host, o.desk);
    this.viewer = shadowViewer(o.viewer, this.host);
    this.director = new Director({
      viewer: () => this.viewer, desk: () => this.desk, settings: () => ({ ...o.settings(), inkStyle: 'clean' }),
      onScrolledTo: () => {}, grounding: o.grounding, instant: true,
      onTiming: (t) => this.onTiming(t),
    });
  }

  private onTiming(t: ActionTiming) {
    if (t.endedAt == null || !t.skipped) return;
    const a = t.action as unknown as RawAction;
    // Layout actions are resolved copies: matched to their raw action by kind and id/page.
    const raw = this.pendingLayout.find((r) => r.kind === a.kind && ((r as { id?: string }).id ?? (r as { page?: number }).page) === ((a as { id?: string }).id ?? (a as { page?: number }).page));
    this.skips.set(raw ?? a, t.skipped);
  }

  /** The board as earlier answers left it (they persist): their released scripts. */
  seed(priorScripts: string[]): Promise<void> {
    const acts: RawAction[] = [];
    for (const s of priorScripts) {
      const p = new ScriptParser();
      for (const e of [...p.push(s), ...p.end()]) if (e.type === 'action') acts.push(e.action);
    }
    this.seedActs = acts;
    return this.rebuild([]);
  }

  apply(actions: RawAction[]): Promise<{ skipped: Map<RawAction, string>; added: Map<RawAction, El[]> }> {
    const run = async () => {
      const reg = this.director.registry as unknown as { byId: Map<string, ElementEntry> };
      const before = new Set(reg.byId.keys());
      this.skips = new Map();
      this.pendingLayout = actions.filter((a) => a.kind === 'scroll' || a.kind === 'sketch' || a.kind === 'clear');
      for (const a of actions) this.director.prefetch(a);
      for (const a of actions) this.director.run(a, performance.now());
      await Promise.race([this.director.idle(), new Promise((r) => setTimeout(r, 2500))]);
      const added = new Map<RawAction, El[]>();
      const fresh = [...reg.byId.values()].filter((e) => !before.has(e.id));
      const used = new Set<ElementEntry>();
      for (const a of actions) {
        if (this.skips.has(a)) continue;
        const id = (a as { id?: string }).id?.replace(/-/g, '_');
        const e = (id ? fresh.find((x) => x.id === id) : undefined) ?? fresh.find((x) => !used.has(x) && x.id.startsWith('_') && (x.kind === a.kind || x.kind === `kit-${a.kind}`));
        if (!e) continue;
        used.add(e);
        added.set(a, [toEl({ id: e.id, kind: e.kind, target: e.target, bbox: e.bbox, boxes: e.boxes, strokes: e.strokes?.map((s) => s.map((p) => ({ x: p.x, y: p.y }))) }, a)]);
      }
      return { skipped: this.skips, added };
    };
    const p = this.chain.then(run, run);
    this.chain = p.catch(() => {});
    return p;
  }

  /** Back to the seed plus exactly the accepted actions. */
  rebuild(accepted: RawAction[]): Promise<void> {
    const run = async () => {
      this.director.stop();
      this.director.registry.clear();
      this.director.figures.clear();
      this.desk.clear();
      const settle = () => Promise.race([this.director.idle(), new Promise((r) => setTimeout(r, 2500))]);
      if (this.seedActs.length) {
        for (const a of this.seedActs) this.director.prefetch(a);
        for (const a of this.seedActs) this.director.run(a, performance.now());
        await settle();
        // Earlier answers' ids are freed, as the live director's are at a new answer; their sections stay.
        this.director.registry.clear();
        this.director.figures.clear();
        this.desk.forgetIds();
      }
      for (const a of accepted) this.director.prefetch(a);
      for (const a of accepted) this.director.run(a, performance.now());
      await settle();
    };
    const p = this.chain.then(run, run);
    this.chain = p.catch(() => {});
    return p;
  }

  scene(): { section: string; items: { id: string; kind: string; label?: string }[] }[] {
    const reg = this.director.registry as unknown as { byId: Map<string, ElementEntry> };
    const out = new Map<string, { id: string; kind: string }[]>();
    for (const e of reg.byId.values()) {
      const s = e.target.region;
      if (s == null) continue;
      if (!out.has(s)) out.set(s, []);
      out.get(s)!.push({ id: e.id, kind: e.kind });
    }
    for (const s of this.desk.sections()) if (!out.has(s)) out.set(s, []);
    return [...out].map(([section, items]) => ({ section, items }));
  }

  destroy(): void { this.director.stop(); this.host.remove(); }
}
