// src/desk/scene/scene.ts
/**
 * Board v2 things (spec "Board v2: one connected scene"): nodes (labelled chips), flows (sequences of
 * chips), links (weighted, labelled relations routed around content) and notes (text by relation,
 * or callouts with a leader line), plus the continuity verbs on them (move by relation, set a new
 * label, value or strength). Everything is placed by relation (place.ts) in the section's world and
 * claims its room there; values come from the kit (a part's value), so they are never hand-written
 * and they follow `set`.
 */
import type { DrawAction, RefAction, SceneShape, ValueRef } from '../../script/types';
import type { BuildEnv, ElementPlan, Pace, TargetCtx } from '../types';
import { blockPart, isBlockRef } from '../../script/pointExpr';
import { kitStore, metrics, type Block } from '../kit/kit';
import { kitText, svg, setAttrs, textWidth } from '../kit/text';
import { tween, easeOut } from '../kit/anim';
import { fmt } from '../kit/compute';
import { token } from '../../ink/agent/tokens';
import { prefersReducedMotion } from '../../ink/agent/animate';
import { placeRel, type Box } from './place';
import { routeLink, pathD, at, dirAt, samples, type Route } from './route';
import { anchorBox, sceneStore, type Thing } from './store';

type S = SceneShape & DrawAction;
const hair = (w: number) => ({ 'stroke-width': w, 'vector-effect': 'non-scaling-stroke' });
const union = (rs: Box[]): Box => {
  const x = Math.min(...rs.map((r) => r.x)), y = Math.min(...rs.map((r) => r.y));
  return { x, y, w: Math.max(...rs.map((r) => r.x + r.w)) - x, h: Math.max(...rs.map((r) => r.y + r.h)) - y };
};
const grow = (b: Box, p: number): Box => ({ x: b.x - p, y: b.y - p, w: b.w + 2 * p, h: b.h + 2 * p });
const outline = (r: Box) => [{ x: r.x, y: r.y }, { x: r.x + r.w, y: r.y }, { x: r.x + r.w, y: r.y + r.h }, { x: r.x, y: r.y + r.h }, { x: r.x, y: r.y }];
const colors = () => ({ ink: token('--ink'), ink2: token('--ink-2'), cell: token('--kit-cell'), edge: token('--kit-edge'), muted: token('--kit-muted'), bar: token('--kit-bar') });

let anon = 0;

/** The value a ValueRef shows now (a literal, or a kit block's part), and the block it follows. */
async function valueOf(v: ValueRef, env: BuildEnv): Promise<{ get(): number; src?: string; norm(): number }> {
  if (typeof v === 'number') return { get: () => v, norm: () => v };
  const store = kitStore(env.registry);
  const p = isBlockRef(v) ? blockPart(v) : null;
  const id = p ? p.id : v;
  const b = await store.wait(id);
  const vals = (bb?: Block) => bb?.vals?.flat() ?? [];
  const i = p ? p.c0 : 0;
  return {
    get: () => vals(store.get(id))[i] ?? NaN,
    // Strength 0–1: a share is already one; anything else scales by the block's largest magnitude.
    norm: () => { const xs = vals(store.get(id)); const x = xs[i]; if (store.get(id)?.kind === 'shares') return x; const mx = Math.max(...xs.map(Math.abs).filter(Number.isFinite), 1e-9); return Math.abs(x) / mx; },
    ...(b ? { src: id } : {}),
  };
}

