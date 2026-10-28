// src/desk/scene/store.ts
/**
 * Board v2: the things of this answer's scene by id (nodes, flows, notes, links, and kit blocks
 * placed in a scene), with their world boxes and parts, so anything can be placed by relation to,
 * or connected to, anything else. Per answer (a Registry extension); the room they take in the
 * world is claimed on the Desk's scene and persists across answers.
 */
import type { Registry } from '../registry';
import type { SceneClaim } from '../types';
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
  get(id: string): Thing | undefined { return this.things.get(id); }
  put(id: string, t: Thing): Thing {
    const prev = this.things.get(id);
    const out = prev ? Object.assign(prev, t) : t;
    this.things.set(id, out);
    return out;
  }
  ids(): string[] { return [...this.things.keys()]; }
  clear(): void { this.things.clear(); }
}

export const sceneStore = (r: Registry): SceneStore => r.ext('scene', () => new SceneStore());

type KitResolver = (ref: string, r: Registry) => Promise<Box | null>;
let kitResolve: KitResolver = async () => null;
/** kit.ts registers how a kit block or part resolves to a box (avoids an import cycle). */
export function setKitResolver(f: KitResolver): void { kitResolve = f; }

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
