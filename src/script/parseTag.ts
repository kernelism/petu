// src/script/parseTag.ts
import { REGION_H, type Compass, type RawEnd, type Pt, type RawAction, type Target, type Weight } from './types';
import { tokenize, unquote } from './tokenize';
import { NAME, normName, parsePtArg, worldPt, isBlockRef, isFormula, type PtArg } from './pointExpr';
import { parseKitBlock, parseKitVerb, parseSplitBar, sceneRel, type ParseCtx } from './parseKit';
import { parseScene, parseSplit, SCENE_TAGS } from './parseScene';
import { parseFind, parseMove, parseTween, parseVal } from './parseValues';

/** Region and element ids: a letter, then letters, digits, - or _. Case-insensitive (stored lowercased). */
const ID = /^[a-z][a-z0-9_-]{0,23}$/;
const COMPASS = new Set(['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw']);
const WEIGHTS = new Set<Weight>(['primary', 'secondary', 'faint']);
const MAX_R = 500;
export const MAX_FN_CHARS = 120;

const num = (s?: string) => (s === undefined || s === '' ? undefined : Number.isFinite(Number(s)) ? Number(s) : undefined);
const clamp = (n: number, hi: number) => Math.min(hi, Math.max(0, n));
/** Region ids (`sketch id=`, `on=`): lowercased. */
const id = (s?: string) => (s && ID.test(s.toLowerCase()) ? s.toLowerCase() : undefined);
/** Element ids double as point names: case-sensitive (X and x are different points), ' → ′. */
/** An element id; a hyphen reads as an underscore (id=row-column is row_column everywhere). */
const eid = (s?: string) => { const n = s ? normName(s.trim().replace(/-/g, '_')) : ''; return n && NAME.test(n) ? n : undefined; };
const MARK_ID = /^#[a-z]\d{1,3}$/;
/** A calibrated chart on a page (`on=#c1`, with `p=`). */
const CHART_ID = /^#c\d{1,3}$/;
/** What may be drawn on a chart in its data coordinates. */
const CHART_KINDS = new Set(['line', 'arrow', 'point', 'circle', 'label', 'curve', 'shade', 'angle', 'brace', 'plot', 'note']);
/** "x,y,w,h" → a page rect (model coords), clipped to the page; null unless w, h > 0. */
function rect4(s?: string): { x: number; y: number; w: number; h: number } | undefined {
  const p = s?.split(',').map(Number);
  if (!p || p.length !== 4 || !p.every(Number.isFinite)) return undefined;
  const x = clamp(p[0], 1000), y = clamp(p[1], 1000), w = Math.min(p[2], 1000 - x), h = Math.min(p[3], 1000 - y);
  return w > 0 && h > 0 ? { x, y, w, h } : undefined;
}
/** An element id, or a part of a kit block (`g[2,3]`, `v[1:3]`). */
const rid = (s?: string) => (s && isBlockRef(s) ? s : eid(s));

/** "x,y" → a point clamped to 0–1000 × 0–ymax. */
function pt(s: string | undefined, ymax: number): Pt | undefined {
  if (!s) return undefined;
  const parts = s.split(',');
  if (parts.length !== 2) return undefined;
  const [a, b] = parts.map(Number);
  return Number.isFinite(a) && Number.isFinite(b) ? { x: clamp(a, 1000), y: clamp(b, ymax) } : undefined;
}
/** "a,b" → two finite numbers. */
function pair(s?: string): [number, number] | undefined {
  const p = s?.split(',').map(Number);
  return p && p.length === 2 && p.every(Number.isFinite) ? [p[0], p[1]] : undefined;
}

/** `\\frac` → `\frac` (a JSON-escaped backslash before a command); `\\` before a space or end stays (a line break). */
export const normalizeTex = (s: string) => s.replace(/\\\\(?=[A-Za-z])/g, '\\');

