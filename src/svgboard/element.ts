// src/svgboard/element.ts — an svg board group as a desk element (the director's ink path draws it).
import type { BuildEnv, ElementPlan } from '../desk/types';
import type { SvgAction } from '../script/types';
import { textPx } from '../desk/elements';
import { boardIn, drawGroup, groupBox, growBoard, prepareGroup } from './render';

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
  const s = prepareGroup(board, a.svg, textPx(ctx, 'm'), pxPerUnit);
  if (typeof s === 'string') return s;
  const g = s.el;
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
    target, bbox: box,
    draw: async (signal, k) => {
      env.registry.define({ ...(id ? { id } : {}), kind: 'svg', target, bbox: box!, boxes: [box!], anchor: { x: box!.x + box!.w / 2, y: box!.y + box!.h / 2 }, group: g });
      await drawGroup(board, g, id, { signal, speed: k.speed, color: env.settings.inkColor });
    },
  };
}
