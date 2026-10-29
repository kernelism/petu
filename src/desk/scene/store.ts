// src/desk/scene/store.ts
/**
 * Board v2: the things of this answer's scene by id (nodes, flows, notes, links, and kit blocks
 * placed in a scene), with their world boxes and parts, so anything can be placed by relation to,
 * or connected to, anything else. Per answer (a Registry extension); the room they take in the
 * world is claimed on the Desk's scene and persists across answers.
 */
import type { Registry } from '../registry';
import type { BuildEnv, Pace, SceneClaim, TargetCtx } from '../types';
import { blockPart, isBlockRef } from '../../script/pointExpr';
import type { Box } from './place';

export type Thing = {
  rect: Box;
  /** Part boxes (a flow's chips), 0-based. */
  parts?: Box[];
  claim?: SceneClaim;
  group?: SVGGElement;
  /** Re-route / re-place hooks: called when this thing moves. */
  moved?: Set<() => void>;
  /** Kind-specific state (scene.ts). */
  data?: Record<string, unknown>;
};

export class SceneStore {
  private things = new Map<string, Thing>();
  private aliases = new Map<string, string>();
  /** A thing by id; a thing merged into another answers as the one it became. */
  get(id: string): Thing | undefined {
    for (let i = 0; i < 8 && this.aliases.has(id); i++) id = this.aliases.get(id)!;
    return this.things.get(id);
  }
  /** `id` is now `into` (a merge): references to it resolve there. */
  alias(id: string, into: string): void { this.aliases.set(id, into); }
  /** Every thing of a kind (data.kind). */
  ofKind(kind: string): Thing[] { return [...this.things.values()].filter((t) => t.data?.kind === kind); }
  put(id: string, t: Thing): Thing {
    const prev = this.things.get(id);
    const out = prev ? Object.assign(prev, t) : t;
    this.things.set(id, out);
    return out;
  }
  ids(): string[] { return [...this.things.keys()]; }
  clear(): void { this.things.clear(); this.aliases.clear(); }
}

export const sceneStore = (r: Registry): SceneStore => r.ext('scene', () => new SceneStore());

type KitResolver = (ref: string, r: Registry) => Promise<Box | null>;
let kitResolve: KitResolver = async () => null;
/** kit.ts registers how a kit block or part resolves to a box (avoids an import cycle). */
export function setKitResolver(f: KitResolver): void { kitResolve = f; }

type LinkMaker = (from: string, to: string, label: string, ctx: TargetCtx, env: BuildEnv, pace: Pace) => Promise<void>;
let linkMaker: LinkMaker = async () => {};
/** scene.ts registers how a plain link is drawn, so kit.ts can relate a computed block to its source. */
export function setSceneLink(f: LinkMaker): void { linkMaker = f; }
/** Draws a link from one scene thing to another (an op between kit blocks in a scene). */
export const sceneLink: LinkMaker = (...a) => linkMaker(...a);

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** The world box of a thing or part: a scene thing, a kit block or part, or any drawn element. Waits briefly for one still waiting on its word. */
export async function anchorBox(ref: string, r: Registry, ms = 600): Promise<Box | null> {
  const store = sceneStore(r);
  const part = isBlockRef(ref) ? blockPart(ref) : null;
  const t0 = performance.now();
  for (;;) {
    const id = part ? part.id : ref;
    const t = store.get(id);
    if (t) {
      if (!part) return t.rect;
      if (t.parts) { const a = t.parts[part.c0], b = t.parts[part.c1]; if (!a || !b) return null; return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.max(a.x + a.w, b.x + b.w) - Math.min(a.x, b.x), h: Math.max(a.y + a.h, b.y + b.h) - Math.min(a.y, b.y) }; }
      const k = await kitResolve(ref, r);
      if (k) return k;
    }
    const e = !part ? r.get(ref) : undefined;
    if (e) return e.bbox;
    if (performance.now() - t0 > ms) return part ? kitResolve(ref, r) : null;
    await wait(30);
  }
}
