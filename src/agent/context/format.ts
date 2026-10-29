// src/agent/context/format.ts
import { formatMarks } from './marks.ts';
import { formatCharts } from './charts.ts';
import type { PageGround } from './types';

const shape = (aspect: number) => (Math.abs(aspect - 0.5625) < 0.03 ? '16:9 slide' : Math.abs(aspect - 0.75) < 0.03 ? '4:3 slide' : aspect > 1.2 ? 'portrait page' : 'page');
export const lineText = (l: { id: string; rect: { x: number; y: number; w: number }; text: string; math: boolean }) =>
  `${l.id} ${Math.round(l.rect.y)} ${Math.round(l.rect.x)}–${Math.round(l.rect.x + l.rect.w)}${l.math ? ' math' : ''}: ${l.text}`;

/** The visible page block's budget (a dense page's lines are cut with "…"; the marks stay). */
export const VISIBLE_TOKENS = 6000;
const VISIBLE_CHARS = VISIBLE_TOKENS * 3.3;

/** The visible page: header, lines (none when the text layer is unusable), marks. */
export function formatVisible(g: PageGround): string {
  return formatPage(g, { visible: true, image: true });
}

/**
 * A page's full listing (lines and figure marks). The visible page says so; another page says
 * whether its image is attached. `maxChars` cuts a dense page's lines with "…" (the marks stay).
 */
export function formatPage(g: PageGround, o: { visible?: boolean; image: boolean; maxChars?: number }): string {
  const what = (g.noText ? 'no extractable text: point with marks, or by coordinates inside images' : o.image ? 'image attached' : 'listing only, no image')
    + (g.mathOutlines ? '; its equations are drawn as outlines: they are missing from the lines and appear only in the image (#e boxes)' : '');
  const head = `PAGE ${g.page} (${o.visible ? 'visible; ' : ''}${shape(g.aspect)}; ${what})`;
  const marks = [formatMarks(g.marks), g.charts?.length ? formatCharts(g.charts) : ''].filter(Boolean).join('\n');
  const lines: string[] = [];
  const max = o.maxChars ?? VISIBLE_CHARS;
  let n = head.length + marks.length + 4;
  for (const l of g.noText ? [] : g.lines) {
    const s = lineText(l);
    if (n + s.length + 1 > max) { lines.push('…'); break; }
    lines.push(s);
    n += s.length + 1;
  }
  return [head, ...lines, marks].filter(Boolean).join('\n');
}
/** A neighbour: lines only, cut to `maxChars`. */
export function formatNeighbour(g: PageGround, maxChars: number): string {
  const out = [`PAGE ${g.page} (text only)`];
  if (g.noText) return out.join('\n');
  let n = out[0].length;
  for (const l of g.lines) { const s = lineText(l); if (n + 1 + s.length > maxChars) { out.push('…'); break; } out.push(s); n += s.length + 1; }
  return out.join('\n');
}

/** Rough token count of a listing (~3.3 characters per token on these listings). */
export const estimateTokens = (s: string) => Math.ceil(s.length / 3.3);
