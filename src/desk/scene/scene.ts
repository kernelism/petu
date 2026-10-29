// src/desk/scene/scene.ts
/**
 * Board v2 things (spec "Board v2: one connected scene"): nodes (labelled chips), flows (sequences of
 * chips), links (weighted, labelled relations routed around content), notes (text by relation, or
 * callouts with a routed leader line), groups (a loose outline around things: a system boundary),
 * pairs (a bracket joining two things) and merges (things gliding into one), plus the continuity
 * verbs on them (move by relation — kit blocks too —, split a chip, set a new label, value or
 * strength). Everything is placed by relation (place.ts) in the section's world and claims its room
 * there (labels and link corridors as minor claims, so later things and labels keep clear of them);
 * values come from the kit (a part's value), so they are never hand-written and they follow `set`.
 */
import type { DrawAction, RefAction, SceneShape, ValueRef } from '../../script/types';
import type { BuildEnv, ElementPlan, Pace, SceneClaim, SceneSpace, TargetCtx } from '../types';
import { blockPart, isBlockRef } from '../../script/pointExpr';
import { kitNumber, kitStore, metrics, setCaption, type Block, type Metrics } from '../kit/kit';
import { kitText, svg, setAttrs, textWidth } from '../kit/text';
import { tween, easeOut } from '../kit/anim';
import { token } from '../../ink/agent/tokens';
import { prefersReducedMotion } from '../../ink/agent/animate';
import { penDown, penLift, penTo } from '../../ink/agent/penCursor';
import { overlaps, placeRel, type Box } from './place';
import { routeLink, pathD, at, dirAt, samples, placeLabel, ribbon, type Route, type P } from './route';
import { lassoPath, bracketPath } from './shapes';
import { anchorBox, unclaimed, sceneStore, setSceneLink, type Thing } from './store';

type S = SceneShape & DrawAction;
type LinkSpec = Extract<SceneShape, { kind: 'link' }> & { em?: boolean };
const SVGNS = 'http://www.w3.org/2000/svg';
const hair = (w: number) => ({ 'stroke-width': w, 'vector-effect': 'non-scaling-stroke' });
const union = (rs: Box[]): Box => {
  const x = Math.min(...rs.map((r) => r.x)), y = Math.min(...rs.map((r) => r.y));
  return { x, y, w: Math.max(...rs.map((r) => r.x + r.w)) - x, h: Math.max(...rs.map((r) => r.y + r.h)) - y };
};
const grow = (b: Box, p: number): Box => ({ x: b.x - p, y: b.y - p, w: b.w + 2 * p, h: b.h + 2 * p });
const outline = (r: Box) => [{ x: r.x, y: r.y }, { x: r.x + r.w, y: r.y }, { x: r.x + r.w, y: r.y + r.h }, { x: r.x, y: r.y + r.h }, { x: r.x, y: r.y }];
const colors = () => ({ ink: token('--ink'), ink2: token('--ink-2'), cell: token('--kit-cell'), edge: token('--kit-edge'), muted: token('--kit-muted'), bar: token('--kit-bar'), paper: token('--board-paper') || '#fff' });
const contains = (o: Box, i: Box) => i.x >= o.x && i.y >= o.y && i.x + i.w <= o.x + o.w && i.y + i.h <= o.y + o.h;
const sameBox = (a: Box, b: Box) => Math.abs(a.x - b.x) < 0.5 && Math.abs(a.y - b.y) < 0.5 && Math.abs(a.w - b.w) < 0.5 && Math.abs(a.h - b.h) < 0.5;
const fadeIn = (el: Element, k: Pace, ms = 260) => tween(k.fadeMs != null || prefersReducedMotion() ? 0 : ms * k.speed, (t) => el.setAttribute('opacity', String(t)), undefined, easeOut);

let anon = 0;

type Shown = { get(): number; src?: string; norm(): number };
/** A shown value's text: the kit's number formatting, with its source block's dp= and fractions. */
const valueText = (v: Shown, env: BuildEnv) => kitNumber(v.get(), v.src ? kitStore(env.registry).get(v.src) : undefined);

/** The value a ValueRef shows now (a literal, or a kit block's part), and the block it follows. */
async function valueOf(v: ValueRef, env: BuildEnv): Promise<Shown> {
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

/** Chip geometry at this board's type size. */
function chipKit(m: Metrics) {
  const chipH = m.num * 2.1, padX = m.num * 0.85;
  return { chipH, padX, chipW: (t: string) => Math.max(chipH * 1.6, m.u(textWidth(t, m.numPx)) + 2 * padX) };
}

const range = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, i) => a + i);

/**
 * A chip takes a new label in place: the old words fade out, the chip glides to the new width about
 * its centre (in a row of chips no wider than the room between its neighbours: the words squeeze to
 * fit instead), its outline flashes the accent, and the new words fade in. Links on it re-route.
 */
async function relabel(t: Thing, i: number, text: string, chip: SVGRectElement, kit: { chipW: (s: string) => number; padX: number; gap: number }, accent: string, k: Pace, done: () => void): Promise<void> {
  const tx = chip.parentElement?.querySelector('text');
  if (!tx) return;
  const parts = t.parts ?? [t.rect], p = parts[i] ?? t.rect;
  let want = kit.chipW(text);
  // Neighbours in the same row bound the growth (a stacked flow grows freely sideways).
  const row = (q?: Box) => !!q && Math.abs(q.y - p.y) < p.h / 2;
  const cx = p.x + p.w / 2;
  let half = Infinity;
  if (row(parts[i - 1])) half = Math.min(half, cx - (parts[i - 1].x + parts[i - 1].w) - kit.gap);
  if (row(parts[i + 1])) half = Math.min(half, parts[i + 1].x - kit.gap - cx);
  const squeeze = want > 2 * half;
  if (squeeze) want = Math.max(p.w, 2 * half);
  const dw = want - p.w;
  const x0 = Number(chip.getAttribute('x')), w0 = Number(chip.getAttribute('width'));
  const stroke = chip.getAttribute('stroke'), sw = chip.getAttribute('stroke-width');
  const still = k.fadeMs != null || prefersReducedMotion();
  await tween(still ? 0 : 160 * k.speed, (x) => tx.setAttribute('opacity', String(1 - x)));
  tx.textContent = text;
  if (squeeze) setAttrs(tx, { textLength: want - 2 * kit.padX, lengthAdjust: 'spacingAndGlyphs' });
  else { tx.removeAttribute('textLength'); tx.removeAttribute('lengthAdjust'); }
  setAttrs(chip, { stroke: accent, 'stroke-width': 1.8 });
  const base = { ...p };
  await tween(still ? 0 : 260 * k.speed, (x) => {
    chip.setAttribute('x', String(x0 - (dw * x) / 2));
    chip.setAttribute('width', String(w0 + dw * x));
    tx.setAttribute('opacity', String(x));
    parts[i] = { ...base, x: base.x - (dw * x) / 2, w: base.w + dw * x };
    if (t.parts) t.parts = parts;
    t.moved?.forEach((f) => f());
  }, undefined, easeOut);
  tx.setAttribute('opacity', '1');
  const items = t.data!.text as string[] | undefined;
  if (items) items[i] = text;
  done();
  // The accent fades back to the chip's own outline once the new words are in.
  await new Promise((res) => setTimeout(res, still ? 0 : 500 * k.speed));
  setAttrs(chip, { stroke: stroke ?? '', 'stroke-width': sw ?? '' });
}

