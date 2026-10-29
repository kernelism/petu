// src/desk/elements.ts
import type { SPt, SRect } from '../geometry/space';
import type { DrawAction, End, InkAction, RefAction, Target, Weight } from '../script/types';
import { circleStroke, lineStroke, arrowStrokes, boxStroke, curveStroke, crossesItself, arcStroke, bisector, braceStroke, type Stroke } from '../ink/agent/strokes';
import { drawStrokes, prefersReducedMotion } from '../ink/agent/animate';
import { weightOf, weightStyle } from '../ink/agent/weights';
import { token, tokenNum } from '../ink/agent/tokens';
import { drawHighlight } from '../ink/agent/marks';
import { locateQuote } from '../locate/locateQuote';
import { compile } from './expr';
import { plotStrokes } from './plot';
import { nudge, placeClear, placeLabel, type Seg } from './nudge';
import { boxOf, strokeBoxes, union, type ElementEntry } from './registry';
import { TEXT_PX, MATH_PX, own, makeText, measureText, reveal, drawDot, drawShade, emphPass, moveGroupTo, translateOf, fadeGroup, textSegments, type TextOpts, type ShadeShape, type ShadeLook } from './render';
import { preloadMath, texToHtml, placeMath, revealMath, setMathAt } from './math';
import type { BuildElement, BuildEnv, ElementPlan, Pace, TargetCtx } from './types';
import { MIN_TEXT_PX } from './layout';
import { KIT_BLOCKS, type KitBlock } from '../script/types';
import { blockPart, isBlockRef } from '../script/pointExpr';
import { SCENE_KINDS, type SceneShape } from '../script/types';
import { buildScene, buildSceneRef, isSceneRef } from './scene/scene';
import { anchorBox, sceneStore } from './scene/store';

/** Waits briefly for a scene thing (or block) named by a ref. */
async function sceneWait(ref: string, env: BuildEnv) { await anchorBox(ref, env.registry, REF_WAIT_MS); }
import { buildBlock, buildKitPlot, buildKitRef, buildReadoutPoint, isKitRef, isReadoutPoint, kitEndBox, resolveKitPoints } from './kit/kit';

/** Closed shapes (circle, box) read as rushed below this, however small… */
export const CLOSED_MIN_MS = 400;
/** …unless the ink is behind the narration: then they may go down to this. */
export const CLOSED_FLOOR_MS = 180;
/** A reference waits this long for its element (still waiting on its own word) before it is skipped. */
export const REF_WAIT_MS = 400;
export const MOVE_MS = 450;
export const FADE_TO = 0.25;
/** Label gap, CSS px at draw time (the dot radius is the --ink-dot-r token). */
const PAD = 6;
/** Connector arrivals within this many CSS px of the element are obstacles for later labels. */
const ARRIVAL_PX = 64;

/**
 * Board type, relative to the slide's body text (`size=m` = the body size): labels and `s` a step
 * smaller, `l` a step larger. Never under MIN_TEXT_PX: a section whose text would be smaller scrolls
 * instead of shrinking (the section's scale is capped for that in layout.boardLayout).
 */
export const BODY_REL = { label: 0.9, s: 0.85, m: 1, l: 1.3 } as const;
/** KaTeX sets its formulas at 1.21 em: math at `size=m` renders at the body size, like the slide's own. */
export const KATEX_EM = 1.21;
/** Board text px for a role: from the slide's body size in a region, the fixed scale on a page. */
export function textPx(ctx: TargetCtx, role: keyof typeof BODY_REL): number {
  const b = ctx.body?.();
  return b ? Math.max(MIN_TEXT_PX, b * BODY_REL[role]) : TEXT_PX[role];
}
/**
 * The font size handed to KaTeX (it scales by KATEX_EM itself): the formula's font size is the body
 * size, like the slide's own math. Its floor is the text floor in x-height terms (KaTeX's math
 * italic has a smaller x-height than the sans, by about KATEX_EM), so a formula never reads smaller
 * than the smallest board text.
 */
export function mathPx(ctx: TargetCtx, size: 's' | 'm' | 'l'): number {
  const b = ctx.body?.();
  return b ? Math.max(MIN_TEXT_PX * KATEX_EM, b * BODY_REL[size]) / KATEX_EM : MATH_PX[size];
}

/** The smallest axis-aligned ellipse through a w × h rect's corners, plus 4 (never under 12). */
export const encloseRect = (w: number, h: number) => ({ rx: Math.max(12, w / Math.SQRT2 + 4), ry: Math.max(12, h / Math.SQRT2 + 4) });