/** Builds a scene thing into a plan. A string is a skip reason. */
export async function buildScene(a: S, ctx: TargetCtx, env: BuildEnv): Promise<ElementPlan | string> {
  if (!ctx.scene) return `${a.kind} lives in a scene ({{scene}})`;
  const m = metrics(ctx.scale(), ctx.body?.() ?? 16);
  const store = sceneStore(env.registry);
  const id = a.id ?? `_s${++anon}`;
  if (a.id && (store.get(a.id) || env.registry.get(a.id))) return 'duplicate id';
  const c = colors(), accent = env.settings.inkColor;
  const taken = () => [...ctx.scene!.rects(), ...env.registry.obstacles(ctx.target)];
  const placeBox = async (w: number, h: number, place?: { rel: string; of: string }) => {
    const anchor = place ? await anchorBox(place.of, env.registry) : null;
    if (place && !anchor) console.warn('[scene] unknown anchor, placed after the last thing:', place.of);
    return placeRel(w, h, (anchor ? place!.rel : null) as never, anchor, taken(), { gap: m.gap * 1.25, seed: id, view: ctx.scene!.view() });
  };
  const chipH = m.num * 2.1, padX = m.num * 0.85;
  const chipW = (t: string) => Math.max(chipH * 1.6, m.u(textWidth(t, m.numPx)) + 2 * padX);

  if (a.kind === 'node' || a.kind === 'flow') {
    const items = a.kind === 'node' ? [a.text] : a.items;
    const vals = a.kind === 'node' ? (a.value != null ? [a.value] : null) : a.values ? items.map((_, i) => `${a.values}[${i + 1}]`) : null;
    const gap = a.kind === 'flow' && a.arrows ? m.gap * 1.25 : m.label * 0.9;
    const down = a.kind === 'flow' && a.down;
    const ws = items.map(chipW);
    const valH = vals ? m.label * 1.7 : 0;
    const W = down ? Math.max(...ws) : ws.reduce((s, w) => s + w, 0) + gap * (items.length - 1);
    const H = down ? items.length * (chipH + valH) + gap * (items.length - 1) : chipH + valH;
    const r = await placeBox(W, H, a.place);
    const parts: Box[] = [];
    let x = r.x, y = r.y;
    for (const w of ws) {
      parts.push(down ? { x: r.x + (W - w) / 2, y, w, h: chipH } : { x, y: r.y, w, h: chipH });
      x += w + gap; y += chipH + valH + gap;
    }
    const claim = ctx.scene.claim(r);
    const thing = store.put(id, { rect: r, parts, claim, moved: new Set(), data: { kind: a.kind } });
    const vs = vals ? await Promise.all(vals.map((v) => valueOf(v, env))) : null;
    return {
      target: ctx.target, bbox: grow(r, m.u(6)),
      draw: async (_signal, k) => {
        const g = svg(ctx.layers.agent, 'g', { class: 'scene-thing', 'data-scene': a.kind });
        thing.group = g;
        env.registry.define({ id: a.id, kind: `scene-${a.kind}`, target: ctx.target, bbox: r, boxes: [r], anchor: { x: r.x + r.w, y: r.y }, group: g, strokes: [outline(r)] });
        const chips: SVGRectElement[] = [], vtexts: SVGTextElement[] = [];
        items.forEach((t, i) => {
          const p = parts[i];
          const sub = svg(g, 'g', { opacity: 0 });
          chips.push(svg(sub, 'rect', { x: p.x, y: p.y, width: p.w, height: p.h, rx: p.h / 2, fill: a.em ? accent : c.cell, 'fill-opacity': a.em ? 0.1 : 1, stroke: a.em ? accent : c.edge, ...hair(a.em ? 1.6 : 1.1) }));
          kitText(sub, p.x + p.w / 2, p.y + p.h / 2, t, { size: m.num, fill: c.ink });
          if (vs) vtexts.push(kitText(sub, p.x + p.w / 2, p.y + p.h + m.label * 0.95, '', { size: m.label, fill: c.ink2 }));
          if (a.kind === 'flow' && a.arrows && i > 0) {
            const q = parts[i - 1];
            const from = down ? { x: q.x + q.w / 2, y: q.y + q.h + valH + m.u(3) } : { x: q.x + q.w + m.u(4), y: q.y + q.h / 2 };
            const to = down ? { x: p.x + p.w / 2, y: p.y - m.u(4) } : { x: p.x - m.u(5), y: p.y + p.h / 2 };
            arrowTo(sub, from, to, c.ink2, m.u(1.2), m.u(7));
          }
          void tween(k.fadeMs != null ? 0 : 220 * k.speed, (t2) => sub.setAttribute('opacity', String(t2)), undefined, easeOut);
        });
        thing.data!.chips = chips;
        const paint = () => vs?.forEach((v, i) => { const x0 = v.get(); vtexts[i].textContent = Number.isFinite(x0) ? (kitStore(env.registry).get(v.src ?? '')?.kind === 'shares' ? `${Math.round(x0 * 100)}%` : fmt(x0, 2)) : ''; });
        paint();
        vs?.forEach((v) => v.src && kitStore(env.registry).listen(v.src, paint));
        await new Promise((res) => setTimeout(res, k.fadeMs != null ? 0 : Math.min(600, 120 * items.length) * k.speed));
      },
    };
  }

  if (a.kind === 'note') {
    const lines = wrap(a.text, m, 15);
    const w = Math.max(...lines.map((l) => m.u(textWidth(l, m.labelPx)))), h = lines.length * m.label * 1.35;
    const target = a.annotate ? await anchorBox(a.annotate, env.registry) : null;
    if (a.annotate && !target) return `unknown ${a.annotate}`;
    // A callout sits near what it annotates (above or below first: a leader reads best short and slanted).
    const r = await placeBox(w, h, a.annotate ? { rel: 'near', of: a.annotate } : a.place);
    const claim = ctx.scene.claim(r);
    store.put(id, { rect: r, claim, moved: new Set(), data: { kind: 'note' } });
    return {
      target: ctx.target, bbox: grow(target ? union([r, target]) : r, m.u(6)),
      draw: async (_signal, k) => {
        const g = svg(ctx.layers.agent, 'g', { class: 'scene-thing', 'data-scene': 'note', opacity: 0 });
        store.get(id)!.group = g;
        let strokes = [outline(r)];
        if (target) {
          // The leader: from the note's nearest edge midpoint to the target's, ending in a small dot.
          const [p, q] = nearestEdges(r, target, m.u(4));
          svg(g, 'path', { d: `M${p.x} ${p.y} L${q.x} ${q.y}`, stroke: a.em ? accent : c.ink2, fill: 'none', ...hair(1) });
          svg(g, 'circle', { cx: q.x, cy: q.y, r: m.u(2.2), fill: a.em ? accent : c.ink2 });
          strokes = [[p, q]];
        }
        lines.forEach((l, i) => kitText(g, r.x, r.y + m.label * (0.68 + i * 1.35), l, { size: m.label, fill: a.em ? accent : c.ink2, anchor: 'start' }));
        env.registry.define({ id: a.id, kind: 'scene-note', target: ctx.target, bbox: r, boxes: [r], anchor: { x: r.x, y: r.y + h / 2 }, group: g, strokes });
        await tween(k.fadeMs != null ? 0 : 260 * k.speed, (t) => g.setAttribute('opacity', String(t)), undefined, easeOut);
      },
    };
  }

  // link
  const L = a as Extract<SceneShape, { kind: 'link' }> & DrawAction;
  const from = await anchorBox(L.from, env.registry), to = await anchorBox(L.to, env.registry);
  if (!from) return `unknown ${L.from}`;
  if (!to) return `unknown ${L.to}`;
  // One to many: `to` is a flow (every chip) and the strength a whole block (one value per chip).
  const toThing = !isBlockRef(L.to) ? store.get(L.to) : undefined;
  const fan = !!toThing?.parts && toThing.parts.length > 1 && typeof L.strength === 'string' && !isBlockRef(L.strength);
  const targets = fan ? toThing!.parts!.map((_, i) => `${L.to}[${i + 1}]`) : [L.to];
  const strengths = await Promise.all(targets.map((_, i) => (L.strength == null ? null : valueOf(fan ? `${L.strength}[${i + 1}]` : L.strength, env))));
  const fromKey = L.from, ends = await Promise.all(targets.map((t) => anchorBox(t, env.registry)));
  const skipBoxes = (x: Box, y: Box) => taken().filter((b) => !contains(grow(x, 1), b) && !contains(grow(y, 1), b) && !contains(b, x) && !contains(b, y));
  const routes = ends.map((e) => routeLink(from, e!, skipBoxes(from, e!), m.u(4), m.u(3)));
  const bbox = grow(union(routes.flatMap((q) => samples(q, 8)).map((p) => ({ x: p.x, y: p.y, w: 0, h: 0 }))), m.u(14));
  return {
    target: ctx.target, bbox,
    draw: async (_signal, k) => {
      const g = svg(ctx.layers.agent, 'g', { class: 'scene-link' });
      const els = routes.map(() => ({ path: svg(g, 'path', { fill: 'none', 'stroke-linecap': 'round' }), head: L.plain ? null : svg(g, 'path', { stroke: 'none' }) }));
      const label = L.text || L.showWeight ? kitText(g, 0, 0, '', { size: m.label, fill: L.em ? accent : c.ink2, halo: token('--board-paper') || '#fff', haloW: m.label * 0.35 }) : null;
      const paint = (tr = 1) => {
        routes.forEach((q, i) => {
          const s = strengths[i]?.norm();
          const w = s == null || !Number.isFinite(s) ? 0.5 : Math.max(0, Math.min(1, s));
          const px = s == null ? 1.4 : 0.7 + 4.3 * w;
          const col = L.em ? accent : s == null ? c.ink2 : c.ink;
          setAttrs(els[i].path, { d: pathD(q), stroke: col, 'stroke-opacity': s == null ? 0.75 : 0.22 + 0.7 * w, 'stroke-width': m.u(px), ...(L.dash ? { 'stroke-dasharray': `${m.u(5)} ${m.u(4)}` } : {}) });
          if (els[i].head) {
            const tip = at(q, 1), d = dirAt(q, 1), n = Math.hypot(d.x, d.y) || 1, ux = d.x / n, uy = d.y / n, hl = m.u(5 + px * 0.9), hw = m.u(3 + px * 0.6);
            setAttrs(els[i].head!, { d: `M${tip.x} ${tip.y} L${tip.x - ux * hl - uy * hw} ${tip.y - uy * hl + ux * hw} L${tip.x - ux * hl + uy * hw} ${tip.y - uy * hl - ux * hw}Z`, fill: col, 'fill-opacity': s == null ? 0.75 : 0.3 + 0.7 * w, opacity: tr >= 1 ? 1 : 0 });
          }
        });
        if (label) {
          const q = routes[0], p = at(q, 0.5), d = dirAt(q, 0.5), n = Math.hypot(d.x, d.y) || 1;
          let nx = -d.y / n, ny = d.x / n;
          if (ny > 0) { nx = -nx; ny = -ny; }
          const txt = [L.text, L.showWeight && strengths[0] ? fmtW(strengths[0]!.get()) : ''].filter(Boolean).join(' ');
          label.textContent = txt;
          setAttrs(label, { x: p.x + nx * m.label * 0.9, y: p.y + ny * m.label * 0.9 });
        }
      };
      // Traced from its start, like a hand drawing it.
      paint(0);
      const lens = els.map((e) => { try { return e.path.getTotalLength(); } catch { return 0; } });
      if (k.fadeMs == null && !prefersReducedMotion() && lens.every((x) => x > 0)) {
        els.forEach((e, i) => setAttrs(e.path, { 'stroke-dasharray': `${lens[i]} ${lens[i]}`, 'stroke-dashoffset': lens[i] }));
        label?.setAttribute('opacity', '0');
        await tween(Math.min(700, 300 + routes.length * 60) * k.speed, (t) => els.forEach((e, i) => e.path.setAttribute('stroke-dashoffset', String(lens[i] * (1 - t)))));
        els.forEach((e) => { e.path.removeAttribute('stroke-dasharray'); e.path.removeAttribute('stroke-dashoffset'); });
        label?.setAttribute('opacity', '1');
      }
      paint(1);
      const boxes = routes.flatMap((q) => samples(q, 10).map((p) => ({ x: p.x - m.u(3), y: p.y - m.u(3), w: m.u(6), h: m.u(6) })));
      env.registry.define({ id: a.id, kind: 'scene-link', target: ctx.target, bbox, boxes, anchor: at(routes[0], 1), group: g, strokes: routes.map((q) => samples(q, 16)) });
      const link = { routes, strengths, paint, from: fromKey, targets };
      store.put(id, { rect: bbox, data: { kind: 'link', link } });
      // Re-weight when the values move (set), re-route when an end moves.
      strengths.forEach((s) => s?.src && kitStore(env.registry).listen(s.src, () => paint()));
      const reroute = async () => {
        const f = await anchorBox(fromKey, env.registry, 0);
        for (let i = 0; i < targets.length; i++) { const e = await anchorBox(targets[i], env.registry, 0); if (f && e) routes[i] = routeLink(f, e, skipBoxes(f, e), m.u(4), m.u(3)); }
        paint();
      };
      for (const key of [fromKey, ...targets]) store.get(blockPart(key)?.id ?? key)?.moved?.add(() => void reroute());
    },
  };
}

