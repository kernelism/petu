// src/desk/elements.ts
import type { SPt, SRect } from '../geometry/space';
import type { DrawAction, End, InkAction, RefAction, Target } from '../script/types';
import { circleStroke, lineStroke, arrowStrokes, boxStroke, curveStroke, arcStroke, bisector, braceStroke, type Stroke } from '../ink/agent/strokes';
import { drawStrokes, prefersReducedMotion } from '../ink/agent/animate';
import { drawHighlight } from '../ink/agent/marks';
import { locateQuote } from '../locate/locateQuote';
import { compile } from './expr';
import { plotStrokes } from './plot';
import { nudge, placeLabel } from './nudge';
import { boxOf, strokeBoxes, union, type ElementEntry } from './registry';
import { DESK_INK, TEXT_PX, MATH_PX, own, makeText, measureText, reveal, drawDot, drawShade, emphPass, moveGroup, fadeGroup, type TextOpts, type ShadeShape } from './render';
import { preloadMath, texToHtml, placeMath, revealMath } from './math';
import type { BuildElement, BuildEnv, ElementPlan, Pace, TargetCtx } from './types';

/** Closed shapes (circle, box) read as rushed below this, however small… */
export const CLOSED_MIN_MS = 400;
/** …unless the ink is behind the narration: then they may go down to this. */
export const CLOSED_FLOOR_MS = 180;
/** A reference waits this long for its element (still waiting on its own word) before it is skipped. */
export const REF_WAIT_MS = 400;
export const MOVE_MS = 450;
export const FADE_TO = 0.25;
/** Dot radius and label gap, CSS px at draw time. */
const DOT_PX = 4.5;
const PAD = 6;

const isRegion = (t: Target) => t.region != null;
const where = (t: Target) => (t.region != null ? `region ${t.region}` : `page ${t.page}`);

/** Resolves one ink action into a plan (see ElementPlan). Strings are skip reasons. */
export const buildElement: BuildElement = async (a, env) => {
  if (a.kind === 'connect') return connect(a, env);
  if ('ref' in a) return ref(a, env);
  const target: Target = a.region != null ? { region: a.region } : { page: a.page! };
  const ctx = await env.ctx(target);
  if (typeof ctx === 'string') return ctx;
  return draw(a, ctx, env);
};

/** Ink color: accent on pages; in regions, neutral unless `em` (rule 6). */
function colorOf(t: Target, em: boolean | undefined, env: BuildEnv): string {
  return isRegion(t) && !em ? DESK_INK : env.settings.inkColor;
}

function textOpts(ctx: TargetCtx, env: BuildEnv, px: number, color: string): TextOpts {
  return { size: px / Math.max(ctx.scale(), 1e-3), style: env.settings.inkStyle, color, run: isRegion(ctx.target) };
}

/** The bounds labels must stay in: the target's whole space. */
const bounds = (ctx: TargetCtx): SRect => ({ x: 0, y: 0, w: 1000, h: ctx.h });

type Ink = { strokes: Stroke[]; closed?: boolean; dash?: boolean };

/** A plan for stroked elements: traced in order, registered when drawing starts. */
function strokePlan(a: DrawAction, ctx: TargetCtx, env: BuildEnv, ink: Ink, extra: SRect[] = [], after?: (g: SVGGElement, sig: AbortSignal, k: Pace) => Promise<void>): ElementPlan {
  const boxes = strokeBoxes(ink.strokes);
  const bbox = union([...boxes, ...extra].map((b) => ({ x: b.x - PAD, y: b.y - PAD, w: b.w + 2 * PAD, h: b.h + 2 * PAD })));
  const color = colorOf(ctx.target, a.em, env);
  const s = env.settings;
  return {
    target: ctx.target,
    bbox,
    draw: async (signal, k) => {
      const g = own(ctx.layers.agent);
      const last = ink.strokes[ink.strokes.length - 1];
      env.registry.define({ id: a.id, kind: a.kind, target: ctx.target, bbox, boxes: [...boxes, ...extra], anchor: last[last.length - 1], group: g, strokes: ink.strokes });
      const fade = s.inkStyle === 'clean' || prefersReducedMotion();
      await drawStrokes(g, ink.strokes, {
        color, width: s.inkStyle === 'hand' ? 3.4 : 3, scale: ctx.scale(), signal,
        mode: fade || k.fadeMs != null ? 'fade' : 'trace', fadeMs: k.fadeMs, dash: ink.dash ? '7 6' : undefined,
        minMs: ink.closed ? CLOSED_MIN_MS : undefined,
        speed: ink.closed ? Math.max(k.speed, CLOSED_FLOOR_MS / CLOSED_MIN_MS) : k.speed,
      });
      if (after) await after(g, signal, k);
    },
  };
}

