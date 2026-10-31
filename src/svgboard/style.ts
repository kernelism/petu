// src/svgboard/style.ts — the board's palette and type for the model's SVG (pure: no DOM).
/**
 * The model draws with whatever colours and fonts it likes; the board keeps its structure and
 * normalises its styling: greys and blacks become the board's ink tiers, near-white stays paper, the
 * answer's first chromatic hue becomes the tutor's accent (settings ink, violet by default) and every
 * other hue a neutral grey (one accent per board: founder rule), light tints keep their lightness as
 * a tint of their new colour.
 */
export const INK = { ink: '#1D1D1F', ink2: '#3A3A3C', muted: '#6E6E73', faint: '#8E8E93', line: '#D9D6CF', sheet: '#F7F6F2', paper: '#FFFFFE' } as const;
export const FONT_SANS = '-apple-system, BlinkMacSystemFont, "SF Pro Text", "Inter", system-ui, sans-serif';
/**
 * The board's text face: a figure in a textbook, not app chrome. Source Serif 4 (bundled, src/main.tsx)
 * sits with the KaTeX math italic of the symbols and has tabular lining figures for values. It does not
 * set narrower than the gate's sans estimates (check.ts textEm) across the board: measured from the
 * bundled font, capitals run ~5-11% wider at opsz 20 (HOMO 3.10em vs 2.80 estimated) and, at the
 * 12-16px optical sizes board labels get, lowercase runs wider too (Demand +7-11%); only digits and
 * spaced lowercase at opsz 20 come in under. The estimates were not retuned for it: the gate's box
 * inset (core()) absorbs most of it, and a capitalised label may run a little past what it cleared.
 */
export const FONT_FIGURE = '"Source Serif 4 Variable", "Source Serif 4", Georgia, serif';
export const FONT_MATH = 'KaTeX_Math, KaTeX_Main, "Times New Roman", serif';

export type Rgb = { r: number; g: number; b: number; a: number };

const NAMED: Record<string, string> = {
  black: '#000000', white: '#ffffff', red: '#ff0000', green: '#008000', blue: '#0000ff', orange: '#ffa500', purple: '#800080',
  gray: '#808080', grey: '#808080', darkgray: '#a9a9a9', darkgrey: '#a9a9a9', lightgray: '#d3d3d3', lightgrey: '#d3d3d3', silver: '#c0c0c0',
  dimgray: '#696969', dimgrey: '#696969', navy: '#000080', teal: '#008080', crimson: '#dc143c', steelblue: '#4682b4', royalblue: '#4169e1',
  darkred: '#8b0000', darkblue: '#00008b', darkgreen: '#006400', gold: '#ffd700', yellow: '#ffff00', brown: '#a52a2a', pink: '#ffc0cb',
  magenta: '#ff00ff', cyan: '#00ffff', tomato: '#ff6347', coral: '#ff7f50', firebrick: '#b22222', seagreen: '#2e8b57', indigo: '#4b0082',
  violet: '#ee82ee', tan: '#d2b48c', beige: '#f5f5dc', ivory: '#fffff0', whitesmoke: '#f5f5f5', gainsboro: '#dcdcdc', slategray: '#708090',
  lightblue: '#add8e6', lightgreen: '#90ee90', lightyellow: '#ffffe0', lavender: '#e6e6fa', salmon: '#fa8072', olive: '#808000', maroon: '#800000',
};