const fmtW = (v: number) => (Number.isFinite(v) ? (v <= 1 && v >= 0 ? `${Math.round(v * 100)}%` : fmt(v, 2)) : '');
const contains = (o: Box, i: Box) => i.x >= o.x && i.y >= o.y && i.x + i.w <= o.x + o.w && i.y + i.h <= o.y + o.h;

function arrowTo(g: SVGGElement, a: { x: number; y: number }, b: { x: number; y: number }, color: string, w: number, head: number) {
  const dx = b.x - a.x, dy = b.y - a.y, n = Math.hypot(dx, dy) || 1, ux = dx / n, uy = dy / n;
  svg(g, 'path', { d: `M${a.x} ${a.y} L${b.x - ux * head * 0.6} ${b.y - uy * head * 0.6}`, stroke: color, 'stroke-width': w, fill: 'none', 'stroke-linecap': 'round' });
  svg(g, 'path', { d: `M${b.x} ${b.y} L${b.x - ux * head - uy * head * 0.5} ${b.y - uy * head + ux * head * 0.5} L${b.x - ux * head + uy * head * 0.5} ${b.y - uy * head - ux * head * 0.5}Z`, fill: color });
}

/** Splits text into lines of about `n` characters (at spaces). */
function wrap(t: string, _m: unknown, n: number): string[] {
  const out: string[] = [];
  let cur = '';
  for (const w of t.split(/\s+/)) { if (cur && (cur + ' ' + w).length > n * 1.6) { out.push(cur); cur = w; } else cur = cur ? `${cur} ${w}` : w; }
  if (cur) out.push(cur);
  return out;
}