/**
 * Places a label box next to `anchor` toward `dir`, nudged off the target's other elements
 * (rule 5). Runs at draw time, so it sees everything drawn before it.
 */
function placeText(ctx: TargetCtx, env: BuildEnv, layer: SVGGElement, text: string, o: TextOpts, anchor: SPt, dir: Parameters<typeof placeLabel>[3], clear: number, skip?: string): SRect {
  const m = measureText(layer, text, o);
  return nudge(placeLabel(anchor, m.w, m.h, dir, clear), env.registry.obstacles(ctx.target, skip), bounds(ctx));
}

async function writeLabel(g: SVGGElement, box: SRect, text: string, o: TextOpts, env: BuildEnv, signal: AbortSignal, k: Pace) {
  const tg = own(g);
  makeText(tg, { x: box.x, y: box.y + box.h / 2 }, text, o);
  await reveal(tg, box, Array.from(text).length, { style: env.settings.inkStyle, signal, ...k });
}

async function draw(a: DrawAction, ctx: TargetCtx, env: BuildEnv): Promise<ElementPlan | string> {
  const r = env.rng();
  const P = (p: SPt) => ctx.toSpace(p);
  const anchorRects = async (quote: string, near?: SPt) => locateQuote(await ctx.runs(), quote, near).map((x) => ctx.rectToSpace(x));
  const color = colorOf(ctx.target, a.em, env);
  const px = (n: number) => n / Math.max(ctx.scale(), 1e-3);

  switch (a.kind) {
    case 'highlight':
    case 'underline': {
      const rects = await anchorRects(a.quote, a.near);
      if (!rects.length) { console.warn('[desk] quote not found', a.quote, where(ctx.target)); return 'quote not found'; }
      if (a.kind === 'underline') return strokePlan(a, ctx, env, { strokes: rects.map((x) => lineStroke({ x: x.x, y: x.y + x.h + 2 }, { x: x.x + x.w, y: x.y + x.h + 2 }, r)) });
      const bbox = union(rects);
      return {
        target: ctx.target, bbox,
        draw: async (_sig, k) => {
          const g = own(ctx.layers.highlight);
          env.registry.define({ id: a.id, kind: a.kind, target: ctx.target, bbox, boxes: [], anchor: { x: bbox.x + bbox.w, y: bbox.y }, group: g });
          await drawHighlight(g, rects, env.settings.highlightColor, 0.5, k.speed);
        },
      };
    }
    case 'circle':
    case 'box': {
      let box: SRect;
      const anchored = 'quote' in a;
      if ('quote' in a) {
        const rects = await anchorRects(a.quote, a.near);
        if (!rects.length) { console.warn('[desk] anchor not found', a.quote, where(ctx.target)); return 'anchor not found'; }
        box = union(rects);
      } else if (a.kind === 'circle') {
        const c = P(a.at);
        box = { x: c.x - a.rx, y: c.y - a.ry, w: a.rx * 2, h: a.ry * 2 };
      } else {
        const p = P(a.at);
        box = { x: p.x, y: p.y, w: a.w, h: isRegion(ctx.target) ? a.h : (a.h * ctx.h) / 1000 };
      }
      if (a.kind === 'circle') {
        const rx = anchored ? Math.max(12, box.w / 2 + 10) : box.w / 2;
        const ry = anchored ? Math.max(12, box.h / 2 + 8) : box.h / 2;
        return strokePlan(a, ctx, env, { strokes: [circleStroke({ x: box.x + box.w / 2, y: box.y + box.h / 2 }, rx, ry, r)], closed: true, dash: 'dash' in a && a.dash });
      }
      const pad = anchored ? 10 : 0;
      return strokePlan(a, ctx, env, { strokes: [boxStroke(box.x - pad, box.y - pad, box.w + pad * 2, box.h + pad * 2, r)], closed: true });
    }
    case 'line':
      return strokePlan(a, ctx, env, { strokes: [lineStroke(P(a.from), P(a.to), r)], dash: a.dash });
    case 'arrow':
      return strokePlan(a, ctx, env, { strokes: arrowStrokes(P(a.from), P(a.to), r), dash: a.dash });
    case 'curve':
      return strokePlan(a, ctx, env, { strokes: [curveStroke(a.pts.map(P), r)], dash: a.dash });
    case 'angle': {
      const c = P(a.at), rad = a.r ?? px(28); // default: 28 CSS px at draw time
      const arc = arcStroke(c, P(a.from), P(a.to), rad);
      if (!a.text) return strokePlan(a, ctx, env, { strokes: [arc] });
      const b = bisector(c, P(a.from), P(a.to));
      const o = textOpts(ctx, env, TEXT_PX.label, color);
      const tip = { x: c.x + b.x * (rad + px(10)), y: c.y + b.y * (rad + px(10)) };
      const dir = compassOf(b);
      return strokePlan(a, ctx, env, { strokes: [arc] }, [], async (g, sig, k) => {
        const box = placeText(ctx, env, g, a.text!, o, tip, dir, 0);
        await writeLabel(g, box, a.text!, o, env, sig, k);
      });
    }
    case 'brace': {
      const f = P(a.from), t = P(a.to), L = Math.hypot(t.x - f.x, t.y - f.y);
      const depth = Math.min(22, Math.max(10, L * 0.08));
      const s = braceStroke(f, t, depth);
      if (!a.text) return strokePlan(a, ctx, env, { strokes: [s] });
      const n = { x: (t.y - f.y) / (L || 1), y: -(t.x - f.x) / (L || 1) };
      const tip = { x: (f.x + t.x) / 2 + n.x * (depth + px(4)), y: (f.y + t.y) / 2 + n.y * (depth + px(4)) };
      const o = textOpts(ctx, env, TEXT_PX.label, color);
      return strokePlan(a, ctx, env, { strokes: [s] }, [], async (g, sig, k) => {
        const box = placeText(ctx, env, g, a.text!, o, tip, compassOf(n), 0);
        await writeLabel(g, box, a.text!, o, env, sig, k);
      });
    }
    case 'axes': {
      const o = P(a.at);
      const xs = arrowStrokes(o, { x: o.x + a.w, y: o.y }, null), ys = arrowStrokes(o, { x: o.x, y: o.y - a.h }, null);
      const strokes = [...xs, ...ys];
      const tOpts = textOpts(ctx, env, TEXT_PX.s, colorOf(ctx.target, false, env));
      const axesBox = { x: o.x, y: o.y - a.h, w: a.w, h: a.h };
      const boxes = strokeBoxes(strokes);
      return {
        target: ctx.target,
        bbox: union([...boxes, { x: o.x - 60, y: o.y - a.h - 30, w: a.w + 80, h: a.h + 60 }]),
        draw: async (signal, k) => {
          const g = own(ctx.layers.agent);
          env.registry.define({ id: a.id, kind: 'axes', target: ctx.target, bbox: axesBox, boxes, anchor: { x: o.x + a.w, y: o.y - a.h }, group: g, strokes });
          await drawStrokes(g, strokes, { color: colorOf(ctx.target, a.em, env), width: 2, scale: ctx.scale(), signal, mode: k.fadeMs != null || env.settings.inkStyle === 'clean' || prefersReducedMotion() ? 'fade' : 'trace', fadeMs: k.fadeMs, speed: k.speed });
          if (a.xLabel) { const m = measureText(g, a.xLabel, tOpts); await writeLabel(g, { x: o.x + a.w - m.w, y: o.y + px(8), ...m }, a.xLabel, tOpts, env, signal, k); }
          if (a.yLabel) { const m = measureText(g, a.yLabel, tOpts); await writeLabel(g, { x: o.x + px(8), y: o.y - a.h - m.h / 2, ...m }, a.yLabel, tOpts, env, signal, k); }
        },
      };
    }
    case 'plot': {
      const ax = a.axes ? env.registry.get(a.axes) : env.registry.latest(ctx.target, 'axes');
      if (!ax || ax.kind !== 'axes') { console.warn('[desk] plot: no axes', where(ctx.target)); return 'no axes'; }
      let fn;
      try { fn = compile(a.fn); } catch (e) { console.warn('[desk] plot: bad fn', a.fn, e); return 'bad fn'; }
      const strokes = plotStrokes(fn, a.domain, { x: ax.bbox.x, y: ax.bbox.y + ax.bbox.h, w: ax.bbox.w, h: ax.bbox.h }, a.range);
      if (!strokes.length) return 'nothing to plot';
      return strokePlan(a, ctx, env, { strokes, dash: a.dash });
    }
    case 'point': {
      const c = P(a.at), rad = px(DOT_PX);
      const dot = { x: c.x - rad, y: c.y - rad, w: rad * 2, h: rad * 2 };
      const o = textOpts(ctx, env, TEXT_PX.label, color);
      const est = a.text ? placeLabel(c, measureText(ctx.layers.agent, a.text, o).w, o.size * 1.2, a.dir ?? 'ne', rad) : null;
      return {
        target: ctx.target,
        bbox: union([dot, ...(est ? [est] : [])].map((b) => ({ x: b.x - PAD, y: b.y - PAD, w: b.w + 2 * PAD, h: b.h + 2 * PAD }))),
        draw: async (signal, k) => {
          const g = own(ctx.layers.agent);
          const box = a.text ? placeText(ctx, env, g, a.text, o, c, a.dir ?? 'ne', rad) : null;
          env.registry.define({ id: a.id, kind: 'point', target: ctx.target, bbox: union([dot, ...(box ? [box] : [])]), boxes: [dot, ...(box ? [box] : [])], anchor: c, group: g });
          await drawDot(g, c, rad, color, k, signal);
          if (box && a.text) await writeLabel(g, box, a.text, o, env, signal, k);
        },
      };
    }
    case 'label': {
      const o = textOpts(ctx, env, TEXT_PX.label, color);
      const at = P(a.at);
      const m = measureText(ctx.layers.agent, a.text, o);
      const est = { x: at.x, y: at.y - m.h / 2, ...m };
      return {
        target: ctx.target, bbox: est,
        draw: async (signal, k) => {
          const g = own(ctx.layers.agent);
          const box = nudge(est, env.registry.obstacles(ctx.target), bounds(ctx));
          env.registry.define({ id: a.id, kind: 'label', target: ctx.target, bbox: box, boxes: [box], anchor: { x: box.x, y: box.y + box.h / 2 }, group: g });
          await writeLabel(g, box, a.text, o, env, signal, k);
        },
      };
    }
    case 'write': {
      const o = textOpts(ctx, env, TEXT_PX[a.size], color);
      const at = P(a.at);
      const m = measureText(ctx.layers.agent, a.text, o);
      const box = { x: at.x, y: at.y - m.h / 2, ...m };
      return {
        target: ctx.target, bbox: box,
        draw: async (signal, k) => {
          const g = own(ctx.layers.agent);
          env.registry.define({ id: a.id, kind: 'write', target: ctx.target, bbox: box, boxes: [box], anchor: at, group: g });
          await writeLabel(g, box, a.text, o, env, signal, k);
        },
      };
    }
    case 'shade': {
      const shape: ShadeShape = 'pts' in a ? { pts: a.pts.map(P) } : { c: P(a.at), rx: a.rx, ry: a.ry };
      const bbox = 'pts' in shape ? boxOf(shape.pts) : { x: shape.c.x - shape.rx, y: shape.c.y - shape.ry, w: shape.rx * 2, h: shape.ry * 2 };
      return {
        target: ctx.target, bbox,
        draw: async (signal, k) => {
          const g = own(ctx.layers.highlight);
          // Shades are not obstacles: labels may sit inside a shaded area.
          env.registry.define({ id: a.id, kind: 'shade', target: ctx.target, bbox, boxes: [], anchor: { x: bbox.x + bbox.w / 2, y: bbox.y + bbox.h / 2 }, group: g });
          await drawShade(g, shape, a.em ? env.settings.inkColor : DESK_INK, a.em ? 0.18 : 0.1, k, signal);
        },
      };
    }
    case 'math': {
      const katex = await preloadMath();
      const html = texToHtml(katex, a.tex);
      if (!html) { console.warn('[desk] math does not parse', a.tex); return 'bad tex'; }
      const size = px(MATH_PX[a.size]);
      const at = P(a.at);
      const est = { x: at.x, y: at.y - size * 0.7, w: a.tex.length * size * 0.5, h: size * 1.4 };
      return {
        target: ctx.target, bbox: est,
        draw: async (signal, k) => {
          const g = own(ctx.layers.agent);
          const m = placeMath(g, at, html, size, color);
          env.registry.define({ id: a.id, kind: 'math', target: ctx.target, bbox: m.box, boxes: [m.box], anchor: at, group: g });
          await revealMath(g, m, { style: env.settings.inkStyle, signal, ...k });
        },
      };
    }
  }
}