const isRegion = (t: Target) => t.region != null;
const where = (t: Target) => (t.region != null ? `region ${t.region}` : `page ${t.page}`);

/** Resolves one ink action into a plan (see ElementPlan). Strings are skip reasons. */
export const buildElement: BuildElement = async (a, env) => {
  if (a.kind === 'connect') return connect(a, env);
  if ('ref' in a) {
    // A scene thing's verb waits for the thing (it may still be building on its own word).
    if ((a.kind === 'move' && a.place) || a.kind === 'split' || (a.kind === 'set' && (a.text != null || a.value != null || a.weight != null))) await sceneWait(a.ref, env);
    if (isSceneRef(a, env)) return buildSceneRef(a, env);
    return isKitRef(a, env.registry) ? buildKitRef(a, env) : ref(a, env);
  }
  const target: Target = a.region != null ? { region: a.region } : { page: a.page! };
  const ctx = await env.ctx(target);
  if (typeof ctx === 'string') return ctx;
  if (SCENE_KINDS.has(a.kind)) return buildScene(a as SceneShape & DrawAction, ctx, env);
  if (KIT_BLOCKS.has(a.kind)) return buildBlock(a as KitBlock & DrawAction, ctx, env);
  // A point at a readout ({{find}}) is the kit's: it sits on the plot's axes and follows the plot.
  if (isReadoutPoint(a, env.registry)) return buildReadoutPoint(a as Extract<typeof a, { kind: 'point' }>, env);
  // Kit parts named as points (g[2,3]) resolve now that their blocks are laid out.
  const k = await resolveKitPoints(a, env.registry);
  if (typeof k === 'string') return k;
  return draw(centred(k as DrawAction), ctx, env);
};

/** A box given by its centre → its top-left. (Centred text is placed at draw time, once it is measured.) */
function centred(a: DrawAction): DrawAction {
  if (a.kind === 'box' && 'at' in a && a.centered) return { ...a, at: { x: a.at.x - a.w / 2, y: a.at.y - (a.region != null ? a.h : a.h) / 2 }, centered: false };
  return a;
}

/** Ink color: accent on pages; in regions, neutral (--ink) unless `em` (rule 6). */
function colorOf(t: Target, em: boolean | undefined, env: BuildEnv): string {
  return isRegion(t) && !em ? token('--ink') : env.settings.inkColor;
}

/**
 * Text voices. Labels: words in a quiet sans (--ink-label-weight) in --ink-2, symbols in KaTeX's
 * math italic in --ink. Payoffs (`write`): --ink, or the accent with `em`, at the same regular
 * weight. On pages and with `em`, everything is the accent.
 */
function textOpts(ctx: TargetCtx, env: BuildEnv, px: number, em: boolean | undefined, role: 'label' | 'write' = 'label'): TextOpts {
  const neutral = isRegion(ctx.target) && !em;
  const color = !neutral ? env.settings.inkColor : token(role === 'write' ? '--ink' : '--ink-2');
  return { size: px / Math.max(ctx.scale(), 1e-3), style: env.settings.inkStyle, color, symColor: neutral ? token('--ink') : color, run: isRegion(ctx.target) };
}
/** Text with math symbols needs KaTeX's fonts loaded before it is measured. */
const fontsFor = async (...texts: (string | undefined)[]) => {
  if (texts.some((t) => t && textSegments(t).some((g) => g.math))) await preloadMath().catch(() => {});
};

/** Room around a section that labels may use (section units): the board's padding is there for them. */
const REGION_BLEED = 40;
/** The bounds labels must stay in: a page's whole space; a section and the padding around it. */
const bounds = (ctx: TargetCtx): SRect => (isRegion(ctx.target)
  ? { x: -REGION_BLEED, y: -REGION_BLEED, w: 1000 + 2 * REGION_BLEED, h: ctx.h + 2 * REGION_BLEED }
  : { x: 0, y: 0, w: 1000, h: ctx.h });
/** Line pitch of wrapped board text, in ems. */
const LINE_EM = 1.3;
/**
 * Splits text into lines no wider than `maxW` (target units) at spaces. A single word wider than
 * that keeps its own line. Text keeps its left edge: it wraps, it is never shifted back in.
 */