/** The facing edge midpoints of two boxes (a leader's ends). */
function nearestEdges(a: Box, b: Box, gap: number): [{ x: number; y: number }, { x: number; y: number }] {
  const ca = { x: a.x + a.w / 2, y: a.y + a.h / 2 }, cb = { x: b.x + b.w / 2, y: b.y + b.h / 2 };
  const dx = cb.x - ca.x, dy = cb.y - ca.y;
  const horiz = Math.abs(dx) / (a.w + b.w) > Math.abs(dy) / (a.h + b.h);
  if (horiz) {
    const s = Math.sign(dx);
    return [{ x: s > 0 ? a.x + a.w + gap : a.x - gap, y: ca.y }, { x: s > 0 ? b.x - gap : b.x + b.w + gap, y: Math.max(b.y, Math.min(b.y + b.h, ca.y)) }];
  }
  const s = Math.sign(dy);
  return [{ x: Math.max(a.x, Math.min(a.x + a.w, cb.x)), y: s > 0 ? a.y + a.h + gap : a.y - gap }, { x: Math.max(b.x + b.w * 0.15, Math.min(b.x + b.w * 0.85, ca.x)), y: s > 0 ? b.y - gap : b.y + b.h + gap }];
}

// ------------------------------------------------------------------------------------------------
// Verbs on scene things: emph / fade a part (a chip), move by relation, set a label, value or strength.