/** One chip (a rounded label), faded in by the caller. */
function drawChip(parent: Element, p: Box, text: string, em: boolean, accent: string, c: ReturnType<typeof colors>, m: Metrics): { sub: SVGGElement; rect: SVGRectElement } {
  const sub = svg(parent, 'g', { opacity: 0 });
  const rect = svg(sub, 'rect', { x: p.x, y: p.y, width: p.w, height: p.h, rx: p.h / 2, fill: em ? accent : c.cell, 'fill-opacity': em ? 0.1 : 1, stroke: em ? accent : c.edge, ...hair(em ? 1.6 : 1.1) });
  kitText(sub, p.x + p.w / 2, p.y + p.h / 2, text, { size: m.num, fill: c.ink });
  return { sub, rect };
}

/** Builds a scene thing into a plan. A string is a skip reason. */
export async function buildScene(a: S, ctx: TargetCtx, env: BuildEnv): Promise<ElementPlan | string> {
  // A callout or a bracket reads in any section: in a plain sketch it is placed inside the section,
  // clear of the ink already there. Chips, links and groups make a scene ({{scene}}).
  if (!ctx.scene && a.kind !== 'note' && a.kind !== 'pair') return `${a.kind} lives in a scene ({{scene}})`;
  const m = metrics(ctx.scale(), ctx.body?.() ?? 16);
  const store = sceneStore(env.registry);
  const id = a.id ?? `_s${++anon}`;
  if (a.id && (store.get(a.id) || env.registry.get(a.id))) return 'duplicate id';
  const c = colors(), accent = env.settings.inkColor;
  const scene = ctx.scene ?? flatSpace(ctx);
  const inside = ctx.scene ? undefined : scene.view();
  // A scene: its claims (script order) and the ink that holds none; a plain sketch: all its ink.
  const taken = () => [...scene.rects(), ...(ctx.scene ? unclaimed(env, ctx.target) : env.registry.obstacles(ctx.target))];
  // Things sit a link's length apart (room for an arrow and its word); text sits closer.
  const placeBox = async (w: number, h: number, place?: { rel: string; of: string }, gapK = 1.25) => {
    const anchor = place ? await anchorBox(place.of, env.registry) : null;
    if (place && !anchor) console.warn('[scene] unknown anchor, placed after the last thing:', place.of);
    return placeRel(w, h, (anchor ? place!.rel : null) as never, anchor, taken(), { gap: m.gap * gapK, seed: id, view: scene.view(), last: scene.last(), ...(inside ? { inside } : {}) });
  };
  const { chipH, chipW } = chipKit(m);

  if (a.kind === 'node' || a.kind === 'flow') {
    const items = a.kind === 'node' ? [a.text] : a.items;
    const vals = a.kind === 'node' ? (a.value != null ? [a.value] : null) : a.values ? items.map((_, i) => `${a.values}[${i + 1}]`) : null;
    const gap = a.kind === 'flow' && a.arrows ? m.gap * 1.25 : m.label * 0.9;
    const down = a.kind === 'flow' && a.down;
    const ws = items.map(chipW);
    const valH = vals ? m.label * 1.7 : 0;
    const W = down ? Math.max(...ws) : ws.reduce((s, w) => s + w, 0) + gap * (items.length - 1);
    const H = down ? items.length * (chipH + valH) + gap * (items.length - 1) : chipH + valH;
    const r = await placeBox(W, H, a.place, 2.1);
    const parts: Box[] = [];
    let x = r.x, y = r.y;
    for (const w of ws) {
      parts.push(down ? { x: r.x + (W - w) / 2, y, w, h: chipH } : { x, y: r.y, w, h: chipH });
      x += w + gap; y += chipH + valH + gap;
    }
    const claim = scene.claim(r);
    const thing = store.put(id, { rect: r, parts, claim, moved: new Set(), data: { kind: a.kind, text: items } });
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
          const { sub, rect } = drawChip(g, p, t, !!a.em, accent, c, m);
          chips.push(rect);
          if (vs) vtexts.push(kitText(sub, p.x + p.w / 2, p.y + p.h + m.label * 0.95, '', { size: m.label, fill: c.ink2 }));
          if (a.kind === 'flow' && a.arrows && i > 0) {
            const q = parts[i - 1];
            const from = down ? { x: q.x + q.w / 2, y: q.y + q.h + valH + m.u(3) } : { x: q.x + q.w + m.u(4), y: q.y + q.h / 2 };
            const to = down ? { x: p.x + p.w / 2, y: p.y - m.u(4) } : { x: p.x - m.u(5), y: p.y + p.h / 2 };
            arrowTo(sub, from, to, c.ink2, m.u(1.2), m.u(7));
          }
          void fadeIn(sub, k, 220);
        });
        thing.data!.chips = chips;
        // Values read as the kit shows them (its decimals, the source block's dp= and fractions).
        const paint = () => vs?.forEach((v, i) => { vtexts[i].textContent = valueText(v, env); });
        paint();
        vs?.forEach((v) => v.src && kitStore(env.registry).listen(v.src, paint));
        if (vs) Object.assign(thing.data!, { values: vs, vtexts, paint });
        await new Promise((res) => setTimeout(res, k.fadeMs != null ? 0 : Math.min(600, 120 * items.length) * k.speed));
      },
    };
  }

  if (a.kind === 'note') {
    const lines = wrap(a.text, 15);
    // value=: a live number after the words (a part's value, as the kit shows it); it follows set.
    const shown = a.value != null ? await valueOf(a.value, env) : null;
    if (shown && !Number.isFinite(shown.get())) return `unknown ${String(a.value)}`;
    const lineW = (l: string) => m.u(textWidth(l, m.labelPx));
    const valW = shown ? Math.max(lineW(valueText(shown, env)), lineW('100%')) + lineW(' ') : 0;
    const w = Math.max(...lines.map((l, i) => lineW(l) + (i === lines.length - 1 ? valW : 0))), h = lines.length * m.label * 1.35;
    const target = a.annotate ? await anchorBox(a.annotate, env.registry) : null;
    if (a.annotate && !target) return `unknown ${a.annotate}`;
    // A callout sits near what it annotates, where its leader crosses nothing (placeRel scores that).
    const r = await placeBox(w, h, a.annotate ? { rel: 'near', of: a.annotate } : a.place);
    const claim = scene.claim(r);
    // The leader: a gentle curve from the note to the part, around anything in between.
    const solid = [...scene.rects({ lines: false }), ...env.registry.obstacles(ctx.target, undefined, true)];
    const leader = target ? routeLink(r, target, clear(solid, r, target), m.u(4), m.u(3)) : null;
    const corridor = leader ? claimCorridor(scene, leader, m) : [];
    const note = store.put(id, { rect: r, claim, moved: new Set(), data: { kind: 'note', corridor } });
    const corridor0 = corridor.map((cl) => ({ ...cl.r }));
    return {
      target: ctx.target, bbox: grow(target ? union([r, target]) : r, m.u(6)),
      draw: async (_signal, k) => {
        const g = svg(ctx.layers.agent, 'g', { class: 'scene-thing', 'data-scene': 'note', opacity: 0 });
        store.get(id)!.group = g;
        let strokes = [outline(r)];
        if (leader) {
          svg(g, 'path', { d: pathD(leader), stroke: a.em ? accent : c.ink2, fill: 'none', ...hair(1) });
          const q = leader.b;
          svg(g, 'circle', { cx: q.x, cy: q.y, r: m.u(2.2), fill: a.em ? accent : c.ink2 });
          strokes = [samples(leader, 12)];
        }
        const ink = a.em ? accent : c.ink2;
        const write = (ls: string[], fill = ink) => ls.map((l, i) => kitText(g, r.x, r.y + m.label * (0.68 + i * 1.35), l, { size: m.label, fill, anchor: 'start' }));
        let tx = write(lines);
        let last = lines;
        const vt = shown ? kitText(g, 0, 0, valueText(shown, env), { size: m.label, fill: a.em ? accent : c.ink, anchor: 'start' }) : null;
        const placeValue = () => { if (vt) vt.parentNode?.appendChild(vt); if (vt) setAttrs(vt, { x: r.x + lineW(last[last.length - 1]) + lineW(' '), y: r.y + m.label * (0.68 + (last.length - 1) * 1.35) }); };
        placeValue();
        if (shown?.src && vt) kitStore(env.registry).listen(shown.src, () => { vt.textContent = valueText(shown, env); });
        // set id=n "…": the words cross-fade in place (the note keeps its corner; its room follows the new size).
        note.data!.relabel = async (next: string, k: Pace) => {
          const still = k.fadeMs != null || prefersReducedMotion();
          const old = tx;
          await tween(still ? 0 : 160 * k.speed, (x) => old.forEach((t) => t.setAttribute('opacity', String(1 - x))));
          old.forEach((t) => t.remove());
          const ls = wrap(next, 15);
          const nw = Math.max(...ls.map((l, i) => lineW(l) + (i === ls.length - 1 ? valW : 0))), nh = ls.length * m.label * 1.35;
          tx = write(ls, accent);
          last = ls;
          placeValue();
          tx.forEach((t) => t.setAttribute('opacity', '0'));
          note.rect = { x: note.rect.x, y: note.rect.y, w: nw, h: nh };
          claim.move(note.rect);
          if (a.id && env.registry.get(a.id)) env.registry.update(a.id, { bbox: note.rect, boxes: [note.rect] });
          await tween(still ? 0 : 240 * k.speed, (x) => tx.forEach((t) => t.setAttribute('opacity', String(x))), undefined, easeOut);
          await new Promise((res) => setTimeout(res, still ? 0 : 500 * k.speed));
          tx.forEach((t) => t.setAttribute('fill', ink));
        };
        env.registry.define({ id: a.id, kind: 'scene-note', target: ctx.target, bbox: r, boxes: [r], anchor: { x: r.x, y: r.y + h / 2 }, group: g, strokes });
        // A callout goes where its thing goes (it moves with it, leader and all).
        if (a.annotate && target) {
          const key = blockPart(a.annotate)?.id ?? a.annotate;
          store.get(key)?.moved?.add(() => void anchorBox(a.annotate!, env.registry, 0).then((nb) => {
            if (!nb) return;
            const dx = nb.x - target.x, dy = nb.y - target.y;
            g.setAttribute('transform', `translate(${dx} ${dy})`);
            note.rect = { ...r, x: r.x + dx, y: r.y + dy };
            claim.move(note.rect);
            corridor.forEach((cl, i) => cl.move({ ...corridor0[i], x: corridor0[i].x + dx, y: corridor0[i].y + dy }));
            note.moved?.forEach((f) => f());
          }));
        }
        await fadeIn(g, k);
      },
    };
  }

  if (a.kind === 'group') {
    const boxes = await Promise.all(a.of.map((x) => anchorBox(x, env.registry)));
    const miss = a.of.find((_, i) => !boxes[i]);
    if (miss) return `unknown ${miss}`;
    // Nested outlines never touch: one around a smaller group gets more air, one inside a bigger group less.
    const mine = new Set(a.of);
    let k0 = 1;
    for (const t of store.ofKind('group')) {
      const of = t.data!.of as string[];
      if (of.length < mine.size && of.every((x) => mine.has(x))) k0 = Math.max(k0, (t.data!.padK as number) + 0.75);
      else if (mine.size < of.length && a.of.every((x) => of.includes(x))) k0 = Math.min(k0, (t.data!.padK as number) * 0.5);
    }
    const pad = m.gap * 0.7 * k0;
    // A line around things that sit apart would swallow whatever lies between them: the members
    // gather first, each gliding next to the ones already gathered (their links follow).
    const keys = a.of.map((x) => blockPart(x)?.id ?? x);
    const mem = keys.map((x) => store.get(x));
    const outside = store.ids().filter((x) => !keys.includes(x)).map((x) => store.get(x)!).filter((t) => t.claim && !['link', 'group', 'pair'].includes(String(t.data?.kind)));
    const swallows = (bs: Box[]) => { const pts = lassoPath(bs, pad, id).pts; return outside.some((t) => inPoly({ x: t.rect.x + t.rect.w / 2, y: t.rect.y + t.rect.h / 2 }, pts)); };
    const gather: { id: string; t: Thing; dest: Box }[] = [];
    if (mem.every((t, i) => t && !isBlockRef(a.of[i])) && swallows(boxes as Box[])) {
      const movers = new Set(mem.slice(1).map((t) => t!.claim?.r));
      const room = scene.rects().filter((r) => !movers.has(r));
      const got: Box[] = [boxes[0]!];
      mem.slice(1).forEach((t, i) => {
        const dest = placeRel(t!.rect.w, t!.rect.h, 'near', union(got), room, { gap: m.gap * 1.1, seed: `${id}:${i}`, view: scene.view() });
        got.push(dest); room.push(dest); t!.claim?.move(dest);
        gather.push({ id: keys[i + 1], t: t!, dest });
      });
      got.forEach((b, i) => { boxes[i] = b; });
    }
    let shape = lassoPath(boxes as Box[], pad, id);
    const text = a.text ?? '';
    const tw = text ? m.u(textWidth(text, m.labelPx)) : 0;
    const labelBox = () => ({ x: shape.label.x - m.u(4), y: shape.label.y - m.label * 1.55, w: tw + m.u(8), h: m.label * 1.3 });
    let claims: SceneClaim[] = [];
    const claimRing = () => { claims.forEach((cl) => cl.drop()); claims = [...shape.pts.filter((_, i) => i % 2 === 0).map((p) => scene.claim({ x: p.x - m.u(3), y: p.y - m.u(3), w: m.u(6), h: m.u(6) }, 'line')), ...(text ? [scene.claim(labelBox(), 'label')] : [])]; };
    claimRing();
    const thing = store.put(id, { rect: shape.bbox, moved: new Set(), data: { kind: 'group', of: a.of, padK: k0 } });
    return {
      target: ctx.target, bbox: grow(union([shape.bbox, labelBox()]), m.u(6)),
      draw: async (_signal, k) => {
        await Promise.all(gather.map((v) => glide(v.id, v.t, v.dest, env, k)));
        const g = svg(ctx.layers.agent, 'g', { class: 'scene-group', opacity: 0 });
        thing.group = g;
        const col = a.em ? accent : c.ink2;
        const path = svg(g, 'path', { d: shape.d, fill: col, 'fill-opacity': 0.03, stroke: col, 'stroke-opacity': 0.8, 'stroke-dasharray': `${m.u(7)} ${m.u(4.5)}`, 'stroke-linecap': 'round', ...hair(1.3) });
        const label = text ? kitText(g, shape.label.x, shape.label.y - m.label * 0.85, text, { size: m.label, fill: col, anchor: 'start', halo: c.paper, haloW: m.label * 0.35 }) : null;
        env.registry.define({ id: a.id, kind: 'scene-group', target: ctx.target, bbox: shape.bbox, boxes: text ? [labelBox()] : [], anchor: shape.label, group: g, strokes: [shape.pts] });
        // The outline follows its members when they move.
        const refit = async () => {
          const bs = await Promise.all(a.of.map((x) => anchorBox(x, env.registry, 0)));
          if (bs.some((b) => !b)) return;
          shape = lassoPath(bs as Box[], pad, id);
          path.setAttribute('d', shape.d);
          if (label) setAttrs(label, { x: shape.label.x, y: shape.label.y - m.label * 0.85 });
          thing.rect = shape.bbox;
          claimRing();
        };
        for (const x of a.of) store.get(blockPart(x)?.id ?? x)?.moved?.add(() => void refit());
        await fadeIn(g, k, 380);
      },
    };
  }

  if (a.kind === 'pair') {
    const A = await anchorBox(a.from, env.registry), B = await anchorBox(a.to, env.registry);
    if (!A) return `unknown ${a.from}`;
    if (!B) return `unknown ${a.to}`;
    const gap = m.gap * 0.8;
    const text = a.text ?? '';
    const tw = text ? m.u(textWidth(text, m.labelPx)) : 0, th = m.label * 1.3;
    const make = (x: Box, y: Box) => bracketPath(x, y, clear(taken(), x, y), gap, text ? { w: tw, h: th } : undefined);
    let br = make(A, B);
    const lbox = () => (br.side === 'right' ? { x: br.label.x, y: br.label.y - th / 2, w: tw, h: th }
      : br.side === 'left' ? { x: br.label.x - tw, y: br.label.y - th / 2, w: tw, h: th }
        : { x: br.label.x - tw / 2, y: br.label.y - th / 2, w: tw, h: th });
    let claims: SceneClaim[] = [];
    const claimAll = () => { claims.forEach((cl) => cl.drop()); claims = [scene.claim(br.rail, 'line'), ...(text ? [scene.claim(lbox(), 'label')] : [])]; };
    claimAll();
    const thing = store.put(id, { rect: text ? union([br.rail, lbox()]) : br.rail, moved: new Set(), data: { kind: 'pair' } });
    return {
      target: ctx.target, bbox: grow(text ? union([br.rail, lbox()]) : br.rail, m.u(8)),
      draw: async (_signal, k) => {
        const g = svg(ctx.layers.agent, 'g', { class: 'scene-pair', opacity: 0 });
        thing.group = g;
        const col = a.em ? accent : c.ink2;
        const d = () => `M${br.pts.map((p) => `${p.x.toFixed(2)} ${p.y.toFixed(2)}`).join(' L')}`;
        const path = svg(g, 'path', { d: d(), fill: 'none', stroke: col, 'stroke-linejoin': 'round', 'stroke-linecap': 'round', ...hair(1.3) });
        const anchorFor = () => (br.side === 'right' ? 'start' : br.side === 'left' ? 'end' : 'middle') as 'start' | 'end' | 'middle';
        const label = text ? kitText(g, br.label.x, br.label.y, text, { size: m.label, fill: col, anchor: anchorFor(), halo: c.paper, haloW: m.label * 0.35 }) : null;
        env.registry.define({ id: a.id, kind: 'scene-pair', target: ctx.target, bbox: thing.rect, boxes: text ? [lbox()] : [], anchor: br.label, group: g, strokes: [br.pts] });
        const refit = async () => {
          const x = await anchorBox(a.from, env.registry, 0), y = await anchorBox(a.to, env.registry, 0);
          if (!x || !y) return;
          br = make(x, y);
          path.setAttribute('d', d());
          if (label) setAttrs(label, { x: br.label.x, y: br.label.y, 'text-anchor': anchorFor() });
          thing.rect = text ? union([br.rail, lbox()]) : br.rail;
          claimAll();
        };
        for (const x of [a.from, a.to]) store.get(blockPart(x)?.id ?? x)?.moved?.add(() => void refit());
        await fadeIn(g, k, 300);
      },
    };
  }

  if (a.kind === 'merge') {
    const members = a.of.map((x) => ({ x, t: store.get(x) }));
    const miss = members.find((e) => !e.t);
    if (miss) return `unknown ${miss.x}`;
    const boxes = members.map((e) => e.t!.rect);
    const u = union(boxes);
    const w = chipW(a.text), h = chipH;
    // The members give up their room; the new chip lands where they meet (or by relation, if asked).
    members.forEach((e) => e.t!.claim?.drop());
    let r: Box = { x: u.x + u.w / 2 - w / 2, y: u.y + u.h / 2 - h / 2, w, h };
    if (a.place) r = await placeBox(w, h, a.place, 2.1);
    else if (taken().some((t) => overlaps(r, t, m.u(4)))) r = placeRel(w, h, 'near', r, taken(), { gap: m.gap, seed: id, view: scene.view() });
    const claim = scene.claim(r);
    const hooks = new Set<() => void>();
    members.forEach((e) => e.t!.moved?.forEach((f) => hooks.add(f)));
    const thing = store.put(id, { rect: r, parts: [r], claim, moved: hooks, data: { kind: 'node', text: [a.text] } });
    return {
      target: ctx.target, bbox: grow(union([u, r]), m.u(8)),
      draw: async (_signal, k) => {
        const g = svg(ctx.layers.agent, 'g', { class: 'scene-thing', 'data-scene': 'merge' });
        thing.group = g;
        const cx = r.x + r.w / 2, cy = r.y + r.h / 2;
        const moves = members.map((e) => {
          const b = e.t!.rect, gg = e.t!.group, off = (e.t!.data?.off as P | undefined) ?? { x: 0, y: 0 };
          return { gg, off, dx: cx - (b.x + b.w / 2), dy: cy - (b.y + b.h / 2) };
        });
        // They glide together and fade as the new chip appears where they meet.
        const ms = k.fadeMs != null || prefersReducedMotion() ? 0 : 560 * k.speed;
        await tween(ms, (t) => moves.forEach((v) => { v.gg?.setAttribute('transform', `translate(${v.off.x + v.dx * t} ${v.off.y + v.dy * t})`); v.gg?.setAttribute('opacity', String(1 - t)); }), undefined, easeOut);
        const { sub, rect } = drawChip(g, r, a.text, !!a.em, accent, c, m);
        thing.data!.chips = [rect];
        env.registry.define({ id: a.id, kind: 'scene-node', target: ctx.target, bbox: r, boxes: [r], anchor: { x: r.x + r.w, y: r.y }, group: g, strokes: [outline(r)] });
        // References to the members now mean the merged thing; their links re-route to it.
        for (const e of members) {
          store.alias(e.x, id);
          if (env.registry.get(e.x)) env.registry.update(e.x, { bbox: r, boxes: [] });
        }
        thing.moved!.forEach((f) => f());
        await fadeIn(sub, k, 240);
      },
    };
  }

  // link
  return planLink(a as LinkSpec, ctx, env, id, a.id);
}

