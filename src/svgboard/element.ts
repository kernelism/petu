// src/svgboard/element.ts — an svg board group as a desk element (the director's ink path draws it).
import type { BuildEnv, ElementPlan } from '../desk/types';
import type { SvgAction } from '../script/types';
import { textPx } from '../desk/elements';
import { boardIn, drawGroup, groupBox, growBoard, hasBound, partBox, prepareGroup, refreshData, type SvgBoard } from './render';

/** Air (section units) kept around the part being drawn when the board follows the pen: room for its label. */
const PEN_AIR = 48;
import { kitStore, type KitStore } from '../desk/kit/kit';
import type { SRect } from '../geometry/space';

/** Stores a board already follows (a follow-up's answer has its own store). */
const following = new WeakMap<SvgBoard, KitStore>();

/**
 * The board's exact data reads the answer's constants (KitStore: {{const}} tags, `data-const`), and a
 * {{tween}} of them re-resolves every bound group each frame (KitStore.constsChanged).
 */
function linkStore(board: SvgBoard, store: KitStore, region: string): void {
  if (board.scope.consts !== store.consts) {
    for (const [k, v] of Object.entries(board.scope.consts)) if (!(k in store.consts)) store.consts[k] = v;
    board.scope.consts = store.consts;
  }
  board.scope.define = (defs) => store.defineConsts(defs);
  board.scope.calcs = store.calcs;
  if (following.get(board) === store) return;
  following.set(board, store);
  store.onConsts(() => refreshData(board));
  store.svgBox = () => {
    const live = board.bound.filter((g) => g.isConnected);
    if (!live.length) return null;
    const bs = live.map((g) => groupBox(board, g)).filter((b): b is SRect => !!b);
    if (!bs.length) return null;
    const x = Math.min(...bs.map((b) => b.x)), y = Math.min(...bs.map((b) => b.y));
    return { target: { region }, bbox: { x, y, w: Math.max(...bs.map((b) => b.x + b.w)) - x, h: Math.max(...bs.map((b) => b.y + b.h)) - y } };
  };
}

/**
 * A withheld beat's definitions (defs.ts): its constants, frames, named curves and points join the
 * board's data at once; nothing is drawn, framed or registered. Kept (hidden) when bound, so a tween
 * moves what later groups built on them. A string is why it could not be taken.
 */
export async function defineSvgGroup(a: SvgAction, env: BuildEnv): Promise<string | void> {
  if (!a.region) return 'no svg board';
  const ctx = await env.ctx({ region: a.region });
  if (typeof ctx === 'string') return ctx;
  const board = boardIn(ctx.layers.agent);
  if (!board) return 'no svg board';
  linkStore(board, kitStore(env.registry), a.region);
  const s = prepareGroup(board, a.svg, textPx(ctx, 'm'), ctx.scale() * (1000 / board.w));
  if (typeof s === 'string') return s;
  s.el.setAttribute('display', 'none');
  board.root.appendChild(s.el);
  if (hasBound(s.el)) board.bound.push(s.el);
}

/** Builds the plan: sanitized and measured now (hidden), drawn on its word. A string is a skip reason. */
export async function buildSvgGroup(a: SvgAction, env: BuildEnv): Promise<ElementPlan | string> {
  if (!a.region) return 'no svg board';
  const target = { region: a.region };
  const ctx = await env.ctx(target);
  if (typeof ctx === 'string') return ctx;
  const board = boardIn(ctx.layers.agent);
  if (!board) return 'no svg board';
  const pxPerUnit = ctx.scale() * (1000 / board.w);
  // The founder's rule: board text is never smaller than the board's body text.
  linkStore(board, kitStore(env.registry), a.region);
  const s = prepareGroup(board, a.svg, textPx(ctx, 'm'), pxPerUnit);
  if (typeof s === 'string') return s;
  const g = s.el;
  if (hasBound(g)) board.bound.push(g);
  // Measure it hidden (its box frames the board before it draws; a group below the canvas grows it).
  g.style.visibility = 'hidden';
  board.root.appendChild(g);
  let box = groupBox(board, g);
  g.remove();
  g.style.visibility = '';
  if (box && box.y + box.h > (board.h * 1000) / board.w) {
    const need = growBoard(board, Math.ceil(((box.y + box.h) * board.w) / 1000) + 12);
    env.desk.growRegion?.(a.region, need);
  }
  box ??= { x: 0, y: 0, w: 1000, h: Math.min(700, (board.h * 1000) / board.w) };
  const id = a.id ?? s.id;
  return {
    target, bbox: box, el: g,
    draw: async (signal, k) => {
      env.registry.define({ ...(id ? { id } : {}), kind: 'svg', target, bbox: box!, boxes: [box!], anchor: { x: box!.x + box!.w / 2, y: box!.y + box!.h / 2 }, group: g });
      // A group taller than the view: the board follows the pen, part by part (each with room for the
      // label beside it), while the student follows; a part already in view moves nothing.
      const onStep = (el: SVGElement) => {
        if (!env.desk.following()) return;
        const r = partBox(board, el, PEN_AIR);
        if (r && !env.desk.isVisible(target, r)) void env.desk.reveal(target, r);
      };
      await drawGroup(board, g, id, { signal, speed: k.speed, color: env.settings.inkColor, onStep, ...(k.beat ? { beat: k.beat } : {}), ...(k.slot ? { slot: k.slot } : {}), ...(k.stop ? { stop: k.stop } : {}), ...(k.paused ? { paused: k.paused } : {}) });
    },
  };
}