export function parseColor(v: string | null | undefined): Rgb | null {
  if (!v) return null;
  const s = v.trim().toLowerCase();
  if (!s || s === 'none' || s === 'transparent' || s.startsWith('url(') || s === 'currentcolor' || s === 'inherit') return null;
  const hex = NAMED[s] ?? s;
  let m = /^#([0-9a-f]{3,8})$/.exec(hex);
  if (m) {
    let h = m[1];
    if (h.length === 3 || h.length === 4) h = h.split('').map((c) => c + c).join('');
    if (h.length !== 6 && h.length !== 8) return null;
    return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16), a: h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1 };
  }
  m = /^rgba?\(\s*([\d.]+)%?[\s,]+([\d.]+)%?[\s,]+([\d.]+)%?(?:[\s,/]+([\d.]+%?))?\s*\)$/.exec(s);
  if (m) {
    const a = m[4] == null ? 1 : m[4].endsWith('%') ? parseFloat(m[4]) / 100 : parseFloat(m[4]);
    return { r: +m[1], g: +m[2], b: +m[3], a };
  }
  m = /^hsla?\(\s*([\d.]+)(?:deg)?[\s,]+([\d.]+)%[\s,]+([\d.]+)%(?:[\s,/]+([\d.]+%?))?\s*\)$/.exec(s);
  if (m) {
    const [r, g, b] = hslToRgb(+m[1], +m[2] / 100, +m[3] / 100);
    const a = m[4] == null ? 1 : m[4].endsWith('%') ? parseFloat(m[4]) / 100 : parseFloat(m[4]);
    return { r, g, b, a };
  }
  return null;
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const k = (n: number) => (n + h / 30) % 12, a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [Math.round(f(0) * 255), Math.round(f(8) * 255), Math.round(f(4) * 255)];
}

/** Hue (deg), saturation and lightness (0–1). */
export function hsl(c: Rgb): { h: number; s: number; l: number } {
  const r = c.r / 255, g = c.g / 255, b = c.b / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2, d = max - min;
  if (d < 1e-6) return { h: 0, s: 0, l };
  const s = d / (1 - Math.abs(2 * l - 1));
  const h = max === r ? 60 * (((g - b) / d) % 6) : max === g ? 60 * ((b - r) / d + 2) : 60 * ((r - g) / d + 4);
  return { h: (h + 360) % 360, s, l };
}

/** The answer's palette: which hue became the accent (the first chromatic one seen). */
export type Palette = { accent: string; hue: number | null };


/**
 * One colour value → the board's. `role`: a stroke or text keeps a readable ink; a fill keeps its
 * lightness as an opacity of the new colour (a pale wash stays pale). Returns the colour and an
 * opacity factor to multiply into the element's own (1 = unchanged).
 */
export function mapColor(v: string | null | undefined, role: 'stroke' | 'fill' | 'text', pal: Palette): { color: string; alpha: number } | null {
  const c = parseColor(v);
  if (!c) return null;
  const { h, s, l } = hsl(c);
  const a = c.a;
  const chroma = s * (1 - Math.abs(2 * l - 1));
  // Paper: near-white stays the board's paper (a backing behind a label, a light card).
  if (l > 0.94 && (chroma < 0.08 || l > 0.97)) return { color: INK.paper, alpha: a };
  if (chroma < 0.12) {
    // Neutral: the ink tiers.
    if (role === 'fill' && l > 0.8) return { color: INK.sheet, alpha: a };
    // Text never goes lighter than the muted tier (≥ 4.5:1 on the paper); strokes may be faint.
    const color = l < 0.3 ? INK.ink : l < 0.5 ? INK.ink2 : l < 0.7 || role === 'text' ? INK.muted : role === 'fill' ? INK.line : INK.faint;
    return { color, alpha: a };
  }
  // Chromatic: colour means time on the board (grammar.ts), never the model's hue. At rest a coloured
  // mark is ink (the accent is the part being drawn: render.ts data-live); a pale wash stays a wash
  // of ink, a pale outline a hairline.
  if (pal.hue == null) pal.hue = h;
  if (role === 'fill' && l > 0.72) {
    const k = Math.max(0.1, Math.min(0.3, (1 - l) * 1.2));
    return { color: INK.muted, alpha: a * k };
  }
  if (role === 'stroke' && l > 0.72) return { color: INK.line, alpha: a };
  return { color: role === 'fill' ? INK.ink2 : INK.ink, alpha: a };
}

/** The board's font for a model font-family: math-ish faces → the math font, everything else the figure face. */
export function mapFont(family: string | null | undefined): string {
  const f = (family ?? '').toLowerCase();
  if (/katex|math|cambria|times|georgia|(^|[\s,"'])serif/.test(f) && !/sans-serif/.test(f)) return FONT_MATH;
  return FONT_FIGURE;
}

/** A model stroke width (user units, default 1) → the board's tiers in CSS px (non-scaling strokes). */
export function mapStrokeWidth(w: number | null): number {
  const v = w == null || !Number.isFinite(w) ? 1 : w;
  return v <= 1.5 ? 1.25 : v <= 3 ? 2 : 3;
}
