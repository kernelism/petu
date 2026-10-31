// src/svgboard/polish.ts — text that fits and stays clear, before a group is checked or drawn.
/**
 * Pure over the parsed XML (the gate and the renderer run the same steps, so the gate checks what is
 * drawn):
 *  - fit: text under the board's minimum size is raised to it (founder rule) and its layout follows:
 *    tspan line steps grow with it; a line that no longer fits its card (a rect around it) wraps at
 *    words; texts stacked as a list are pushed down so lines never collide; the card grows to hold
 *    them. Nothing is ever shrunk below the minimum.
 *  - clear: a label crossed by a stroke of its own group is nudged off it (≤ 1.25 em, the smallest
 *    clear offset, never onto other text); labels it cannot clear keep the paper halo.
 * Only texts and cards whose transforms are translations are moved (rotated text is left as written).
 */
import { core, groupGeometry, I, mul, overlapArea, parseTransform, segHitsBox, textEm, type Box, type M } from './check';
import { stripProse } from './prose';

const SVGNS = 'http://www.w3.org/2000/svg';
const num = (v: string | null | undefined, d = 0): number => { const n = v == null ? NaN : parseFloat(v); return Number.isFinite(n) ? n : d; };
const r2 = (v: number) => String(Math.round(v * 100) / 100);
const tag = (e: Element) => e.nodeName.toLowerCase().replace(/^svg:/, '');
function inherit(el: Element, a: string): string | null { for (let e: Element | null = el; e; e = e.parentElement) { const v = e.getAttribute(a); if (v != null) return v; } return null; }
const matOf = (el: Element, root: Element): M => { const chain: Element[] = []; for (let e: Element | null = el; e && e !== root.parentElement; e = e.parentElement) chain.unshift(e); return chain.reduce((m, e) => mul(m, parseTransform(e.getAttribute('transform'))), I); };
const isShift = (m: M) => Math.abs(m[0] - 1) < 1e-9 && Math.abs(m[3] - 1) < 1e-9 && Math.abs(m[1]) < 1e-9 && Math.abs(m[2]) < 1e-9;

type T = { el: Element; m: M; x: number; y: number; fs: number; fs0: number; anchor: string; lines: number; raised: boolean; card: Box | null; cardEl: Element | null };

/** Positioned lines of a text: its tspans that set y or dy (a new line). */
const lineSpans = (el: Element) => Array.from(el.children).filter((c) => tag(c) === 'tspan' && (c.hasAttribute('y') || c.hasAttribute('dy')));

/** Moves a text (and its absolutely placed tspans) by (dx, dy). */
function shift(el: Element, dx: number, dy: number): void {
  if (dx) { el.setAttribute('x', r2(num(el.getAttribute('x')) + dx)); for (const s of Array.from(el.children)) if (s.hasAttribute('x')) s.setAttribute('x', r2(num(s.getAttribute('x')) + dx)); }
  if (dy) { el.setAttribute('y', r2(num(el.getAttribute('y')) + dy)); for (const s of Array.from(el.children)) if (s.hasAttribute('y')) s.setAttribute('y', r2(num(s.getAttribute('y')) + dy)); }
}

const lineWidths = (el: Element, fs: number): number[] => {
  const spans = lineSpans(el);
  if (!spans.length) return [textEm((el.textContent ?? '').replace(/\s+/g, ' ').trim()) * fs];
  const head = Array.from(el.childNodes).filter((n) => n.nodeType === 3).map((n) => n.textContent ?? '').join('').trim();
  return [...(head ? [textEm(head) * fs] : []), ...spans.map((s) => textEm((s.textContent ?? '').trim()) * fs)];
};

function boxOf(t: T): Box {
  const ws = lineWidths(t.el, t.fs), w = Math.max(...ws);
  const x0 = t.anchor === 'middle' ? t.x - w / 2 : t.anchor === 'end' ? t.x - w : t.x;
  const base = inherit(t.el, 'dominant-baseline') ?? 'auto';
  const top = /middle|central/.test(base) ? t.y - 0.5 * t.fs : /hanging|before-edge|text-before/.test(base) ? t.y : t.y - 0.8 * t.fs;
  const spans = lineSpans(t.el);
  let last = t.y;
  for (const s of spans) last = s.hasAttribute('y') ? num(s.getAttribute('y')) : last + num(s.getAttribute('dy'));
  return { x: x0 + t.m[4], y: top + t.m[5], w, h: last - t.y + 1.05 * t.fs };
}

/** Raises small text to `minFont`, wraps and stacks it so it stays inside its card; then clears labels off strokes. */
export function prepareText(g: Element, minFont: number, sizes?: Map<Element, number>): void {
  try {
    // Prose first (prose.ts): a sentence or a stack of word lines is never fitted, checked or drawn.
    const prose = stripProse(g);
    if (prose.length) g.setAttribute('data-prose-removed', prose.join(' | '));
    fit(g, minFont, sizes); clear(g, minFont);
  } catch { /* geometry is best-effort: never block a group */ }
}