export function wrapLines(layer: SVGGElement, text: string, o: TextOpts, maxW: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let cur = '';
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w;
    if (cur && measureText(layer, next, o).w > maxW) { lines.push(cur); cur = w; } else cur = next;
  }
  if (cur) lines.push(cur);
  return lines.length ? lines : [text];
}
/** The box of wrapped lines whose first line's vertical middle is at at.y, left edge at at.x. */
function linesBox(layer: SVGGElement, lines: string[], o: TextOpts, at: SPt): SRect {
  const ms = lines.map((l) => measureText(layer, l, o));
  const h0 = ms[0].h, pitch = o.size * LINE_EM;
  return { x: at.x, y: at.y - h0 / 2, w: Math.max(...ms.map((m) => m.w)), h: h0 + pitch * (lines.length - 1) };
}
/** Shifts `r` left/up (or right/down) just enough to sit inside `b`; a box larger than `b` keeps its top-left in. */
const inside = (r: SRect, b: SRect): SRect => ({
  ...r,
  x: Math.max(b.x, Math.min(r.x, b.x + b.w - r.w)),
  y: Math.max(b.y, Math.min(r.y, b.y + b.h - r.h)),
});
/** A new group for a sheet: in front of the sheets drawn before it, behind every stroke and text. */
function sheetSlot(layer: SVGGElement): SVGGElement {
  const g = document.createElementNS('http://www.w3.org/2000/svg', 'g') as SVGGElement;
  g.setAttribute('data-sheet', '');
  const first = [...layer.children].find((c) => !c.hasAttribute('data-sheet'));
  layer.insertBefore(g, first ?? null);
  return g;
}
/** Where a move of each group is headed while it glides: its anchor and translate once it lands. */
const moveTo = new WeakMap<SVGGElement, { anchor: SPt; tx: number; ty: number }>();

type Ink = { strokes: Stroke[]; closed?: boolean; dash?: boolean };
type Stroked = DrawAction & { weight?: Weight; dash?: boolean };

/** Stroke width, color, opacity and dash for an element: its weight; `em` (and pages) take the accent. */
function inkOf(a: Stroked, t: Target, env: BuildEnv) {
  const w = weightStyle(weightOf(a), env.settings.inkStyle === 'hand');
  const accent = !isRegion(t) || a.em;
  return { width: w.width, color: accent ? env.settings.inkColor : w.color, opacity: w.opacity, dash: w.dash };
}

/** A plan for stroked elements: traced in order, registered when drawing starts. */
function strokePlan(a: DrawAction, ctx: TargetCtx, env: BuildEnv, ink: Ink, extra: SRect[] = [], after?: (g: SVGGElement, sig: AbortSignal, k: Pace) => Promise<void>): ElementPlan {
  const boxes = strokeBoxes(ink.strokes);
  const bbox = union([...boxes, ...extra].map((b) => ({ x: b.x - PAD, y: b.y - PAD, w: b.w + 2 * PAD, h: b.h + 2 * PAD })));
  const ws = inkOf(a, ctx.target, env);
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
        color: ws.color, width: ws.width, opacity: ws.opacity < 1 ? ws.opacity : undefined, scale: ctx.scale(), signal,
        mode: fade || k.fadeMs != null ? 'fade' : 'trace', fadeMs: k.fadeMs, dash: ink.dash ? ws.dash : undefined,
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
  const segs: Seg[] = env.registry.segments(ctx.target); // every stroke of the target, this element's own included
  return placeClear(anchor, m.w, m.h, dir ?? 'ne', clear, segs, env.registry.obstacles(ctx.target, skip), bounds(ctx));
}

async function writeLabel(g: SVGGElement, box: SRect, text: string, o: TextOpts, env: BuildEnv, signal: AbortSignal, k: Pace) {
  const tg = own(g);
  makeText(tg, { x: box.x, y: box.y + box.h / 2 }, text, o);
  await reveal(tg, box, Array.from(text).length, { style: env.settings.inkStyle, signal, ...k });
}

/** Writes wrapped lines left-aligned at at.x, the first line's middle at at.y. */
async function writeLines(g: SVGGElement, at: SPt, lines: string[], box: SRect, o: TextOpts, env: BuildEnv, signal: AbortSignal, k: Pace) {
  const tg = own(g);
  lines.forEach((l, i) => makeText(tg, { x: at.x, y: at.y + i * o.size * LINE_EM }, l, o));
  await reveal(tg, box, lines.reduce((n, l) => n + Array.from(l).length, 0), { style: env.settings.inkStyle, signal, ...k });
}

