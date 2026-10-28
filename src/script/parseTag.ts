// src/script/parseTag.ts
import { REGION_H, type Action, type Compass, type End, type Pt, type Target, type Weight } from './types';
import { tokenize, unquote } from './tokenize';

/** Region and element ids: a letter, then letters, digits, - or _. Case-insensitive (stored lowercased). */
const ID = /^[a-z][a-z0-9_-]{0,23}$/;
const COMPASS = new Set(['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw']);
const WEIGHTS = new Set<Weight>(['primary', 'secondary', 'faint']);
const MAX_R = 500;
export const MAX_FN_CHARS = 120;

const num = (s?: string) => (s === undefined || s === '' ? undefined : Number.isFinite(Number(s)) ? Number(s) : undefined);
const clamp = (n: number, hi: number) => Math.min(hi, Math.max(0, n));
const id = (s?: string) => (s && ID.test(s.toLowerCase()) ? s.toLowerCase() : undefined);

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
function pts(s: string | undefined, ymax: number, min: number): Pt[] | undefined {
  if (!s) return undefined;
  const out = s.trim().split(/\s+/).map((x) => pt(x, ymax));
  return out.length >= min && out.every(Boolean) ? (out as Pt[]) : undefined;
}

/** `\\frac` → `\frac` (a JSON-escaped backslash before a command); `\\` before a space or end stays (a line break). */
export const normalizeTex = (s: string) => s.replace(/\\\\(?=[A-Za-z])/g, '\\');