/**
 * `sizes` (the board grammar, grammar.ts): the size each text is set at, up or down; texts it does not
 * name are only raised to `minFont`. Cards are then re-set with one line pitch and padding.
 */
function fit(g: Element, minFont: number, sizes?: Map<Element, number>): void {
  const all = Array.from(g.querySelectorAll('text')).filter((e) => !e.closest('defs,marker,symbol,clipPath,pattern'));
  if (!all.length) return;
  const cards = Array.from(g.querySelectorAll('rect')).filter((r) => !r.closest('defs,marker,symbol,clipPath,pattern'))
    .map((r) => ({ el: r, m: matOf(r, g) })).filter((c) => isShift(c.m))
    .map((c) => ({ el: c.el, box: { x: num(c.el.getAttribute('x')) + c.m[4], y: num(c.el.getAttribute('y')) + c.m[5], w: num(c.el.getAttribute('width')), h: num(c.el.getAttribute('height')) } }))
    .filter((c) => c.box.w > 40 && c.box.h > 18);
  const ts: T[] = [];
  for (const el of all) {
    const m = matOf(el, g);
    const fs0 = num(inherit(el, 'font-size'), 16);
    const want = sizes?.get(el) ?? Math.max(minFont, fs0);
    if (!isShift(m) || el.hasAttribute('data-at')) { if (Math.abs(want - fs0) > 0.01) el.setAttribute('font-size', r2(want)); continue; }
    const x = num(el.getAttribute('x')?.split(/[\s,]+/)[0]), y = num(el.getAttribute('y')?.split(/[\s,]+/)[0]);
    const px = x + m[4], py = y + m[5];
    // Its card: the smallest rect around where it is written.
    const inside = cards.filter((c) => px >= c.box.x - 1 && px <= c.box.x + c.box.w + 1 && py >= c.box.y - 1 && py <= c.box.y + c.box.h + 1).sort((a, b) => a.box.w * a.box.h - b.box.w * b.box.h)[0];
    let fs = fs0, raised = false;
    if (Math.abs(want - fs0) > 0.01) {
      const k = want / fs0;
      fs = want; raised = want > fs0;
      el.setAttribute('font-size', r2(want));
      for (const s of Array.from(el.querySelectorAll('tspan'))) {
        if (s.hasAttribute('font-size')) s.setAttribute('font-size', r2(Math.max(minFont, num(s.getAttribute('font-size'), fs0) * k)));
        const dy = s.getAttribute('dy');
        if (dy && !/em|%/.test(dy)) s.setAttribute('dy', r2(num(dy) * k));
        if (s.hasAttribute('y')) s.setAttribute('y', r2(y + (num(s.getAttribute('y')) - y) * k));
      }
    }
    ts.push({ el, m, x, y, fs, fs0, anchor: inherit(el, 'text-anchor') ?? 'start', lines: 1, raised, card: inside?.box ?? null, cardEl: inside?.el ?? null });
  }
  if (sizes) setCards(g, ts, cards);
  if (!ts.some((t) => t.raised)) return;
  // Wrap: a raised line wider than its card breaks at words.
  for (const t of ts) {
    if (!t.raised || !t.card || t.el.children.length) continue;
    const pad = Math.max(6, 0.45 * t.fs), c = t.card, px = t.x + t.m[4];
    const avail = t.anchor === 'middle' ? 2 * Math.min(px - c.x, c.x + c.w - px) - 2 * pad : t.anchor === 'end' ? px - c.x - pad : c.x + c.w - pad - px;
    const words = (t.el.textContent ?? '').replace(/\s+/g, ' ').trim().split(' ');
    if (avail <= 0 || textEm(words.join(' ')) * t.fs <= avail || words.length < 2) continue;
    const lines: string[] = [];
    let cur = '';
    for (const w of words) { const nx = cur ? `${cur} ${w}` : w; if (cur && textEm(nx) * t.fs > avail) { lines.push(cur); cur = w; } else cur = nx; }
    if (cur) lines.push(cur);
    if (lines.length < 2) continue;
    while (t.el.firstChild) t.el.removeChild(t.el.firstChild);
    lines.forEach((s, i) => { const sp = t.el.ownerDocument.createElementNS(SVGNS, 'tspan'); sp.setAttribute('x', r2(t.x)); if (i) sp.setAttribute('dy', r2(1.2 * t.fs)); sp.textContent = s; t.el.appendChild(sp); });
  }
  // Stack: in reading order, a text that now runs into the one above it (a list, a card's lines) moves down.
  const order = ts.slice().sort((a, b) => a.y + a.m[5] - (b.y + b.m[5]));
  const placed: { t: T; b: Box; y0: number }[] = [];
  const pushed = new Map<Element | null, number>();
  for (const t of order) {
    let b = boxOf(t);
    let dy = 0;
    for (const p of placed) {
      if (p.t.card !== t.card) continue;
      const hOverlap = Math.min(b.x + b.w, p.b.x + p.b.w) - Math.max(b.x, p.b.x) > 0;
      // They were a list: written one under the other, a line or so apart.
      const wasList = t.y + t.m[5] - p.y0 > 0 && t.y + t.m[5] - p.y0 < 2.2 * Math.max(t.fs0, p.t.fs0) + (p.t.el.children.length ? p.b.h : 0);
      if (!hOverlap || !wasList || !(t.raised || p.t.raised)) continue;
      const need = p.b.y + p.b.h + 0.18 * t.fs - b.y;
      if (need > dy) dy = need;
    }
    const y0 = t.y + t.m[5];
    if (dy > 0.5) { shift(t.el, 0, dy); t.y += dy; b = boxOf(t); pushed.set(t.cardEl, Math.max(pushed.get(t.cardEl) ?? 0, dy)); }
    placed.push({ t, b, y0 });
  }
  // Cards grow to hold their text (right and down).
  for (const c of cards) {
    const inside = placed.filter((p) => p.t.cardEl === c.el);
    if (!inside.length || !inside.some((p) => p.t.raised)) continue;
    const pad = Math.max(6, 0.4 * Math.max(...inside.map((p) => p.t.fs)));
    const bottom = Math.max(...inside.map((p) => p.b.y + p.b.h)) + pad, right = Math.max(...inside.map((p) => p.b.x + p.b.w)) + pad;
    if (bottom > c.box.y + c.box.h) c.el.setAttribute('height', r2(bottom - c.box.y));
    if (right > c.box.x + c.box.w) c.el.setAttribute('width', r2(right - c.box.x));
  }
}