async function draw(a: DrawAction, ctx: TargetCtx, env: BuildEnv): Promise<ElementPlan | string> {
  const r = env.rng();
  const P = (p: SPt) => ctx.toSpace(p);
  const anchorRects = async (quote: string, near?: SPt) => locateQuote(await ctx.runs(), quote, near, { aspect: ctx.h / 1000 }).map((x) => ctx.rectToSpace(x));
  const px = (n: number) => n / Math.max(ctx.scale(), 1e-3);
  const DOT_PX = tokenNum('--ink-dot-r');
  await fontsFor('text' in a ? a.text : undefined, a.kind === 'axes' ? a.xLabel : undefined, a.kind === 'axes' ? a.yLabel : undefined);

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
        const { rx, ry } = anchored ? encloseRect(box.w, box.h) : { rx: box.w / 2, ry: box.h / 2 };
        return strokePlan(a, ctx, env, { strokes: [circleStroke({ x: box.x + box.w / 2, y: box.y + box.h / 2 }, rx, ry, r)], closed: true, dash: 'dash' in a && a.dash });
      }
      const pad = anchored ? 5 : 0;
      return strokePlan(a, ctx, env, { strokes: [boxStroke(box.x - pad, box.y - pad, box.w + pad * 2, box.h + pad * 2, r)], closed: true });
    }
    case 'line':
      return strokePlan(a, ctx, env, { strokes: [lineStroke(P(a.from), P(a.to), r)], dash: a.dash });
    case 'arrow':
      return strokePlan(a, ctx, env, { strokes: arrowStrokes(P(a.from), P(a.to), r), dash: a.dash });
    case 'curve': {
      // Points out of order make the spline loop back on itself: skip it, never draw it wrong.
      if (crossesItself(curveStroke(a.pts.map(P), null))) { console.warn('[desk] curve crosses itself', where(ctx.target)); return 'curve crosses itself'; }
      return strokePlan(a, ctx, env, { strokes: [curveStroke(a.pts.map(P), r)], dash: a.dash });
    }
    case 'angle': {
      const c = P(a.at), rad = a.r ?? px(28); // default: 28 CSS px at draw time
      const arc = arcStroke(c, P(a.from), P(a.to), rad);
      if (!a.text) return strokePlan(a, ctx, env, { strokes: [arc] });
      const b = bisector(c, P(a.from), P(a.to));
      const tip = { x: c.x + b.x * (rad + px(10)), y: c.y + b.y * (rad + px(10)) };
      const dir = compassOf(b);
      return strokePlan(a, ctx, env, { strokes: [arc] }, [], async (g, sig, k) => {
        const o = textOpts(ctx, env, textPx(ctx, 'label'), a.em);
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
      return strokePlan(a, ctx, env, { strokes: [s] }, [], async (g, sig, k) => {
        const o = textOpts(ctx, env, textPx(ctx, 'label'), a.em);
        const box = placeText(ctx, env, g, a.text!, o, tip, compassOf(n), 0);
        await writeLabel(g, box, a.text!, o, env, sig, k);
      });
    }
    case 'axes': {
      const o = P(a.at);
      const xs = arrowStrokes(o, { x: o.x + a.w, y: o.y }, null), ys = arrowStrokes(o, { x: o.x, y: o.y - a.h }, null);
      const strokes = [...xs, ...ys];
      const axesBox = { x: o.x, y: o.y - a.h, w: a.w, h: a.h };
      const boxes = strokeBoxes(strokes);
      return {
        target: ctx.target,
        bbox: union([...boxes, { x: o.x - 60, y: o.y - a.h - 30, w: a.w + 80, h: a.h + 60 }]),
        draw: async (signal, k) => {
          const g = own(ctx.layers.agent);
          env.registry.define({ id: a.id, kind: 'axes', target: ctx.target, bbox: axesBox, boxes, anchor: { x: o.x + a.w, y: o.y - a.h }, group: g, strokes });
          const tOpts = textOpts(ctx, env, textPx(ctx, 's'), false);
          const ws = inkOf(a, ctx.target, env);
          await drawStrokes(g, strokes, { color: ws.color, width: ws.width, opacity: ws.opacity < 1 ? ws.opacity : undefined, scale: ctx.scale(), signal, mode: k.fadeMs != null || env.settings.inkStyle === 'clean' || prefersReducedMotion() ? 'fade' : 'trace', fadeMs: k.fadeMs, speed: k.speed });
          if (a.xLabel) { const m = measureText(g, a.xLabel, tOpts); await writeLabel(g, { x: o.x + a.w - m.w, y: o.y + px(8), ...m }, a.xLabel, tOpts, env, signal, k); }
          if (a.yLabel) { const m = measureText(g, a.yLabel, tOpts); await writeLabel(g, { x: o.x + px(8), y: o.y - a.h - m.h / 2, ...m }, a.yLabel, tOpts, env, signal, k); }
        },
      };
    }
    case 'plot': {
      // On a hand-drawn {{axes}} (named, or the region's latest when none is named): sampled into
      // strokes as before. Otherwise the engine draws the graph with its own axes (kit line view).
      const ax = a.axes ? await env.registry.wait(a.axes, REF_WAIT_MS) : env.registry.latest(ctx.target, 'axes');
      if (!ax || ax.kind !== 'axes' || !a.fn || !a.domain) return buildKitPlot(a as Parameters<typeof buildKitPlot>[0], ctx, env);
      let fn;
      try { fn = compile(a.fn); } catch (e) { console.warn('[desk] plot: bad fn', a.fn, e); return 'bad fn'; }
      const strokes = plotStrokes(fn, a.domain, { x: ax.bbox.x, y: ax.bbox.y + ax.bbox.h, w: ax.bbox.w, h: ax.bbox.h }, a.range);
      if (!strokes.length) return 'nothing to plot';
      return strokePlan(a, ctx, env, { strokes, dash: a.dash });
    }
    case 'point': {
      const c = P(a.at), rad = px(DOT_PX);
      const dot = { x: c.x - rad, y: c.y - rad, w: rad * 2, h: rad * 2 };
      const color = colorOf(ctx.target, a.em, env);
      const o = textOpts(ctx, env, textPx(ctx, 'label'), a.em);
      const est = a.text ? placeLabel(c, measureText(ctx.layers.agent, a.text, o).w, o.size * 1.2, a.dir ?? 'ne', rad) : null;
      return {
        target: ctx.target,
        bbox: union([dot, ...(est ? [est] : [])].map((b) => ({ x: b.x - PAD, y: b.y - PAD, w: b.w + 2 * PAD, h: b.h + 2 * PAD }))),
        draw: async (signal, k) => {
          const g = own(ctx.layers.agent);
          const od = textOpts(ctx, env, textPx(ctx, 'label'), a.em); // sized for the scale now (a column glide may have run since build)
          const box = a.text ? placeText(ctx, env, g, a.text, od, c, a.dir ?? 'ne', rad) : null;
          env.registry.define({ id: a.id, kind: 'point', target: ctx.target, bbox: union([dot, ...(box ? [box] : [])]), boxes: [dot, ...(box ? [box] : [])], anchor: c, group: g });
          await drawDot(g, c, rad, color, k, signal);
          if (box && a.text) await writeLabel(g, box, a.text, od, env, signal, k);
        },
      };
    }
    case 'label': {
      const o = textOpts(ctx, env, textPx(ctx, 'label'), a.em);
      const at = P(a.at);
      const m = measureText(ctx.layers.agent, a.text, o);
      const est = inside({ x: at.x, y: at.y - m.h / 2, ...m }, bounds(ctx));
      return {
        target: ctx.target, bbox: est,
        draw: async (signal, k) => {
          const g = own(ctx.layers.agent);
          const od = textOpts(ctx, env, textPx(ctx, 'label'), a.em), md = measureText(g, a.text, od); // measured at draw time
          const box = nudge({ x: at.x, y: at.y - md.h / 2, ...md }, env.registry.obstacles(ctx.target), bounds(ctx));
          env.registry.define({ id: a.id, kind: 'label', target: ctx.target, bbox: box, boxes: [box], anchor: { x: box.x, y: box.y + box.h / 2 }, group: g });
          await writeLabel(g, box, a.text, od, env, signal, k);
        },
      };
    }
    case 'write': {
      // Left-aligned at `at`, always: text too long for the section wraps under itself (never shifted back in).
      let at = P(a.at);
      const room = (o: TextOpts) => Math.max(1000 - at.x, o.size * 8);
      const o = textOpts(ctx, env, textPx(ctx, a.size), a.em, 'write');
      if (a.centered) {
        // Centred on `at`: one line, its middle there (never wrapped: a centred label is short).
        const w = measureText(ctx.layers.agent, a.text, o).w;
        at = { x: Math.max(0, at.x - w / 2), y: at.y };
      }
      const est = linesBox(ctx.layers.agent, wrapLines(ctx.layers.agent, a.text, o, room(o)), o, at);
      return {
        target: ctx.target, bbox: est,
        draw: async (signal, k) => {
          const g = own(ctx.layers.agent);
          const od = textOpts(ctx, env, textPx(ctx, a.size), a.em, 'write'); // measured at draw time
          const lines = wrapLines(g, a.text, od, room(od));
          const box = linesBox(g, lines, od, at);
          env.registry.define({ id: a.id, kind: 'write', target: ctx.target, bbox: box, boxes: [box], anchor: { x: box.x, y: at.y }, group: g });
          await writeLines(g, at, lines, box, od, env, signal, k);
        },
      };
    }
    case 'shade': {
      const shape: ShadeShape = 'pts' in a ? { pts: a.pts.map(P) } : { c: P(a.at), rx: a.rx, ry: a.ry };
      const bbox = 'pts' in shape ? boxOf(shape.pts) : { x: shape.c.x - shape.rx, y: shape.c.y - shape.ry, w: shape.rx * 2, h: shape.ry * 2 };
      return {
        target: ctx.target, bbox,
        draw: async (signal, k) => {
          // In a region a shade is a sheet in the ink layer, behind every stroke and after the sheets
          // before it: opaque, so overlaps never muddy (and clear of the highlight layer's multiply).
          // On a page it stays a multiply tint in the highlight layer, so the slide shows through.
          const region = isRegion(ctx.target);
          const g = region ? sheetSlot(ctx.layers.agent) : own(ctx.layers.highlight);
          // Shades are not obstacles: labels may sit inside a shaded area.
          env.registry.define({ id: a.id, kind: 'shade', target: ctx.target, bbox, boxes: [], anchor: { x: bbox.x + bbox.w / 2, y: bbox.y + bbox.h / 2 }, group: g });
          const accent = env.settings.inkColor, line = a.outline ? token('--shade-line') : undefined;
          const look: ShadeLook = a.em
            ? { fill: accent, fillOpacity: tokenNum('--shade-tint'), stroke: a.outline ? accent : undefined, strokeOpacity: 0.6 }
            : region ? { fill: token('--shade-sheet'), fillOpacity: 1, stroke: line }
            : { fill: token('--ink'), fillOpacity: 0.07, stroke: line };
          await drawShade(g, shape, look, k, signal);
        },
      };
    }
    case 'math': {
      const katex = await preloadMath();
      const html = texToHtml(katex, a.tex, isRegion(ctx.target));
      if (!html) { console.warn('[desk] math does not parse', a.tex); return 'bad tex'; }
      // Left-aligned at `at` (its vertical middle there), at the slide's body size: never shifted per element.
      const size = px(mathPx(ctx, a.size)) * KATEX_EM;
      const at0 = P(a.at);
      // Centred math: its width is known once typeset; estimated here for the reveal box.
      const at = a.centered ? { x: Math.max(0, at0.x - (a.tex.length * size * 0.5) / 2), y: at0.y } : at0;
      const est = { x: at.x, y: at.y - size * 0.7, w: a.tex.length * size * 0.5, h: size * 1.4 };
      return {
        target: ctx.target, bbox: est,
        draw: async (signal, k) => {
          const g = own(ctx.layers.agent);
          const m = placeMath(g, at, html, px(mathPx(ctx, a.size)), colorOf(ctx.target, a.em, env));
          if (a.centered) setMathAt(m, Math.max(0, at0.x - m.box.w / 2), m.box.y);
          env.registry.define({ id: a.id, kind: 'math', target: ctx.target, bbox: m.box, boxes: [m.box], anchor: { x: m.box.x, y: m.box.y + m.box.h / 2 }, group: g });
          await revealMath(g, m, { style: env.settings.inkStyle, signal, ...k });
        },
      };
    }
    default:
      return 'not drawable here';
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
      // A connector's strokes are in desk px (scale 1), not its region's units.
      return { target: e.target, bbox: e.bbox, draw: (signal) => emphPass(e, accent, e.kind === 'connect' ? 1 : ctx.scale(), signal) };
    case 'fade':
      return {
        target: e.target, bbox: e.bbox,
        draw: async (signal) => { env.registry.update(e.id, { faded: true }); await fadeGroup(e.group, FADE_TO, 300, signal); },
      };
    case 'move': {
      if (e.kind !== 'point' && e.kind !== 'label') { console.warn('[desk] move: only points and labels move', a.ref); return 'not movable'; }
      if (!a.to) return 'move needs to=';
      const to = ctx.toSpace({ x: a.to.x, y: Math.min(a.to.y, isRegion(e.target) ? ctx.h : 1000) });
      const by = (from: SPt) => (b: SRect) => ({ ...b, x: b.x + to.x - from.x, y: b.y + to.y - from.y });
      return {
        target: e.target, bbox: union([e.bbox, by(moveTo.get(e.group)?.anchor ?? e.anchor)(e.bbox)]),
        draw: async (signal) => {
          // A move still gliding toward its own target is the base, not where the group is now (no overshoot).
          const cur = translateOf(e.group);
          const base = moveTo.get(e.group) ?? { anchor: e.anchor, tx: cur.x, ty: cur.y };
          const dest = { anchor: to, tx: base.tx + to.x - base.anchor.x, ty: base.ty + to.y - base.anchor.y };
          moveTo.set(e.group, dest);
          await moveGroupTo(e.group, dest.tx, dest.ty, MOVE_MS, signal);
          const shift = by(e.anchor); // the registry follows in landing order
          env.registry.update(e.id, { anchor: to, bbox: shift(e.bbox), boxes: e.boxes.map(shift) });
          if (moveTo.get(e.group) === dest) moveTo.delete(e.group);
        },
      };
    }
    case 'label': {
      await fontsFor(a.text);
      const clear = e.kind === 'point' ? (e.boxes[0]?.w ?? 0) / 2 : 0;
      return {
        target: e.target, bbox: { x: e.anchor.x - 60, y: e.anchor.y - 40, w: 120, h: 80 },
        draw: async (signal, k) => {
          const g = own(ctx.layers.agent);
          const o = textOpts(ctx, env, textPx(ctx, 'label'), a.em);
          const box = placeText(ctx, env, g, a.text, o, e.anchor, a.dir ?? 'ne', clear);
          env.registry.define({ kind: 'label', target: e.target, bbox: box, boxes: [box], anchor: { x: box.x, y: box.y + box.h / 2 }, group: g });
          await writeLabel(g, box, a.text, o, env, signal, k);
        },
      };
    }
    default:
      return 'not a reference';
  }
}