/** The compass direction closest to a unit vector (y down). */
function compassOf(v: SPt): 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'nw' {
  const dirs = ['e', 'se', 's', 'sw', 'w', 'nw', 'n', 'ne'] as const;
  const a = Math.atan2(v.y, v.x);
  return dirs[(Math.round(a / (Math.PI / 4)) + 8) % 8];
}

async function ref(a: RefAction, env: BuildEnv): Promise<ElementPlan | string> {
  const e = await env.registry.wait(a.ref, REF_WAIT_MS);
  if (!e) { console.warn('[desk] unknown id', a.ref); return 'unknown id'; }
  const ctx = await env.ctx(e.target);
  if (typeof ctx === 'string') return ctx;
  const accent = env.settings.inkColor;
  switch (a.kind) {
    case 'emph':
      return { target: e.target, bbox: e.bbox, draw: (signal) => emphPass(e, accent, ctx.scale(), signal) };
    case 'fade':
      return {
        target: e.target, bbox: e.bbox,
        draw: async (signal) => { env.registry.update(e.id, { faded: true }); await fadeGroup(e.group, FADE_TO, 300, signal); },
      };
    case 'move': {
      if (e.kind !== 'point' && e.kind !== 'label') { console.warn('[desk] move: only points and labels move', a.ref); return 'not movable'; }
      const to = ctx.toSpace({ x: a.to.x, y: Math.min(a.to.y, isRegion(e.target) ? ctx.h : 1000) });
      const dx = to.x - e.anchor.x, dy = to.y - e.anchor.y;
      const shift = (b: SRect) => ({ ...b, x: b.x + dx, y: b.y + dy });
      return {
        target: e.target, bbox: union([e.bbox, shift(e.bbox)]),
        draw: async (signal) => {
          await moveGroup(e.group, dx, dy, MOVE_MS, signal);
          env.registry.update(e.id, { anchor: to, bbox: shift(e.bbox), boxes: e.boxes.map(shift) });
        },
      };
    }
    case 'label': {
      const color = colorOf(e.target, a.em, env);
      const o = textOpts(ctx, env, TEXT_PX.label, color);
      const clear = e.kind === 'point' ? (e.boxes[0]?.w ?? 0) / 2 : 0;
      return {
        target: e.target, bbox: { x: e.anchor.x - 60, y: e.anchor.y - 40, w: 120, h: 80 },
        draw: async (signal, k) => {
          const g = own(ctx.layers.agent);
          const box = placeText(ctx, env, g, a.text, o, e.anchor, a.dir ?? 'ne', clear);
          env.registry.define({ kind: 'label', target: e.target, bbox: box, boxes: [box], anchor: { x: box.x, y: box.y + box.h / 2 }, group: g });
          await writeLabel(g, box, a.text, o, env, signal, k);
        },
      };
    }
  }
}