/** A connector end's page mark: a mark id, or a line mark's end (`#s2.a`, `#s2.b`). */
const END_MARK = /^#[a-z]\d{1,3}(\.[ab])?$/;

/** One connector end: `p3:"quote"`, `p3:#d3`, `p3:x,y`, `side:elementId` or `side:x,y`. */
function end(s: string | undefined, near: Pt | undefined): RawEnd | undefined {
  const m = s?.match(/^([^:]+):(.+)$/);
  if (!m) return undefined;
  const [, head, rest] = m;
  const page = /^p(\d+)$/i.exec(head);
  if (page) {
    const p = Number(page[1]);
    if (p < 1) return undefined;
    if (/^["“]/.test(rest)) { const q = unquote(rest); return q ? { page: p, quote: q, ...(near ? { near } : {}) } : undefined; }
    if (rest.startsWith('#')) return END_MARK.test(rest) ? { page: p, mark: rest } : undefined;
    const at = pt(rest, 1000);
    return at ? { page: p, at } : undefined;
  }
  const region = id(head);
  if (!region) return undefined;
  const at = pt(rest, REGION_H);
  if (at) return { region, at };
  const ref = rid(rest);
  if (ref) return { region, ref };
  // A construction (`w:mid(A,B)`): a point of the section, resolved with its names when built.
  const c = /^(mid|along|meet|foot)\(/.test(rest) ? parsePtArg(rest, worldPt) : undefined;
  return c ? { region, at: c } as RawEnd : undefined;
}

/**
 * Parses the inside of a `{{ ... }}` tag. Returns null for anything malformed (the caller warns).
 * `ctx`: what the stream's parser knows so far (constants' names), for slips that depend on it.
 */
export function parseTag(body: string, ctx?: ParseCtx): RawAction | null {
  const t = tokenize(body);
  if (!t) return null;
  const { name, args, quotes, flags, rawArgs, dupKeys } = t;
  const quote = quotes[0]?.trim() || undefined;

  // {{let}}: its own keys are point names (case-sensitive, so `P=` is a point, not a page): the
  // target comes from the exact keys `on` / `p`, and every other key=value is a definition.
  // {{const v=20 g=9.8}}: named numbers (expressions over earlier ones), case kept as written.
  if (name === 'const') {
    const defs = Object.entries(rawArgs).filter(([k, v]) => !dupKeys.has(k) && /^[A-Za-z][A-Za-z0-9_]{0,15}$/.test(k) && v.trim() && v.length <= 120).map(([k, v]) => [k, v.trim()] as [string, string]);
    return defs.length ? { kind: 'const', defs } : null;
  }
  if (name === 'let') {
    // On a chart (p=12 on=#c1): names of data points, mapped onto the page when used there.
    const chartOn = rawArgs.on !== undefined && CHART_ID.test(rawArgs.on.toLowerCase()) ? rawArgs.on.toLowerCase() : undefined;
    const on = rawArgs.on !== undefined && !chartOn ? id(rawArgs.on) : undefined;
    const page = on === undefined ? num(rawArgs.p) : undefined;
    const scalarOf = (k: string, v: string) => k !== 'on' && k !== 'p' && !dupKeys.has(k) && /^[A-Za-z][A-Za-z0-9_]{0,15}$/.test(k) && !v.includes(',') && /^[-−+(.\d]|^(sqrt|pi|rad|deg|sin|cos|tan)\b/i.test(v.trim());
    // Numbers in a let (v=20 g=9.8, no comma: not points) are constants, as a {{const}} would make them.
    const scalars = Object.entries(rawArgs).filter(([k, v]) => scalarOf(k, v));
    const allScalar = scalars.length > 0 && Object.keys(rawArgs).every((k) => k === 'on' || k === 'p' || scalars.some(([s]) => s === k));
    if (allScalar && !flags.size && !quotes.length) return { kind: 'const', defs: scalars.map(([k, v]) => [k, v.trim()]) };
    if (on === undefined && (page === undefined || page < 1 || !Number.isInteger(page))) return null;
    const lit = on !== undefined || chartOn ? worldPt : (v: string) => pt(v, 1000);
    const parsed: [string, PtArg][] = [];
    for (const [k, v] of Object.entries(rawArgs)) {
      if (k === 'on' || (on === undefined && k === 'p')) continue;
      if (dupKeys.has(k)) { console.warn('[script] let: name defined twice, dropped:', k); continue; } // ambiguous: never pick one
      const n = eid(k), p = parsePtArg(v, lit);
      // A bad definition drops that name only: whatever is built from it is skipped later (unknown
      // point), while the rest of the figure still draws. Failing the whole let lost every point.
      if (!n || !p) { console.warn('[script] let: bad definition dropped:', `${k}=${v}`); continue; }
      parsed.push([n, p]);
    }
    if (!parsed.length || flags.size || quotes.length) return null;
    return on !== undefined ? { kind: 'let', region: on, defs: parsed } : { kind: 'let', page: page!, defs: parsed, ...(chartOn ? { chart: chartOn } : {}) };
  }

  // Any other tag with a repeated key (`line from=D to=C to=E`) is ambiguous: malformed.
  if (dupKeys.size) return null;

  // Bound numbers, readouts, demonstration moves (src/script/parseValues.ts).
  if (name === 'val') return parseVal(args);
  if (name === 'find') return parseFind(args, flags);
  if (name === 'contrast' || name === 'limit' || name === 'beforeafter') return parseMove(name, rawArgs, quotes);
  if (name === 'tween') return parseTween(rawArgs, flags);

  // Tags without a target.
  switch (name) {
    case 'clear': return { kind: 'clear' };
    case 'scene':
    case 'sketch': {
      // A section on the board. `near=pN` names the slide it explains (optional: the visible one);
      // `place=` is accepted and ignored (the board has one place); `size=l` widens the board.
      const sid = id(args.id);
      const n = args.near != null ? num(args.near.replace(/^p/i, '')) : undefined;
      const page = n != null && n >= 1 && Number.isInteger(n) ? n : undefined;
      const size = (args.size ?? 'm').toLowerCase();
      if (!sid) return null;
      if (size !== 's' && size !== 'm' && size !== 'l') return null;
      if (name === 'scene') return { kind: 'sketch', id: sid, ...(page != null ? { page } : {}), size: 'm', scene: true };
      return { kind: 'sketch', id: sid, ...(page != null ? { page } : {}), size, ...(flags.has('fit') ? { fit: true } : {}) };
    }
    case 'emph':
    case 'fade': {
      const ref = rid(args.id);
      if (name === 'emph' && args.where != null) return ref && args.where.length <= 120 ? { kind: 'emph', ref, where: args.where } : null;
      return ref ? { kind: name, ref } : null;
    }
    case 'step':
    case 'sweep':
    case 'set':
    case 'band':
    case 'dist':
    case 'col':
    case 'level':
      return parseKitVerb(name, args, quotes, flags);
    // vals=: a kit bar split into parts; otherwise a scene chip into several.
    case 'split': return args.vals != null ? parseSplitBar(args, quotes) : parseSplit(args, quotes);
    case 'move': {
      const ref = eid(args.id), to = pt(args.to, 1000); // clamped to the element's own space when it runs
      const rel = sceneRel(args);
      if (rel) return ref && args.to == null ? { kind: 'move', ref, place: rel } : null;
      return ref && to && rel === undefined ? { kind: 'move', ref, to } : null;
    }
    case 'connect': {
      const near = pt(args.near, 1000);
      const from = end(args.from, near), to = end(args.to, near);
      if (!from || !to || ('page' in from) === ('page' in to)) return null; // one page end, one region end
      return { kind: 'connect', from, to, ...(eid(args.id) ? { id: eid(args.id) } : {}) };
    }
    case 'label': {
      if (args.at === undefined && args.id !== undefined) {
        const ref = eid(args.id);
        const dir = args.dir?.toLowerCase();
        if (!ref || !quote || (dir && !COMPASS.has(dir))) return null;
        return { kind: 'label', ref, text: quote, ...(dir ? { dir: dir as Compass } : {}), ...(flags.has('em') ? { em: true } : {}) };
      }
    }
  }

  // Everything else draws into one target: `p=N` (a page) or `on=<region>`. `p=N on=#c1`: a page
  // drawing on that page's calibrated chart, in its data coordinates.
  const onRaw = args.on?.toLowerCase();
  const chart = onRaw !== undefined && CHART_ID.test(onRaw) ? onRaw : undefined;
  if (chart && !CHART_KINDS.has(name)) return null;
  let target: Target;
  if (onRaw !== undefined && !chart) { const r = id(onRaw); if (!r) return null; target = { region: r }; }
  else {
    const p = num(args.p);
    if (p === undefined || p < 1 || !Number.isInteger(p)) return null;
    target = { page: p };
  }
  const inRegion = target.region != null;
  const Y = inRegion ? REGION_H : 1000; // region-local y is 0–700 (rule 5)
  const mark = { ...(eid(args.id) ? { id: eid(args.id) } : {}), ...(flags.has('em') ? { em: true } : {}) };
  // Points: page literals clamp here (as before); region literals are world units, clamped by the
  // resolver after fitting; names, page marks (#d3) and constructions resolve when built.
  // Chart points are data values (any range): the resolver maps them onto the page.
  const P = (s?: string): PtArg | undefined => parsePtArg(s, inRegion || chart ? worldPt : (v) => pt(v, 1000));
  const PS = (s: string | undefined, min: number): PtArg[] | undefined => {
    if (!s) return undefined;
    const out = s.trim().split(/\s+/).map((x) => P(x));
    return out.length >= min && out.every(Boolean) ? (out as PtArg[]) : undefined;
  };
  // {{lift p=4 mark=#g1 on=s id=fig}} / box=x,y,w,h: the slide's region onto the board (p= is the source page).
  if (name === 'lift') {
    if (!inRegion) return null;
    const p = num(args.p), box = rect4(args.box), m = args.mark, at = P(args.at), w = num(args.w);
    if (p === undefined || p < 1 || !Number.isInteger(p) || !box === !m || (m !== undefined && !MARK_ID.test(m))) return null;
    if ((args.at !== undefined && !at) || (w !== undefined && !(w > 0))) return null;
    return { kind: 'lift', ...target, srcPage: p, ...(box ? { src: box } : { srcMark: m }), ...(at ? { at } : {}), ...(w ? { w: Math.min(w, 1000) } : {}), ...mark } as RawAction;
  }
  // {{note p=4 "…" annotate=#e2|"quote"}} (or at=x,y): a note beside it on the page (below, as `annot`).
  const pageNote = name === 'note' && !inRegion;
  if (SCENE_TAGS.has(name) && !pageNote) {
    if (!inRegion) return null;
    const s = parseScene(name, args, quotes, flags);
    return s ? ({ ...s, ...target, ...mark } as RawAction) : null;
  }
  if (name === 'grid' || name === 'bars' || name === 'scatter' || name === 'table' || name === 'calc' || name === 'fit' || name === 'shares' || name === 'blend' || name === 'tokens') {
    if (!inRegion) return null;
    const b = parseKitBlock(name, args, quotes, flags, P, ctx);
    return b ? ({ ...b, ...target, ...mark } as RawAction) : null;
  }
  const markArg = args.mark;
  if (markArg !== undefined) {
    if (inRegion || chart || !MARK_ID.test(markArg)) return null;
    if (!['circle', 'box', 'highlight', 'underline', 'line', 'arrow'].includes(name)) return null;
    const w = args.weight?.toLowerCase();
    if (w !== undefined && !WEIGHTS.has(w as Weight)) return null;
    return { kind: name as 'circle', page: target.page!, mark: markArg, ...mark, ...(w ? { weight: w as Weight } : {}), ...(flags.has('dash') ? { dash: true } : {}) };
  }
  const dash = flags.has('dash') ? { dash: true } : {};
  // Line hierarchy on stroked kinds: `weight=primary|secondary|faint`; anything else is malformed.
  const wRaw = args.weight?.toLowerCase();
  if (wRaw !== undefined && !WEIGHTS.has(wRaw as Weight)) return null;
  const weight = wRaw ? { weight: wRaw as Weight } : {};
  const outline = flags.has('outline') ? { outline: true } : {};
  const near = P(args.near);
  const anchor = quote ? { quote, ...(near ? { near } : {}) } : null;
  const at = P(args.at);
  const size = (args.size ?? 'm').toLowerCase();
  const textSize = size === 's' || size === 'm' || size === 'l' ? size : null;
  const radii = (): { rx: number; ry: number; exprs?: { r: string } } | null => {
    // Live: `r=R` (a formula over constants, in a section or on a chart) is evaluated when resolved.
    if (args.r != null && num(args.r) === undefined && args.rx == null && args.ry == null && (inRegion || chart) && isFormula(args.r)) return { rx: 1, ry: 1, exprs: { r: args.r.trim() } };
    const r = num(args.r), rx = num(args.rx) ?? r, ry = num(args.ry) ?? r;
    return rx && ry && rx > 0 && ry > 0 ? { rx: Math.min(rx, MAX_R), ry: Math.min(ry, MAX_R) } : null;
  };
  // A readout on text: `value=<formula over constants>` (fmt= decimals, unit=), live as they change.
  const liveValue = () => {
    const v = args.value?.trim(), f = num(args.fmt);
    if (v == null || !inRegion || !/^[A-Za-z0-9_.+\-*/^() ]{1,120}$/.test(v)) return {};
    return { value: v, ...(f != null && Number.isInteger(f) && f >= 0 && f <= 6 ? { fmt: f } : {}), ...(args.unit ? { unit: args.unit.slice(0, 16) } : {}) };
  };

  const out = drawTag();
  return out && chart ? ({ ...out, chart } as RawAction) : out;

  function drawTag(): RawAction | null {
  switch (name) {
    case 'note': {
      // A page note: what it annotates is a page mark (#e2, #t5, #c1), a quote, or a point (at=).
      if (!pageNote || !quote) return null;
      const ann = args.annotate?.trim();
      const text = quote.slice(0, 120);
      if (ann && MARK_ID.test(ann) && !chart) return { kind: 'annot', ...target, text, annotate: ann, ...mark } as RawAction;
      if (ann && !MARK_ID.test(ann) && !chart) return { kind: 'annot', ...target, text, quote: ann, ...(near ? { near } : {}), ...mark } as RawAction;
      return !ann && at ? ({ kind: 'annot', ...target, text, at, ...mark } as RawAction) : null;
    }
    case 'scroll': {
      if (target.page == null || inRegion) return null; // regions never scroll
      const y = num(args.y);
      return y === undefined ? { kind: 'scroll', page: target.page } : { kind: 'scroll', page: target.page, y: clamp(y, 1000) };
    }
    case 'highlight':
    case 'underline':
      return anchor ? ({ kind: name, ...target, ...anchor, ...(name === 'underline' ? weight : {}), ...mark } as RawAction) : null;
    case 'zoom': {
      // {{zoom on=s at=P r=60 scale=4}}: a small detail, enlarged beside the figure (region only).
      const r = num(args.r), k = args.scale != null ? num(args.scale) : 3;
      if (!inRegion || !at || r == null || !(r > 0) || k == null || !(k > 1)) return null;
      return { kind: 'zoom', ...target, at, r, scale: Math.min(Math.max(k, 1.5), 8), ...(quote ? { text: quote.slice(0, 60) } : {}), ...mark };
    }
    case 'circle': {
      if (anchor) return { kind: 'circle', ...target, ...anchor, ...dash, ...weight, ...mark };
      const r = radii();
      return at && r ? { kind: 'circle', ...target, at, ...r, ...dash, ...weight, ...mark } : null;
    }
    case 'line':
    case 'arrow': {
      const from = P(args.from), to = P(args.to), through = P(args.through), len = num(args.len);
      const text = quote ? { text: quote } : {}; // its own label, beside it
      if (from && through && !to) {
        // len= a formula over constants (live): evaluated when resolved.
        const lenExpr = args.len !== undefined && len === undefined && isFormula(args.len) ? { exprs: { len: args.len.trim() } } : {};
        if (args.len !== undefined && !lenExpr.exprs && !(len! > 0 && len! <= 20)) return null;
        return { kind: name, ...target, from, through, ...(len ? { len } : {}), ...lenExpr, ...text, ...dash, ...weight, ...mark } as RawAction;
      }
      return from && to && !through ? ({ kind: name, ...target, from, to, ...text, ...dash, ...weight, ...mark } as RawAction) : null;
    }
    case 'box': {
      if (anchor) return { kind: 'box', ...target, ...anchor, ...weight, ...mark };
      const s = pair(args.size);
      // A kit part (`at=g[1:2,1:3]`): frames those cells; the kit sizes it when it is built.
      if (inRegion && args.at && isBlockRef(args.at) && !args.size) return { kind: 'box', ...target, at: at!, w: 0, h: 0, ...weight, ...mark } as RawAction;
      const c = P(args.center);
      if (c && !args.at) {
        if (!s || !(s[0] > 0 && s[1] > 0)) return null;
        return { kind: 'box', ...target, at: c, w: s[0], h: s[1], centered: true, ...weight, ...mark } as RawAction;
      }
      if (!at || !s || !(s[0] > 0 && s[1] > 0)) return null;
      // Literal page boxes clip to the page; everything else clamps when resolved.
      const lit = 'x' in at && !inRegion;
      return { kind: 'box', ...target, at, w: lit ? Math.min(s[0], 1000 - (at as Pt).x) : s[0], h: lit ? Math.min(s[1], Y - (at as Pt).y) : s[1], ...weight, ...mark };
    }
    case 'label':
      return at && quote ? { kind: 'label', ...target, at, text: quote, ...liveValue(), ...mark } : null;
    case 'write': {
      const c = args.at ? undefined : P(args.center);
      const p0 = at ?? c;
      return inRegion && p0 && quote && textSize ? { kind: 'write', ...target, at: p0, text: quote, size: textSize, ...(c ? { centered: true } : {}), ...liveValue(), ...mark } : null;
    }
    case 'point': {
      const dir = args.dir?.toLowerCase();
      if (!at || (dir && !COMPASS.has(dir))) return null;
      return { kind: 'point', ...target, at, ...(quote ? { text: quote } : {}), ...(dir ? { dir: dir as Compass } : {}), ...(flags.has('trace') ? { trace: true } : {}), ...mark };
    }
    case 'curve': {
      const p = PS(args.pts, 2);
      return p ? { kind: 'curve', ...target, pts: p, ...dash, ...weight, ...mark } : null;
    }
    case 'shade': {
      const p = PS(args.pts, 3);
      if (p) return { kind: 'shade', ...target, pts: p, ...outline, ...mark };
      const r = radii();
      return at && r ? { kind: 'shade', ...target, at, ...r, ...outline, ...mark } : null;
    }
    case 'angle': {
      const from = P(args.from), to = P(args.to), r = num(args.r);
      const rExpr = args.r != null && r === undefined && inRegion && isFormula(args.r) ? { exprs: { r: args.r.trim() } } : {};
      if (!at || !from || !to || (args.r != null && !rExpr.exprs && !(r! > 0))) return null;
      return { kind: 'angle', ...target, at, from, to, ...(r ? { r: Math.min(r, MAX_R) } : {}), ...rExpr, ...(quote ? { text: quote } : {}), ...weight, ...mark };
    }
    case 'arc': {
      // Not a tag: read as an angle whose radius reaches from and to (the resolver checks it is exact).
      const c = P(args.center ?? args.at), from = P(args.from), to = P(args.to);
      if (!inRegion || !c || !from || !to || (args.center != null && args.at != null) || args.r != null) return null;
      return { kind: 'angle', ...target, at: c, from, to, ...(quote ? { text: quote } : {}), ...weight, ...mark, arc: true };
    }
    case 'brace': {
      const from = P(args.from), to = P(args.to);
      return from && to ? { kind: 'brace', ...target, from, to, ...(quote ? { text: quote } : {}), ...weight, ...mark } : null;
    }
    case 'axes': {
      const s = pair(args.size);
      if (!inRegion || !at || !s || !(s[0] > 0 && s[1] > 0)) return null;
      return {
        kind: 'axes', ...target, at, w: s[0], h: s[1], // clipped to the region when resolved
        ...(args.x ? { xLabel: args.x } : {}), ...(args.y ? { yLabel: args.y } : {}), ...weight, ...mark,
      };
    }
    case 'plot': {
      // Two expressions "a,b" (numbers or formulas over constants: t=0,2*v/g); split at the top-level comma.
      const two = (s?: string): [string, string] | undefined => {
        if (!s) return undefined;
        let d = 0;
        for (let i = 0; i < s.length; i++) { const ch = s[i]; if (ch === '(') d++; else if (ch === ')') d--; else if (ch === ',' && d === 0) { const a = s.slice(0, i).trim(), b = s.slice(i + 1).trim(); return a && b ? [a, b] : undefined; } }
        return undefined;
      };
      const fn = args.fn?.trim(), range = pair(args.range), axes = eid(args.axes);
      const tr = two(args.t);
      const param = !!(tr && args.x && args.y);
      const dsrc = two(args.domain);
      const dnum = pair(args.domain);
      if (!inRegion && !chart) return null;
      // On a chart the domain defaults to its x axis (the resolver fills it in).
      // axes= another plot without domain=: the parser gives it the host plot's domain (ScriptParser.take).
      if (!param && (!fn || fn.length > MAX_FN_CHARS || (!dsrc && !chart && !axes))) return null;
      if (chart && (axes || args.xlabel || args.ylabel)) return null; // the chart has its own axes
      if (!param && dnum && !(dnum[1] > dnum[0])) return null;
      if (param && (args.x!.length > MAX_FN_CHARS || args.y!.length > MAX_FN_CHARS)) return null;
      if (range && !(range[1] > range[0])) return null;
      const labelAt = args.label?.toLowerCase() === 'top' ? { labelAt: 'top' as const } : {};
      const axisLabels = { ...(args.xlabel ? { xLabel: args.xlabel.slice(0, 40) } : !param && args.x ? { xLabel: args.x.slice(0, 40) } : {}), ...(args.ylabel ? { yLabel: args.ylabel.slice(0, 40) } : !param && args.y ? { yLabel: args.y.slice(0, 40) } : {}) };
      return {
        kind: 'plot', ...target,
        ...(param ? { x: args.x!.trim(), y: args.y!.trim(), t: tr } : { fn, ...(dsrc ? { domainSrc: dsrc } : {}), ...(dnum && dnum[1] > dnum[0] ? { domain: dnum } : {}) }),
        ...(range ? { range } : {}), ...(axes ? { axes } : {}), ...(quote ? { label: quote.slice(0, 40) } : {}), ...labelAt, ...axisLabels, ...dash, ...weight, ...mark,
      };
    }
    case 'math': {
      const c = args.at ? undefined : P(args.center);
      const p0 = at ?? c;
      return inRegion && p0 && quote && textSize ? { kind: 'math', ...target, at: p0, tex: normalizeTex(quote), size: textSize, ...(c ? { centered: true } : {}), ...mark } : null;
    }
    default:
      return null;
  }
  }
}