/** Whether a ref action is the scene's. */
export function isSceneRef(a: RefAction, env: BuildEnv): boolean {
  const id = isBlockRef(a.ref) ? blockPart(a.ref)?.id : a.ref;
  const t = id ? sceneStore(env.registry).get(id) : undefined;
  if (!t || !t.data) return false;
  if (a.kind === 'move') return !!a.place;
  if (a.kind === 'set') return a.text != null || a.value != null || a.weight != null;
  return (a.kind === 'emph' || a.kind === 'fade') && isBlockRef(a.ref) && !!t.parts;
}

export async function buildSceneRef(a: RefAction, env: BuildEnv): Promise<ElementPlan | string> {
  const store = sceneStore(env.registry);
  const part = isBlockRef(a.ref) ? blockPart(a.ref) : null;
  const id = part ? part.id : a.ref;
  const t = store.get(id)!;
  const e = env.registry.get(id);
  const target = e?.target ?? null;
  if (!target) return `${id} is not drawn yet`;
  const ctx = await env.ctx(target);
  if (typeof ctx === 'string') return ctx;
  const accent = env.settings.inkColor;
  if (a.kind === 'emph' || a.kind === 'fade') {
    const chips = (t.data!.chips as SVGRectElement[] | undefined) ?? [];
    const box = t.parts![part!.c0];
    if (!box) return `${a.ref} is outside ${id}`;
    return {
      target, bbox: grow(box, 8),
      draw: async (_s, k) => {
        for (let i = part!.c0; i <= part!.c1; i++) {
          const ch = chips[i];
          if (!ch) continue;
          if (a.kind === 'fade') { await tween(300 * k.speed, (x) => ch.parentElement!.setAttribute('opacity', String(1 - 0.7 * x))); continue; }
          setAttrs(ch, { stroke: accent, 'stroke-width': 1.8, fill: accent, 'fill-opacity': 0.1 });
        }
      },
    };
  }
  if (a.kind === 'set') {
    return {
      target, bbox: grow(t.rect, 8),
      draw: async (_s, k) => {
        if (a.text != null && t.data!.kind === 'node') {
          const g = t.group; const tx = g?.querySelector('text');
          if (tx) { await tween(160 * k.speed, (x) => tx.setAttribute('opacity', String(1 - x))); tx.textContent = a.text; await tween(200 * k.speed, (x) => tx.setAttribute('opacity', String(x))); }
        }
        const link = t.data!.link as { strengths: ({ get(): number; norm(): number } | null)[]; paint(): void } | undefined;
        if (link && a.weight != null) {
          const next = await valueOf(a.weight, env);
          const old = link.strengths.map((s) => s);
          const from = old.map((s) => (s ? s.norm() : 0.5));
          await tween(600 * k.speed, (x) => {
            old.forEach((_, i) => { const v = from[i] + (next.norm() - from[i]) * x; link.strengths[i] = { get: () => (typeof a.weight === 'number' ? v : next.get()), norm: () => v }; });
            link.paint();
          });
          link.strengths.forEach((_, i) => { link.strengths[i] = next; });
          link.paint();
        }
      },
    };
  }
  if (a.kind === 'move' && a.place) {
    const anchor = await anchorBox(a.place.of, env.registry);
    if (!anchor) return `unknown ${a.place.of}`;
    const m = metrics(ctx.scale(), ctx.body?.() ?? 16);
    const others = ctx.scene ? ctx.scene.rects().filter((r) => r !== t.claim?.r) : [];
    const dest = placeRel(t.rect.w, t.rect.h, a.place.rel, anchor, others, { gap: m.gap * 1.25, seed: `${id}:move`, view: ctx.scene?.view() });
    const dx = dest.x - t.rect.x, dy = dest.y - t.rect.y;
    return {
      target, bbox: grow(union([t.rect, dest]), 8),
      draw: async (_s, k) => {
        const g = t.group;
        const base = { rect: { ...t.rect }, parts: t.parts?.map((p) => ({ ...p })) };
        await tween((prefersReducedMotion() ? 0 : 520) * k.speed, (x) => {
          g?.setAttribute('transform', `translate(${dx * x} ${dy * x})`);
          t.rect = { ...base.rect, x: base.rect.x + dx * x, y: base.rect.y + dy * x };
          if (base.parts) t.parts = base.parts.map((p) => ({ ...p, x: p.x + dx * x, y: p.y + dy * x }));
          t.moved?.forEach((f) => f());
        });
        t.claim?.move(t.rect);
        const shift = (b: Box) => ({ ...b, x: b.x + dx, y: b.y + dy });
        if (e) env.registry.update(id, { bbox: shift(e.bbox), boxes: e.boxes.map(shift) });
      },
    };
  }
  return 'not a scene verb';
}

export type { Thing, Pace, Route };