/** Elements a connector meets at their anchor (a stroke's end); every other kind is met at its box. */
const ENDS_AT_ANCHOR = new Set(['line', 'arrow', 'curve', 'angle', 'connect']);

/** Resolves a connector end to a target-space box. */
async function endBox(end: End, env: BuildEnv): Promise<{ t: Target; r: SRect; point?: boolean } | string> {
  const t: Target = 'page' in end ? { page: end.page } : { region: end.region };
  const ctx = await env.ctx(t);
  if (typeof ctx === 'string') return ctx;
  if ('quote' in end) {
    const rects = locateQuote(await ctx.runs(), end.quote, end.near, { aspect: ctx.h / 1000 }).map((x) => ctx.rectToSpace(x));
    return rects.length ? { t, r: union(rects) } : 'connector anchor not found';
  }
  if ('ref' in end && sceneStore(env.registry).get(isBlockRef(end.ref) ? blockPart(end.ref)!.id : end.ref)) {
    const b = await anchorBox(end.ref, env.registry);
    return b ? { t, r: b } : `unknown ${end.ref}`;
  }
  if ('ref' in end && isBlockRef(end.ref)) return kitEndBox(end.region, end.ref, env.registry);
  if ('ref' in end) {
    const e: ElementEntry | undefined = await env.registry.wait(end.ref, REF_WAIT_MS);
    if (!e) { console.warn('[desk] unknown id', end.ref); return 'unknown id'; }
    // A point: the wire runs right up to its dot (the dot is the end mark). A stroke that ends
    // somewhere (line, arrow, curve, angle): near that end. Anything with an area (box, circle,
    // shade, label, math, plot…): the element itself, so the router arrives at its nearest edge's
    // midpoint, never at the corner where its outline happened to start.
    if (e.kind === 'point') return { t, r: { x: e.anchor.x - 0.5, y: e.anchor.y - 0.5, w: 1, h: 1 }, point: true };
    if (!ENDS_AT_ANCHOR.has(e.kind)) return { t, r: e.boxes.length ? union(e.boxes) : e.bbox };
    const s = 8;
    return { t, r: { x: e.anchor.x - s, y: e.anchor.y - s, w: 2 * s, h: 2 * s } };
  }
  if ('rect' in end) return { t, r: ctx.rectToSpace(end.rect) };
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
      const regionAtEnd = to.t.region != null;
      const reg = regionAtEnd ? to : from;
      // The region's ink so far: the connector arrives the way that crosses least of it.
      const h = env.desk.addConnector({ t: from.t, r: from.r }, { t: to.t, r: to.r }, env.registry.obstacles(reg.t));
      if (typeof h === 'string') return h;
      // Registered under its id so fade/emph reach it. It lives in desk (or stage) px, not in either
      // end's target space, so it is revealed through its region end. Its last stretch into the
      // element (mapped into the region) is an obstacle, so later labels sit clear of the arrival.
      // `h.stroke` is the Desk's own array, kept current on every re-route (emph re-traces the live path).
      const entry = env.registry.define({ id: a.id, kind: 'connect', target: reg.t, bbox: reg.r, boxes: [], anchor: { x: reg.r.x + reg.r.w / 2, y: reg.r.y + reg.r.h / 2 }, group: h.group, strokes: [h.stroke] });
      // A thin solid accent line: part of the drawing, not UI chrome.
      await drawStrokes(h.group, [h.stroke], {
        color: env.settings.inkColor, width: tokenNum('--ink-connector-w'), scale: h.scale, signal,
        mode: k.fadeMs != null || env.settings.inkStyle === 'clean' || prefersReducedMotion() ? 'fade' : 'trace', fadeMs: k.fadeMs, speed: k.speed,
      });
      if (!reg.point) endDot(h.group, regionAtEnd ? 'end' : 'start', env.settings.inkColor);
      const rctx = await env.ctx(reg.t);
      if (typeof rctx !== 'string') {
        const boxes = arrivalBoxes(h.group, h.stroke, regionAtEnd, rctx.layers.agent);
        if (boxes.length) env.registry.update(entry, { boxes });
      }
    },
  };
}

