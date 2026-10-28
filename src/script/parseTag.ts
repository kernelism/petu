// src/script/parseTag.ts
import { REGION_H, type Compass, type RawEnd, type Pt, type RawAction, type Target, type Weight } from './types';
import { tokenize, unquote } from './tokenize';
import { NAME, normName, parsePtArg, worldPt, isBlockRef, type PtArg } from './pointExpr';
import { parseKitBlock, parseKitVerb, sceneRel } from './parseKit';
import { parseScene, SCENE_TAGS } from './parseScene';

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
  return ref ? { region, ref } : undefined;
}

/** Parses the inside of a `{{ ... }}` tag. Returns null for anything malformed (the caller warns). */
export function parseTag(body: string): RawAction | null {
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
    const on = rawArgs.on !== undefined ? id(rawArgs.on) : undefined;
    const page = on === undefined ? num(rawArgs.p) : undefined;
    const scalarOf = (k: string, v: string) => k !== 'on' && k !== 'p' && !dupKeys.has(k) && /^[A-Za-z][A-Za-z0-9_]{0,15}$/.test(k) && !v.includes(',') && /^[-−+(.\d]|^(sqrt|pi|rad|deg|sin|cos|tan)\b/i.test(v.trim());
    // Numbers in a let (v=20 g=9.8, no comma: not points) are constants, as a {{const}} would make them.
    const scalars = Object.entries(rawArgs).filter(([k, v]) => scalarOf(k, v));
    const allScalar = scalars.length > 0 && Object.keys(rawArgs).every((k) => k === 'on' || k === 'p' || scalars.some(([s]) => s === k));
    if (allScalar && !flags.size && !quotes.length) return { kind: 'const', defs: scalars.map(([k, v]) => [k, v.trim()]) };
    if (on === undefined && (page === undefined || page < 1 || !Number.isInteger(page))) return null;
    const lit = on !== undefined ? worldPt : (v: string) => pt(v, 1000);
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
    return on !== undefined ? { kind: 'let', region: on, defs: parsed } : { kind: 'let', page: page!, defs: parsed };
  }

  // Any other tag with a repeated key (`line from=D to=C to=E`) is ambiguous: malformed.
  if (dupKeys.size) return null;

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

  // Everything else draws into one target: `p=N` (a page) or `on=<region>`.
  const onRaw = args.on?.toLowerCase();
  let target: Target;
  if (onRaw !== undefined) { const r = id(onRaw); if (!r) return null; target = { region: r }; }
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
  const P = (s?: string): PtArg | undefined => parsePtArg(s, inRegion ? worldPt : (v) => pt(v, 1000));
  const PS = (s: string | undefined, min: number): PtArg[] | undefined => {
    if (!s) return undefined;
    const out = s.trim().split(/\s+/).map((x) => P(x));
    return out.length >= min && out.every(Boolean) ? (out as PtArg[]) : undefined;
  };
  if (SCENE_TAGS.has(name)) {
    if (!inRegion) return null;
    const s = parseScene(name, args, quotes, flags);
    return s ? ({ ...s, ...target, ...mark } as RawAction) : null;
  }
  if (name === 'grid' || name === 'bars' || name === 'scatter' || name === 'table' || name === 'calc' || name === 'fit' || name === 'shares' || name === 'blend') {
    if (!inRegion) return null;
    const b = parseKitBlock(name, args, quotes, flags, P);
    return b ? ({ ...b, ...target, ...mark } as RawAction) : null;
  }
  const markArg = args.mark;
  if (markArg !== undefined) {
    if (inRegion || !MARK_ID.test(markArg)) return null;
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
  const radii = () => {
    const r = num(args.r), rx = num(args.rx) ?? r, ry = num(args.ry) ?? r;
    return rx && ry && rx > 0 && ry > 0 ? { rx: Math.min(rx, MAX_R), ry: Math.min(ry, MAX_R) } : null;
  };

  switch (name) {
    case 'scroll': {
      if (target.page == null || inRegion) return null; // regions never scroll
      const y = num(args.y);
      return y === undefined ? { kind: 'scroll', page: target.page } : { kind: 'scroll', page: target.page, y: clamp(y, 1000) };
    }
    case 'highlight':
    case 'underline':
      return anchor ? ({ kind: name, ...target, ...anchor, ...(name === 'underline' ? weight : {}), ...mark } as RawAction) : null;
    case 'circle': {
      if (anchor) return { kind: 'circle', ...target, ...anchor, ...dash, ...weight, ...mark };
      const r = radii();
      return at && r ? { kind: 'circle', ...target, at, ...r, ...dash, ...weight, ...mark } : null;
    }
    case 'line':
    case 'arrow': {
      const from = P(args.from), to = P(args.to), through = P(args.through), len = num(args.len);
      if (from && through && !to) {
        if (args.len !== undefined && !(len! > 0 && len! <= 20)) return null;
        return { kind: name, ...target, from, through, ...(len ? { len } : {}), ...dash, ...weight, ...mark } as RawAction;
      }
      return from && to && !through ? ({ kind: name, ...target, from, to, ...dash, ...weight, ...mark } as RawAction) : null;
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
      return at && quote ? { kind: 'label', ...target, at, text: quote, ...mark } : null;
    case 'write': {
      const c = args.at ? undefined : P(args.center);
      const p0 = at ?? c;
      return inRegion && p0 && quote && textSize ? { kind: 'write', ...target, at: p0, text: quote, size: textSize, ...(c ? { centered: true } : {}), ...mark } : null;
    }
    case 'point': {
      const dir = args.dir?.toLowerCase();
      if (!at || (dir && !COMPASS.has(dir))) return null;
      return { kind: 'point', ...target, at, ...(quote ? { text: quote } : {}), ...(dir ? { dir: dir as Compass } : {}), ...mark };
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
      if (!at || !from || !to || (r !== undefined && !(r > 0))) return null;
      return { kind: 'angle', ...target, at, from, to, ...(r ? { r: Math.min(r, MAX_R) } : {}), ...(quote ? { text: quote } : {}), ...weight, ...mark };
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
      if (!inRegion) return null;
      if (!param && (!fn || fn.length > MAX_FN_CHARS || !dsrc)) return null;
      if (!param && dnum && !(dnum[1] > dnum[0])) return null;
      if (param && (args.x!.length > MAX_FN_CHARS || args.y!.length > MAX_FN_CHARS)) return null;
      if (range && !(range[1] > range[0])) return null;
      const labelAt = args.label?.toLowerCase() === 'top' ? { labelAt: 'top' as const } : {};
      const axisLabels = { ...(args.xlabel ? { xLabel: args.xlabel.slice(0, 40) } : !param && args.x ? { xLabel: args.x.slice(0, 40) } : {}), ...(args.ylabel ? { yLabel: args.ylabel.slice(0, 40) } : !param && args.y ? { yLabel: args.y.slice(0, 40) } : {}) };
      return {
        kind: 'plot', ...target,
        ...(param ? { x: args.x!.trim(), y: args.y!.trim(), t: tr } : { fn, domainSrc: dsrc, ...(dnum && dnum[1] > dnum[0] ? { domain: dnum } : {}) }),
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
