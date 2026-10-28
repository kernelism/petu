import type { Action, Pt } from './types';

const clamp = (n: number) => Math.min(1000, Math.max(0, n));
const num = (s?: string) => (s === undefined || s === '' ? undefined : Number.isFinite(Number(s)) ? Number(s) : undefined);

function pt(s?: string): Pt | undefined {
  if (!s) return undefined;
  const parts = s.split(',');
  if (parts.length !== 2) return undefined;
  const [a, b] = parts.map(Number);
  return Number.isFinite(a) && Number.isFinite(b) ? { x: clamp(a), y: clamp(b) } : undefined;
}

/** Parses the inside of a `{{ ... }}` tag. Returns null for anything malformed. */
export function parseTag(body: string): Action | null {
  const q = body.match(/"([^"]*)"|“([^”]*)”/);
  const quote = q ? (q[1] ?? q[2] ?? '').trim() : undefined;
  const rest = q ? body.replace(q[0], ' ') : body;
  const [rawName, ...kv] = rest.trim().split(/\s+/).filter(Boolean);
  if (!rawName) return null;
  const name = rawName.toLowerCase();
  const args: Record<string, string> = {};
  for (const p of kv) {
    const i = p.indexOf('=');
    if (i > 0) args[p.slice(0, i).toLowerCase()] = p.slice(i + 1);
  }
  if (name === 'clear') return { kind: 'clear' };
  const page = num(args.p);
  if (!page || page < 1 || !Number.isInteger(page)) return null;
  const near = pt(args.near);
  const anchor = quote ? { quote, ...(near ? { near } : {}) } : null;

  switch (name) {
    case 'scroll': {
      const y = num(args.y);
      return y === undefined ? { kind: 'scroll', page } : { kind: 'scroll', page, y: clamp(y) };
    }
    case 'highlight':
      return anchor ? { kind: 'highlight', page, ...anchor } : null;
    case 'underline':
      return anchor ? { kind: 'underline', page, ...anchor } : null;
    case 'circle': {
      if (anchor) return { kind: 'circle', page, ...anchor };
      const at = pt(args.at);
      const r = num(args.r);
      const rx = num(args.rx) ?? r;
      const ry = num(args.ry) ?? r;
      if (!at || !rx || !ry || rx <= 0 || ry <= 0) return null;
      return { kind: 'circle', page, at, rx: Math.min(rx, 500), ry: Math.min(ry, 500) };
    }
    case 'line':
    case 'arrow': {
      const from = pt(args.from);
      const to = pt(args.to);
      if (!from || !to) return null;
      return name === 'line' ? { kind: 'line', page, from, to } : { kind: 'arrow', page, from, to };
    }
    case 'box': {
      if (anchor) return { kind: 'box', page, ...anchor };
      const at = pt(args.at);
      const size = args.size?.split(',').map(Number);
      if (!at || !size || size.length !== 2 || !size.every((n) => Number.isFinite(n) && n > 0)) return null;
      return { kind: 'box', page, at, w: Math.min(size[0], 1000 - at.x), h: Math.min(size[1], 1000 - at.y) };
    }
    case 'label': {
      const at = pt(args.at);
      return at && quote ? { kind: 'label', page, at, text: quote } : null;
    }
    default:
      return null;
  }
}