/** One connector end: `p3:"quote"`, `p3:x,y`, `side:elementId` or `side:x,y`. */
function end(s: string | undefined, near: Pt | undefined): End | undefined {
  const m = s?.match(/^([^:]+):(.+)$/);
  if (!m) return undefined;
  const [, head, rest] = m;
  const page = /^p(\d+)$/i.exec(head);
  if (page) {
    const p = Number(page[1]);
    if (p < 1) return undefined;
    if (/^["“]/.test(rest)) { const q = unquote(rest); return q ? { page: p, quote: q, ...(near ? { near } : {}) } : undefined; }
    const at = pt(rest, 1000);
    return at ? { page: p, at } : undefined;
  }
  const region = id(head);
  if (!region) return undefined;
  const at = pt(rest, REGION_H);
  if (at) return { region, at };
  const ref = id(rest);
  return ref ? { region, ref } : undefined;
}

/** Parses the inside of a `{{ ... }}` tag. Returns null for anything malformed (the caller warns). */
export function parseTag(body: string): Action | null {
  const t = tokenize(body);
  if (!t) return null;
  const { name, args, quotes, flags } = t;
  const quote = quotes[0]?.trim() || undefined;

  // Tags without a target.
  switch (name) {
    case 'clear': return { kind: 'clear' };
    case 'sketch': {
      const sid = id(args.id);
      const page = num(args.near?.replace(/^p/i, ''));
      const size = (args.size ?? 'm').toLowerCase();
      const place = (args.place ?? 'auto').toLowerCase();
      if (!sid || page === undefined || page < 1 || !Number.isInteger(page)) return null;
      if (size !== 's' && size !== 'm' && size !== 'l') return null;
      if (place !== 'auto' && place !== 'right' && place !== 'left' && place !== 'below') return null;
      return { kind: 'sketch', id: sid, page, size, place };
    }
    case 'emph':
    case 'fade': {
      const ref = id(args.id);
      return ref ? { kind: name, ref } : null;
    }
    case 'move': {
      const ref = id(args.id), to = pt(args.to, 1000); // clamped to the element's own space when it runs
      return ref && to ? { kind: 'move', ref, to } : null;
    }
    case 'connect': {
      const near = pt(args.near, 1000);
      const from = end(args.from, near), to = end(args.to, near);
      if (!from || !to || ('page' in from) === ('page' in to)) return null; // one page end, one region end
      return { kind: 'connect', from, to, ...(id(args.id) ? { id: id(args.id) } : {}) };
    }
    case 'label': {
      if (args.at === undefined && args.id !== undefined) {
        const ref = id(args.id);
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
  const mark = { ...(id(args.id) ? { id: id(args.id) } : {}), ...(flags.has('em') ? { em: true } : {}) };
  const dash = flags.has('dash') ? { dash: true } : {};
  // Line hierarchy on stroked kinds: `weight=primary|secondary|faint`; anything else is malformed.
  const wRaw = args.weight?.toLowerCase();
  if (wRaw !== undefined && !WEIGHTS.has(wRaw as Weight)) return null;
  const weight = wRaw ? { weight: wRaw as Weight } : {};
  const outline = flags.has('outline') ? { outline: true } : {};
  const near = pt(args.near, Y);
  const anchor = quote ? { quote, ...(near ? { near } : {}) } : null;
  const at = pt(args.at, Y);
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
      return anchor ? { kind: name, ...target, ...anchor, ...(name === 'underline' ? weight : {}), ...mark } : null;
    case 'circle': {
      if (anchor) return { kind: 'circle', ...target, ...anchor, ...dash, ...weight, ...mark };
      const r = radii();
      return at && r ? { kind: 'circle', ...target, at, ...r, ...dash, ...weight, ...mark } : null;
    }
    case 'line':
    case 'arrow': {
      const from = pt(args.from, Y), to = pt(args.to, Y);
      return from && to ? { kind: name, ...target, from, to, ...dash, ...weight, ...mark } : null;
    }
    case 'box': {
      if (anchor) return { kind: 'box', ...target, ...anchor, ...weight, ...mark };
      const s = pair(args.size);
      if (!at || !s || !(s[0] > 0 && s[1] > 0)) return null;
      return { kind: 'box', ...target, at, w: Math.min(s[0], 1000 - at.x), h: Math.min(s[1], Y - at.y), ...weight, ...mark };
    }
    case 'label':
      return at && quote ? { kind: 'label', ...target, at, text: quote, ...mark } : null;
    case 'write':
      return inRegion && at && quote && textSize ? { kind: 'write', ...target, at, text: quote, size: textSize, ...mark } : null;
    case 'point': {
      const dir = args.dir?.toLowerCase();
      if (!at || (dir && !COMPASS.has(dir))) return null;
      return { kind: 'point', ...target, at, ...(quote ? { text: quote } : {}), ...(dir ? { dir: dir as Compass } : {}), ...mark };
    }
    case 'curve': {
      const p = pts(args.pts, Y, 2);
      return p ? { kind: 'curve', ...target, pts: p, ...dash, ...weight, ...mark } : null;
    }
    case 'shade': {
      const p = pts(args.pts, Y, 3);
      if (p) return { kind: 'shade', ...target, pts: p, ...outline, ...mark };
      const r = radii();
      return at && r ? { kind: 'shade', ...target, at, ...r, ...outline, ...mark } : null;
    }
    case 'angle': {
      const from = pt(args.from, Y), to = pt(args.to, Y), r = num(args.r);
      if (!at || !from || !to || (r !== undefined && !(r > 0))) return null;
      return { kind: 'angle', ...target, at, from, to, ...(r ? { r: Math.min(r, MAX_R) } : {}), ...(quote ? { text: quote } : {}), ...weight, ...mark };
    }
    case 'brace': {
      const from = pt(args.from, Y), to = pt(args.to, Y);
      return from && to ? { kind: 'brace', ...target, from, to, ...(quote ? { text: quote } : {}), ...weight, ...mark } : null;
    }
    case 'axes': {
      const s = pair(args.size);
      if (!inRegion || !at || !s || !(s[0] > 0 && s[1] > 0)) return null;
      return {
        kind: 'axes', ...target, at, w: Math.min(s[0], 1000 - at.x), h: Math.min(s[1], at.y),
        ...(args.x ? { xLabel: args.x } : {}), ...(args.y ? { yLabel: args.y } : {}), ...weight, ...mark,
      };
    }
    case 'plot': {
      const fn = args.fn?.trim(), domain = pair(args.domain), range = pair(args.range), axes = id(args.axes);
      if (!inRegion || !fn || fn.length > MAX_FN_CHARS || !domain || !(domain[1] > domain[0])) return null;
      if (range && !(range[1] > range[0])) return null;
      return { kind: 'plot', ...target, fn, domain, ...(range ? { range } : {}), ...(axes ? { axes } : {}), ...dash, ...weight, ...mark };
    }
    case 'math':
      return inRegion && at && quote && textSize ? { kind: 'math', ...target, at, tex: normalizeTex(quote), size: textSize, ...mark } : null;
    default:
      return null;
  }
}