/**
 * A card (a rect holding two or more lines written one under another at one x): its lines are set at
 * one pitch (1.7 × the size) from one padding, the card resized around them. A wider gap the model
 * left between lines stays a half-line break.
 */
function setCards(g: Element, ts: T[], cards: { el: Element; box: Box }[]): void {
  for (const c of cards) {
    const inside = ts.filter((t) => t.card === c.box && !t.el.children.length && (inherit(t.el, 'text-anchor') ?? 'start') === 'start').sort((a, b) => a.y - b.y);
    if (inside.length < 2 || inside.some((t) => Math.abs(t.x + t.m[4] - (inside[0].x + inside[0].m[4])) > 4)) continue;
    const fs = Math.max(...inside.map((t) => t.fs)), pitch = 1.7 * fs, pad = 1.1 * fs;
    const gaps = inside.slice(1).map((t, i) => t.y - inside[i].y), g0 = Math.min(...gaps);
    let base = c.box.y + pad + 0.78 * fs;
    inside.forEach((t, i) => {
      if (i) base += pitch + (gaps[i - 1] > 1.45 * g0 ? 0.5 * fs : 0);
      const want = base - t.m[5];
      if (Math.abs(want - t.y) > 0.01) { shift(t.el, 0, want - t.y); t.y = want; }
    });
    const left = inside[0].x + inside[0].m[4] - c.box.x;
    const right = Math.max(...inside.map((t) => t.x + t.m[4] + Math.max(...lineWidths(t.el, t.fs)))) + Math.max(left, pad);
    const bottom = base + 0.32 * fs + pad;
    c.el.setAttribute('height', r2(bottom - c.box.y)); c.box.h = bottom - c.box.y;
    if (right > c.box.x + c.box.w) { c.el.setAttribute('width', r2(right - c.box.x)); c.box.w = right - c.box.x; }
    for (const t of inside) t.raised = false;
  }
}

function clear(g: Element, minFont: number): void {
  const geo = groupGeometry(g, minFont);
  if (!geo.texts.length || !geo.segs.length) return;
  const others = geo.texts.slice();
  const done = new Set<Element>();
  for (const t of geo.texts) {
    const el = t.el;
    if (!el || done.has(el) || !t.m || !isShift(t.m) || el.hasAttribute('data-at') || el.closest('[data-at]')) continue;
    const hit = (b: typeof t) => geo.segs.some((s) => !s.tiny && segHitsBox(s.a, s.b, core(b)));
    if (!hit(t)) continue;
    // A text inside a card is the card's content, not a label: leave it.
    const lines = geo.texts.filter((o) => o.el === el);
    if (lines.length > 1) continue;
    const dirs = [[0, -1], [0, 1], [1, 0], [-1, 0], [1, -1], [-1, -1], [1, 1], [-1, 1]];
    let best: [number, number] | null = null;
    for (const k of [0.25, 0.5, 0.75, 1, 1.25]) {
      for (const [ux, uy] of dirs) {
        const d = k * t.fs, n = Math.hypot(ux, uy);
        const dx = (ux / n) * d, dy = (uy / n) * d;
        const b = { ...t, x: t.x + dx, y: t.y + dy };
        if (b.x < 0 || b.y < 0) continue;
        if (hit(b)) continue;
        if (others.some((o) => o.el !== el && overlapArea(b, o) > 0)) continue;
        best = [dx, dy];
        break;
      }
      if (best) break;
    }
    if (!best) continue;
    shift(el, best[0], best[1]);
    done.add(el);
    const i = others.indexOf(t);
    if (i >= 0) others[i] = { ...t, x: t.x + best[0], y: t.y + best[1] };
  }
}