let dots = 0;
/** A small dot where the connector meets its element: a marker, so it follows every re-route. */
function endDot(g: SVGGElement, at: 'start' | 'end', color: string) {
  const svg = g.ownerSVGElement, path = g.querySelector('path');
  if (!svg || !path) return;
  const SVGNS = 'http://www.w3.org/2000/svg';
  const id = `desk-wire-dot-${++dots}`;
  const defs = svg.querySelector('defs') ?? svg.insertBefore(document.createElementNS(SVGNS, 'defs'), svg.firstChild);
  const m = defs.appendChild(document.createElementNS(SVGNS, 'marker'));
  const r = 2.25;
  Object.entries({ id, markerUnits: 'userSpaceOnUse', markerWidth: 2 * r + 2, markerHeight: 2 * r + 2, refX: r + 1, refY: r + 1, overflow: 'visible' })
    .forEach(([k, v]) => m.setAttribute(k, String(v)));
  const c = m.appendChild(document.createElementNS(SVGNS, 'circle'));
  Object.entries({ cx: r + 1, cy: r + 1, r, fill: color }).forEach(([k, v]) => c.setAttribute(k, String(v)));
  path.setAttribute(at === 'end' ? 'marker-end' : 'marker-start', `url(#${id})`);
}

/**
 * The connector's last ARRIVAL_PX into its element, mapped from the wire's frame into the region's
 * space through the two screen transforms, as a few small boxes. Empty without layout (jsdom).
 */
