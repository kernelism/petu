// src/ink/agent/tokens.ts
/**
 * Design tokens the ink reads at draw time (src/styles/tokens.css is the source). The fallbacks
 * mirror tokens.css, for tests (jsdom loads no CSS) and for a document without the stylesheet.
 */
const FALLBACK: Record<string, string> = {
  '--ink': '#1D1D1F',
  '--ink-2': '#3A3A3C',
  '--muted': '#6E6E73',
  '--ink-w-primary': '2',
  '--ink-w-secondary': '1.25',
  '--ink-w-faint': '1',
  '--ink-faint-opacity': '0.7',
  '--ink-dot-r': '3',
  '--ink-connector-w': '1.25',
  '--shade-sheet': '#F7F6F2',
  '--shade-line': '#8E8E93',
  '--shade-tint': '0.1',
  '--ink-label-weight': '450',
  '--font-math': 'KaTeX_Math, KaTeX_Main, "Times New Roman", serif',
};

/** A token's value (trimmed), or its fallback. */
export function token(name: string): string {
  let v = '';
  try { v = typeof document !== 'undefined' ? getComputedStyle(document.documentElement).getPropertyValue(name).trim() : ''; } catch { v = ''; }
  return v || FALLBACK[name] || '';
}
/** A numeric token (`2px` → 2). */
export function tokenNum(name: string): number {
  const n = parseFloat(token(name));
  return Number.isFinite(n) ? n : parseFloat(FALLBACK[name] ?? '0');
}