/** Resolves a connector end to a target-space box. */
async function endBox(end: End, env: BuildEnv): Promise<{ t: Target; r: SRect } | string> {
  const t: Target = 'page' in end ? { page: end.page } : { region: end.region };
  const ctx = await env.ctx(t);
  if (typeof ctx === 'string') return ctx;
  if ('quote' in end) {
    const rects = locateQuote(await ctx.runs(), end.quote, end.near).map((x) => ctx.rectToSpace(x));
    return rects.length ? { t, r: union(rects) } : 'connector anchor not found';
  }
  if ('ref' in end) {
    const e: ElementEntry | undefined = await env.registry.wait(end.ref, REF_WAIT_MS);
    if (!e) { console.warn('[desk] unknown id', end.ref); return 'unknown id'; }
    const s = 8;
    return { t, r: e.kind === 'point' ? (e.boxes[0] ?? e.bbox) : { x: e.anchor.x - s, y: e.anchor.y - s, w: 2 * s, h: 2 * s } };
  }
  const p = ctx.toSpace(end.at), s = 8;
  return { t, r: { x: p.x - s, y: p.y - s, w: 2 * s, h: 2 * s } };
}

/** A connector: both ends are framed together by the director (rule 3), then the Desk routes it. */
async function connect(a: Extract<InkAction, { kind: 'connect' }>, env: BuildEnv): Promise<ElementPlan | string> {
  const [from, to] = await Promise.all([endBox(a.from, env), endBox(a.to, env)]);
  if (typeof from === 'string') return from;
  if (typeof to === 'string') return to;
  return {
    target: from.t, bbox: from.r, also: { target: to.t, bbox: to.r },
    draw: async (signal, k) => {
      const h = env.desk.addConnector(from, to);
      if (typeof h === 'string') return h;
      await drawStrokes(h.group, [h.stroke], {
        color: env.settings.inkColor, width: 1.6, opacity: 0.75, dash: '5 5', scale: h.scale, signal,
        mode: k.fadeMs != null || env.settings.inkStyle === 'clean' || prefersReducedMotion() ? 'fade' : 'trace', fadeMs: k.fadeMs, speed: k.speed,
      });
    },
  };
}