/** A plain sketch's stand-in for a scene's world: its fixed frame, claims for this one thing only (earlier ink is in the registry). */
function flatSpace(ctx: TargetCtx): SceneSpace {
  const claims: SceneClaim[] = [];
  return {
    claim: (r, minor) => { const c: SceneClaim = { r: { ...r }, move: (n) => { c.r = { ...n }; }, drop: () => { const i = claims.indexOf(c); if (i >= 0) claims.splice(i, 1); }, ...(minor ? { minor } : {}) }; claims.push(c); return c; },
    rects: (o) => (o?.lines === false ? claims.filter((c) => c.minor !== 'line') : claims).map((c) => c.r),
    view: () => ({ x: 0, y: 0, w: 1000, h: ctx.h }),
    last: () => null,
    extent: () => null,
  };
}

/** Whether p lies inside the polygon (even-odd). */
function inPoly(p: P, poly: P[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/** Everything in `taken` except the two ends' own boxes (and what contains them, or sits inside them). */
function clear(taken: Box[], x: Box, y: Box): Box[] {
  return taken.filter((b) => !contains(grow(x, 1), b) && !contains(grow(y, 1), b) && !contains(b, x) && !contains(b, y));
}

/** Claims a few small boxes along a route (minor): later things and labels keep off the line. */
function claimCorridor(scene: NonNullable<TargetCtx['scene']>, q: Route, m: Metrics): SceneClaim[] {
  const s = m.u(5);
  return samples(q, 8).slice(1, -1).map((p) => scene.claim({ x: p.x - s / 2, y: p.y - s / 2, w: s, h: s }, 'line'));
}

/** The part of a route up to t (de Casteljau). */
const partial = (q: Route, t: number): Route => ({ a: q.a, c: { x: q.a.x + (q.c.x - q.a.x) * t, y: q.a.y + (q.c.y - q.a.y) * t }, b: at(q, t) });

type LinkState = { routes: Route[]; strengths: ({ get(): number; norm(): number; src?: string } | null)[]; paint(tr?: number): void; from: string; targets: string[]; relabel(text: string, k: Pace): Promise<void> };

/** A link (or a fan of links from one thing to every part of a flow) as a plan. */
async function planLink(L: LinkSpec, ctx: TargetCtx, env: BuildEnv, id: string, aid?: string): Promise<ElementPlan | string> {
  const scene = ctx.scene!;
  const m = metrics(ctx.scale(), ctx.body?.() ?? 16);
  const store = sceneStore(env.registry);
  const c = colors(), accent = env.settings.inkColor;
  // The registry id this link draws as (set once drawn): its own old route is never in its way.
  let rid: string | undefined;
  const taken = () => [...scene.rects(), ...unclaimed(env, ctx.target, rid)];
  const from = await anchorBox(L.from, env.registry), to = await anchorBox(L.to, env.registry);
  if (!from) return `unknown ${L.from}`;
  if (!to) return `unknown ${L.to}`;
  // One to many: `to` is a flow (every chip) and the strength a whole block (one value per chip).
  const toThing = !isBlockRef(L.to) ? store.get(L.to) : undefined;
  const fan = !!toThing?.parts && toThing.parts.length > 1 && typeof L.strength === 'string' && !isBlockRef(L.strength);
  const targets = fan ? toThing!.parts!.map((_, i) => `${L.to}[${i + 1}]`) : [L.to];
  const strengths = await Promise.all(targets.map((_, i) => (L.strength == null ? null : valueOf(fan ? `${L.strength}[${i + 1}]` : L.strength, env))));
  const fromKey = L.from, ends = await Promise.all(targets.map((t) => anchorBox(t, env.registry)));
  // Other links' paths: this one keeps off them where it can.
  const others = () => store.ofKind('link').flatMap((t) => ((t.data!.link as LinkState | undefined)?.routes ?? []).map((q) => samples(q, 16)));
  const solid = () => [...scene.rects({ lines: false }), ...unclaimed(env, ctx.target, rid, true)];
  const route = (f: Box, e: Box) => routeLink(f, e, clear(solid(), f, e), m.u(4), m.u(3), others());
  const routes = ends.map((e) => route(from, e!));
  let corridor = routes.flatMap((q) => claimCorridor(scene, q, m));
  // The label: measured now (a weight readout at its widest), placed clear of things, labels and lines.
  const lw = (s: string) => m.u(textWidth(s, m.labelPx));
  const txt0 = [L.text, L.showWeight ? '100%' : ''].filter(Boolean).join(' ');
  const lh = m.label * 1.25;
  let lbox: Box | null = txt0 ? placeLabel(routes[0], lw(txt0), lh, taken(), m.u(5)) : null;
  // No clear spot beside a short straight link (close neighbours): it arcs over the row instead, its label on top.
  if (lbox && !fan && solid().some((r) => overlaps(lbox!, r))) {
    routes[0] = routeLink(from, ends[0]!, clear(solid(), from, ends[0]!), m.u(4), m.u(3), others(), true);
    corridor.forEach((cl) => cl.drop());
    corridor = routes.flatMap((q) => claimCorridor(scene, q, m));
    lbox = placeLabel(routes[0], lbox.w, lbox.h, taken(), m.u(5));
  }
  let lclaim = lbox ? scene.claim(lbox, 'label') : null;
  const bbox = grow(union([...routes.flatMap((q) => samples(q, 8)).map((p) => ({ x: p.x, y: p.y, w: 0, h: 0 })), ...(lbox ? [lbox] : [])]), m.u(10));
  return {
    target: ctx.target, bbox,
    draw: async (_signal, k) => {
      const g = svg(ctx.layers.agent, 'g', { class: 'scene-link' });
      const els = routes.map(() => ({ path: svg(g, 'path', { 'stroke-linecap': 'round' }), head: L.plain ? null : svg(g, 'path', { stroke: 'none' }) }));
      const labelCol = L.em ? accent : c.ink2;
      const newLabel = () => kitText(g, 0, 0, '', { size: m.label, fill: labelCol, halo: c.paper, haloW: m.label * 0.35 });
      let label = txt0 ? newLabel() : null;
      let text = L.text;
      const said = () => [text, L.showWeight && strengths[0] ? fmtW(strengths[0]!, env) : ''].filter(Boolean).join(' ');
      const paint = (tr = 1) => {
        routes.forEach((q, i) => {
          const s = strengths[i]?.norm();
          const w = s == null || !Number.isFinite(s) ? 0.5 : Math.max(0, Math.min(1, s));
          const col = L.em ? accent : s == null ? c.ink2 : c.ink;
          // Weighted: a ribbon, capped and tapering toward its source, its head sized with it. Else a hairline.
          const px = s == null ? 1.3 : 1.1 + 2.6 * w;
          const hl = m.u(5.5 + px * 1.1), hw = m.u(3 + px * 0.75);
          const hidden = sameBox(...endsNow(i));
          if (s == null) setAttrs(els[i].path, { d: pathD(partial(q, tr)), fill: 'none', stroke: col, 'stroke-opacity': 0.8, ...hair(px), ...(L.dash ? { 'stroke-dasharray': `${m.u(5)} ${m.u(4)}` } : {}) });
          else setAttrs(els[i].path, { d: ribbon(q, m.u(px * 0.35), m.u(px), L.plain ? 0 : hl * 0.6, tr), fill: col, 'fill-opacity': 0.3 + 0.65 * w, stroke: 'none' });
          els[i].path.setAttribute('opacity', hidden ? '0' : '1');
          if (els[i].head) {
            const tip = at(q, 1), d = dirAt(q, 1), n = Math.hypot(d.x, d.y) || 1, ux = d.x / n, uy = d.y / n;
            setAttrs(els[i].head!, { d: `M${tip.x} ${tip.y} L${tip.x - ux * hl - uy * hw} ${tip.y - uy * hl + ux * hw} L${tip.x - ux * hl + uy * hw} ${tip.y - uy * hl - ux * hw}Z`, fill: col, 'fill-opacity': s == null ? 0.8 : 0.3 + 0.65 * w, opacity: tr >= 1 && !hidden ? 1 : 0 });
          }
        });
        if (label && lbox) {
          label.textContent = said();
          setAttrs(label, { x: lbox.x + lbox.w / 2, y: lbox.y + lbox.h / 2, opacity: tr >= 1 && !sameBox(...endsNow(0)) ? 1 : 0 });
        }
      };
      const now = { f: from, e: ends as Box[] };
      const endsNow = (i: number): [Box, Box] => [now.f, now.e[i]];
      // Traced from its start, like a hand drawing it.
      if (k.fadeMs == null && !prefersReducedMotion()) {
        const pen = {};
        penDown(pen);
        try { await tween(Math.min(700, 300 + routes.length * 60) * k.speed, (t) => { paint(t); penTo(pen, g, at(routes[0], t), L.em ? accent : c.ink); }); } finally { penLift(pen); }
      }
      paint(1);
      const boxes = () => routes.flatMap((q) => samples(q, 10).map((p) => ({ x: p.x - m.u(3), y: p.y - m.u(3), w: m.u(6), h: m.u(6) })));
      rid = env.registry.define({ id: aid, kind: 'scene-link', target: ctx.target, bbox, boxes: [...boxes(), ...(lbox ? [lbox] : [])], anchor: at(routes[0], 1), group: g, strokes: routes.map((q) => samples(q, 16)) });
      /**
       * A new label (set id=l "…"): once drawn is drawn, so the old words fade out where they are, the
       * new ones are measured and placed again (clear of things, labels and the curve) and fade in with
       * an accent flash that settles back to the link's own colour.
       */
      const relabel = async (next: string, k: Pace) => {
        const still = k.fadeMs != null || prefersReducedMotion();
        const old = label;
        if (old) await tween(still ? 0 : 160 * k.speed, (x) => old.setAttribute('opacity', String(1 - x)));
        text = next;
        lclaim?.drop();
        const w = lw([next, L.showWeight ? '100%' : ''].filter(Boolean).join(' '));
        const room = () => [...scene.rects(), ...unclaimed(env, ctx.target, rid)];
        const hit = (b: Box) => solid().reduce((s, r) => s + (overlaps(b, r) ? 1 : 0), 0);
        lbox = placeLabel(routes[0], w, lh, room(), m.u(5));
        // Longer words with no clear spot beside a short straight link: the link bends up into an arc
        // (a visible glide, as when it was first drawn with such a label) and the words sit over it.
        if (!fan && hit(lbox)) {
          const f = now.f, e = now.e[0];
          const arc = routeLink(f, e, clear(solid(), f, e), m.u(4), m.u(3), others(), true);
          const ab = placeLabel(arc, w, lh, room(), m.u(5));
          if (hit(ab) < hit(lbox)) {
            const q0 = routes[0], mix = (p: P, q: P, x: number) => ({ x: p.x + (q.x - p.x) * x, y: p.y + (q.y - p.y) * x });
            await tween(still ? 0 : 320 * k.speed, (x) => { routes[0] = { a: mix(q0.a, arc.a, x), c: mix(q0.c, arc.c, x), b: mix(q0.b, arc.b, x) }; paint(); if (label) label.setAttribute('opacity', '0'); }, undefined, easeOut);
            routes[0] = arc;
            corridor.forEach((cl) => cl.drop());
            corridor = routes.flatMap((q) => claimCorridor(scene, q, m));
            lbox = ab;
          }
        }
        lclaim = scene.claim(lbox, 'label');
        if (!label) label = newLabel();
        const el = label;
        el.textContent = said();
        setAttrs(el, { x: lbox.x + lbox.w / 2, y: lbox.y + lbox.h / 2, opacity: 0, fill: accent });
        if (rid && env.registry.get(rid)) env.registry.update(rid, { boxes: [...boxes(), lbox], strokes: routes.map((q) => samples(q, 16)) });
        await tween(still ? 0 : 240 * k.speed, (x) => el.setAttribute('opacity', String(x)), undefined, easeOut);
        el.setAttribute('opacity', '1');
        await new Promise((res) => setTimeout(res, still ? 0 : 500 * k.speed));
        el.setAttribute('fill', labelCol);
      };
      const link: LinkState = { routes, strengths, paint, from: fromKey, targets, relabel };
      store.put(id, { rect: bbox, data: { kind: 'link', link } });
      // Re-weight when the values move (set), re-route when an end moves (move, split, merge).
      strengths.forEach((s) => s?.src && kitStore(env.registry).listen(s.src, () => paint()));
      // Re-routes go through the scene's queue (store.reroute): never two at once, in creation order.
      const order = store.nextOrder();
      const release = () => { corridor.forEach((cl) => cl.drop()); corridor = []; lclaim?.drop(); lclaim = null; };
      const run = async () => {
        const f = await anchorBox(fromKey, env.registry, 0);
        if (f) now.f = f;
        for (let i = 0; i < targets.length; i++) { const e = await anchorBox(targets[i], env.registry, 0); if (e) now.e[i] = e; }
        if (f) for (let i = 0; i < targets.length; i++) routes[i] = route(now.f, now.e[i]);
        corridor = routes.flatMap((q) => claimCorridor(scene, q, m));
        if (lbox) { lbox = placeLabel(routes[0], lbox.w, lbox.h, taken(), m.u(5)); lclaim = scene.claim(lbox, 'label'); }
        if (rid && env.registry.get(rid)) env.registry.update(rid, { boxes: [...boxes(), ...(lbox ? [lbox] : [])], strokes: routes.map((q) => samples(q, 16)) });
        paint();
      };
      for (const key of [fromKey, ...targets]) store.get(blockPart(key)?.id ?? key)?.moved?.add(() => void store.reroute({ order, release, run }));
    },
  };
}

// kit.ts draws a computed block's relation to its source through this (no import cycle).
setSceneLink(async (from, to, label, ctx, env, pace) => {
  if (!ctx.scene) return;
  const plan = await planLink({ kind: 'link', from, to, ...(label ? { text: label } : {}) }, ctx, env, `_s${++anon}`);
  if (typeof plan !== 'string') await plan.draw(new AbortController().signal, pace);
});

/** A link's shown weight: a 0–1 strength as a percentage, anything else as the kit shows it. */
const fmtW = (s: Shown, env: BuildEnv) => { const v = s.get(); return v <= 1 && v >= 0 ? `${Math.round(v * 100)}%` : valueText(s, env); };

function arrowTo(g: SVGGElement, a: P, b: P, color: string, w: number, head: number) {
  const dx = b.x - a.x, dy = b.y - a.y, n = Math.hypot(dx, dy) || 1, ux = dx / n, uy = dy / n;
  svg(g, 'path', { d: `M${a.x} ${a.y} L${b.x - ux * head * 0.6} ${b.y - uy * head * 0.6}`, stroke: color, 'stroke-width': w, fill: 'none', 'stroke-linecap': 'round' });
  svg(g, 'path', { d: `M${b.x} ${b.y} L${b.x - ux * head - uy * head * 0.5} ${b.y - uy * head + ux * head * 0.5} L${b.x - ux * head + uy * head * 0.5} ${b.y - uy * head - ux * head * 0.5}Z`, fill: color });
}

/** Splits text into lines of about `n` characters (at spaces). */
function wrap(t: string, n: number): string[] {
  const out: string[] = [];
  let cur = '';
  for (const w of t.split(/\s+/)) { if (cur && (cur + ' ' + w).length > n * 1.6) { out.push(cur); cur = w; } else cur = cur ? `${cur} ${w}` : w; }
  if (cur) out.push(cur);
  return out;
}

// ------------------------------------------------------------------------------------------------
// Verbs on scene things: emph / fade a part (a chip), move by relation (kit blocks too), split a chip,
// set a label, value or strength.

/** A link's strength tweens to a new value (a literal, or a part it follows from now on). */
async function reweight(link: LinkState, weight: ValueRef, env: BuildEnv, k: Pace): Promise<void> {
  const next = await valueOf(weight, env);
  const from = link.strengths.map((s) => (s ? s.norm() : 0.5));
  await tween(600 * k.speed, (x) => {
    from.forEach((f, i) => { const v = f + (next.norm() - f) * x; link.strengths[i] = { get: () => (typeof weight === 'number' ? v : next.get()), norm: () => v }; });
    link.paint();
  });
  link.strengths.forEach((_, i) => { link.strengths[i] = next; });
  link.paint();
}

/** Whether a ref action is the scene's. */
export function isSceneRef(a: RefAction, env: BuildEnv): boolean {
  const id = isBlockRef(a.ref) ? blockPart(a.ref)?.id : a.ref;
  const t = id ? sceneStore(env.registry).get(id) : undefined;
  if (a.kind === 'split') return true;
  if (!t || !t.data) return false;
  if (a.kind === 'move') return !!a.place;
  if (a.kind === 'set') return a.text != null || a.value != null || a.weight != null;
  return (a.kind === 'emph' || a.kind === 'fade') && isBlockRef(a.ref) && !!t.parts;
}

export async function buildSceneRef(a: RefAction, env: BuildEnv): Promise<ElementPlan | string> {
  const store = sceneStore(env.registry);
  const part = isBlockRef(a.ref) ? blockPart(a.ref) : null;
  const id = part ? part.id : a.ref;
  const t = store.get(id);
  if (!t) return `unknown ${id}`;
  const e = env.registry.get(id);
  const target = e?.target ?? null;
  if (!target) return `${id} is not drawn yet`;
  const ctx = await env.ctx(target);
  if (typeof ctx === 'string') return ctx;
  const accent = env.settings.inkColor;
  const m = metrics(ctx.scale(), ctx.body?.() ?? 16);
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
    // The chips it names: a node's (or a merged chip's) one chip, or a flow's parts f[2] / f[1:3].
    const chips = (t.data!.chips as SVGRectElement[] | undefined) ?? [];
    const kind = t.data!.kind;
    // A kit block placed in the scene: its caption is its label.
    if (kind === 'kit') return a.text != null && a.value == null && a.weight == null ? setCaption(id, a.text, env) : `${id} is a kit block: set its values with vals= or fn=`;
    const link = t.data!.link as LinkState | undefined;
    if (link || kind === 'note') {
      if (part) return `${a.ref}: a ${kind} has no parts`;
      if (a.value != null) return `${id} is a ${kind}: it has no value to set`;
      if (kind === 'note' && a.text == null) return `${id} is a note: set its "words"`;
      const r = t.rect;
      return {
        target, bbox: grow(r, m.u(10)),
        draw: async (_s, k) => {
          if (a.text != null) await (link ? link.relabel(a.text, k) : (t.data!.relabel as (s: string, k: Pace) => Promise<void>)(a.text, k));
          if (link && a.weight != null) await reweight(link, a.weight, env, k);
        },
      };
    }
    const idx = part ? range(part.c0, part.c1) : kind === 'node' ? [0] : [];
    if ((a.text != null || a.value != null) && !chips.length) return `${id} has no label to set`;
    if ((a.text != null || a.value != null) && !idx.length) return `set a label on a part of ${id}, as ${id}[2]`;
    if (idx.some((i) => !chips[i])) return `${a.ref} is outside ${id}`;
    const { chipW, padX } = chipKit(m);
    const boxes = idx.map((i) => t.parts?.[i] ?? t.rect);
    return {
      target, bbox: grow(boxes.length ? union(boxes) : t.rect, 8),
      draw: async (_s, k) => {
        if (a.text != null) {
          // The thing's room grows with a wider chip (its value line below stays inside it).
          const settle = () => {
            const r = union([t.rect, ...(t.parts ?? [])]);
            t.rect = r;
            t.claim?.move(r);
            if (env.registry.get(id)) env.registry.update(id, { bbox: r, boxes: [r] });
            t.moved?.forEach((f) => f());
          };
          await Promise.all(idx.map((i) => relabel(t, i, a.text!, chips[i], { chipW, padX, gap: m.u(4) }, accent, k, settle)));
        }
        // A chip's value: the new one (a literal or a part it follows from now on), as the kit shows it.
        const shown = t.data!.values as Shown[] | undefined, vts = t.data!.vtexts as SVGTextElement[] | undefined;
        if (a.value != null && shown && vts) {
          const next = await valueOf(a.value, env);
          const vt = idx.map((i) => vts[i]).filter(Boolean);
          await tween(160 * k.speed, (x) => vt.forEach((v) => v.setAttribute('opacity', String(1 - x))));
          idx.forEach((i) => { if (i < shown.length) shown[i] = next; });
          (t.data!.paint as () => void)();
          if (next.src) kitStore(env.registry).listen(next.src, t.data!.paint as () => void);
          await tween(200 * k.speed, (x) => vt.forEach((v) => v.setAttribute('opacity', String(x))));
        }
      },
    };
  }
  if (a.kind === 'split') {
    if (t.data?.kind !== 'node') return `split needs a chip (${id} is not one)`;
    const { chipH, chipW } = chipKit(m);
    const ws = a.items.map(chipW), gap = m.label * 0.9;
    const W = ws.reduce((s, w) => s + w, 0) + gap * (ws.length - 1);
    const cx = t.rect.x + t.rect.w / 2, cy = t.rect.y + t.rect.h / 2;
    let r: Box = { x: cx - W / 2, y: cy - chipH / 2, w: W, h: chipH };
    const others = ctx.scene ? ctx.scene.rects().filter((x) => x !== t.claim?.r) : [];
    if (others.some((o) => overlaps(r, o, m.u(4)))) r = placeRel(W, chipH, 'near', t.rect, others, { gap: m.gap, seed: `${id}:split`, view: ctx.scene?.view() });
    const parts: Box[] = [];
    ws.reduce((x, w) => { parts.push({ x, y: r.y, w, h: chipH }); return x + w + gap; }, r.x);
    return {
      target, bbox: grow(union([t.rect, r]), m.u(8)),
      draw: async (_s, k) => {
        const c = colors();
        const old = t.group;
        const g = svg(ctx.layers.agent, 'g', { class: 'scene-thing', 'data-scene': 'flow' });
        const chips: SVGRectElement[] = [];
        const subs = parts.map((p, i) => { const d = drawChip(g, p, a.items[i], false, accent, c, m); chips.push(d.rect); return { ...d, dx: cx - (p.x + p.w / 2) }; });
        // The chip comes apart: its pieces slide out from where it was as it fades.
        const ms = k.fadeMs != null || prefersReducedMotion() ? 0 : 520 * k.speed;
        await tween(ms, (x) => {
          old?.setAttribute('opacity', String(1 - x));
          subs.forEach((s) => { s.sub.setAttribute('opacity', String(x)); s.sub.setAttribute('transform', `translate(${s.dx * (1 - x)} 0)`); });
        }, undefined, easeOut);
        old?.setAttribute('opacity', '0');
        subs.forEach((s) => { s.sub.setAttribute('opacity', '1'); s.sub.removeAttribute('transform'); });
        Object.assign(t, { rect: r, parts, group: g });
        t.data = { ...t.data, kind: 'flow', chips, text: a.items, off: { x: 0, y: 0 } };
        t.claim?.move(r);
        env.registry.update(id, { bbox: r, boxes: [r], group: g });
        t.moved?.forEach((f) => f());
      },
    };
  }
  if (a.kind === 'move' && a.place) {
    const anchor = await anchorBox(a.place.of, env.registry);
    if (!anchor) return `unknown ${a.place.of}`;
    const others = ctx.scene ? ctx.scene.rects().filter((r) => r !== t.claim?.r) : [];
    const dest = placeRel(t.rect.w, t.rect.h, a.place.rel, anchor, others, { gap: m.gap * (t.data?.kind === 'kit' ? 1.3 : 2.1), seed: `${id}:move`, view: ctx.scene?.view() });
    const from = { ...t.rect };
    // The room moves at once (things placed meanwhile keep clear of where it is going).
    t.claim?.move(dest);
    return {
      target, bbox: grow(union([from, dest]), 8),
      draw: (_s, k) => glide(id, t, dest, env, k),
    };
  }
  return 'not a scene verb';
}

/**
 * Glides a scene thing (or a kit block) to `dest`; links, outlines and callouts on it follow every
 * frame (its `moved` hooks). A kit block draws in its own space: it moves inside a wrapper, and its
 * world shift is kept for links and connectors.
 */
async function glide(id: string, t: Thing, dest: Box, env: BuildEnv, k: Pace): Promise<void> {
  const dx = dest.x - t.rect.x, dy = dest.y - t.rect.y;
  if (Math.abs(dx) < 0.01 && Math.abs(dy) < 0.01) return;
  const kit = t.data?.kind === 'kit' ? kitStore(env.registry).get(id) : undefined;
  const e = env.registry.get(id);
  const g = kit ? mover(kit) : t.group;
  const off = (t.data!.off as P | undefined) ?? { x: 0, y: 0 };
  const base = { rect: { ...t.rect }, parts: t.parts?.map((p) => ({ ...p })) };
  await tween((k.fadeMs != null || prefersReducedMotion() ? 0 : 560) * k.speed, (x) => {
    g?.setAttribute('transform', `translate(${off.x + dx * x} ${off.y + dy * x})`);
    t.rect = { ...base.rect, x: base.rect.x + dx * x, y: base.rect.y + dy * x };
    if (base.parts) t.parts = base.parts.map((p) => ({ ...p, x: p.x + dx * x, y: p.y + dy * x }));
    if (kit) kit.shift = { x: off.x + dx * x, y: off.y + dy * x };
    t.moved?.forEach((f) => f());
  }, undefined, easeOut);
  t.data!.off = { x: off.x + dx, y: off.y + dy };
  t.claim?.move(t.rect);
  const shift = (b: Box) => ({ ...b, x: b.x + dx, y: b.y + dy });
  if (e) env.registry.update(id, { bbox: shift(e.bbox), boxes: e.boxes.map(shift) });
}

/** A kit block's wrapper group (made on its first move), so its own drawing stays in its own space. */
function mover(b: Block): SVGGElement | null {
  const g = b.g;
  if (!g || !g.parentNode) return null;
  const p = g.parentNode as SVGGElement;
  if (p.getAttribute('data-mover') === b.id) return p;
  const w = document.createElementNS(SVGNS, 'g') as SVGGElement;
  w.setAttribute('data-mover', b.id);
  p.insertBefore(w, g);
  w.appendChild(g);
  return w;
}

export type { Thing, Pace, Route };