function arrivalBoxes(g: SVGGElement, stroke: SPt[], atEnd: boolean, region: SVGGElement): SRect[] {
  const a = g.getScreenCTM?.(), b = region.getScreenCTM?.()?.inverse();
  if (!a || !b || stroke.length < 2) return [];
  const pts = atEnd ? stroke.slice().reverse() : stroke.slice();
  const near: SPt[] = [pts[0]];
  for (let i = 1, d = 0; i < pts.length && d < ARRIVAL_PX; i++) {
    const p = pts[i - 1], q = pts[i], L = Math.hypot(q.x - p.x, q.y - p.y);
    const f = Math.min(1, (ARRIVAL_PX - d) / (L || 1)); // the last piece is cut at ARRIVAL_PX
    near.push({ x: p.x + (q.x - p.x) * f, y: p.y + (q.y - p.y) * f });
    d += L;
  }
  const map = (p: SPt): SPt => {
    const x = a.a * p.x + a.c * p.y + a.e, y = a.b * p.x + a.d * p.y + a.f;
    return { x: b.a * x + b.c * y + b.e, y: b.b * x + b.d * y + b.f };
  };
  const scale = Math.hypot(b.a, b.b) || 1;
  return strokeBoxes([near.map(map)], 4, 5 * scale);
}
