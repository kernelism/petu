// src/desk/scene/camera.ts
/**
 * The scene camera (spec "Board v2" 1): what part of a scene's world the board shows. Pure.
 * World units are section units (the board's type scale `s` px per unit at zoom 1); the camera is
 * the world point at the window's top-left and a zoom. It moves only when the new ink is not
 * comfortably in view, and then as little as it can, keeping the last framed thing with it when
 * both fit; it zooms out (never below ZMIN, so text stays readable) only when the action is larger
 * than the window, and back to 1 once it fits again.
 */
import type { SRect } from '../../geometry/space';

export type Cam = { x: number; y: number; z: number };
/** The furthest the camera zooms out to frame an action. */
export const ZMIN = 0.62;
/** Air kept around framed ink, as a fraction of the window. */
const AIR = 0.07;

const union = (a: SRect, b: SRect): SRect => {
  const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y);
  return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y };
};

/** The furthest the end-of-answer overview zooms out: a little past framing (ZMIN), so a composition that grew wider or taller than the window is seen whole, not clipped (design 3.1: the final board reads on its own). */
export const ZOVER = 0.5;

/** The furthest the end-of-answer overview zooms in on a small scene (text grows to at most this × the board's type). */
export const ZIN = 1.6;
/** A small scene's overview fills about this share of the window (width or height, whichever binds first). */
const FILL = 0.62;

/**
 * The end-of-answer overview: the whole scene `ext`, centred in the window with air, at the largest
 * zoom that shows all of it (never under ZOVER: a huge scene keeps its top-left in view). A small
 * scene is brought closer, to fill about FILL of the window (never past ZIN), so the final board
 * reads on its own instead of a sliver in an empty board.
 */
export function overviewCam(ext: SRect, win: { w: number; h: number; s: number }): Cam {
  const air = 1 + 2 * AIR * 1.4;
  const fit = Math.min(win.w / (win.s * ext.w * air), win.h / (win.s * ext.h * air));
  const fill = Math.min((win.w * FILL) / (win.s * ext.w), (win.h * FILL) / (win.s * ext.h));
  const z = fit >= 1 ? Math.min(ZIN, Math.max(1, Math.min(fit, fill))) : Math.max(ZOVER, fit);
  const vw = win.w / (win.s * z), vh = win.h / (win.s * z);
  const x = ext.w * air <= vw ? ext.x + ext.w / 2 - vw / 2 : ext.x - vw * AIR;
  const y = ext.h * air <= vh ? ext.y + ext.h / 2 - vh / 2 : ext.y - vh * AIR;
  return { x, y, z };
}

/**
 * The camera that frames `r` (with `ctx`, the last framed rect, when both fit at a readable zoom),
 * or null when `r` is already comfortably in view. `win`: the window in px and the type scale.
 */
export function camFor(cam: Cam, r: SRect, ctx: SRect | null, win: { w: number; h: number; s: number }): Cam | null {
  const view = (z: number) => ({ w: win.w / (win.s * z), h: win.h / (win.s * z) });
  const padded = (q: SRect, z: number) => { const v = view(z), ax = v.w * AIR, ay = v.h * AIR; return { x: q.x - ax, y: q.y - ay, w: q.w + 2 * ax, h: q.h + 2 * ay }; };
  const fitZ = (q: SRect) => Math.min(win.w / (win.s * q.w * (1 + 2 * AIR)), win.h / (win.s * q.h * (1 + 2 * AIR)));
  const cur = view(cam.z);
  const inView = (q: SRect) => q.x >= cam.x - 0.5 && q.y >= cam.y - 0.5 && q.x + q.w <= cam.x + cur.w + 0.5 && q.y + q.h <= cam.y + cur.h + 0.5;
  // Comfortably in view, at a zoom that is not needlessly far out: stay.
  if (inView(padded(r, cam.z)) && (cam.z >= 0.999 || fitZ(r) < 1)) return null;
  // The action and its context, when they fit together at a readable zoom; else the action alone.
  const both = ctx ? union(r, ctx) : r;
  const target = ctx && fitZ(both) >= Math.max(ZMIN, Math.min(cam.z, 1) * 0.85) ? both : r;
  let z = Math.min(1, Math.max(ZMIN, fitZ(target)));
  if (z < cam.z && fitZ(target) >= cam.z) z = cam.z;
  const v = view(z), q = padded(target, z);
  // The least pan that shows the target; a target wider than the window keeps its left/top edge.
  const pan = (lo: number, size: number, qlo: number, qsize: number) => (qsize >= size ? qlo : Math.min(qlo, Math.max(lo, qlo + qsize - size)));
  // Changing zoom re-anchors the window on the target's centre.
  if (Math.abs(z - cam.z) > 1e-6) return { x: target.x + target.w / 2 - v.w / 2, y: target.y + target.h / 2 - v.h / 2, z };
  return { x: pan(cam.x, v.w, q.x, q.w), y: pan(cam.y, v.h, q.y, q.h), z };
}
