// src/agent/moment.ts
/**
 * The moment a question is asked in (spec "v1 learner UX"), as context for stage 2 (AskContext
 * `aside`, `about`, `check`; the server turns each into one short note, server/openai.ts momentNotes).
 * Pure, so it is testable: nothing here knows a subject or a phrasing.
 */

/** What the student pointed at before asking (point-to-ask): the chip on the bar, and its context. */
export type Pointed =
  | { kind: 'selection'; page: number; text: string }
  | { kind: 'selection'; page?: undefined; board: true; text: string }
  | { kind: 'circle'; page: number; bbox: { x: number; y: number; w: number; h: number }; text: string }
  | { kind: 'circle'; page?: undefined; board: true; elements: string[]; text: string };

import { readTag, tagsOf } from './context/memory';

/**
 * The one page a question is about, decided when it is sent (C5). Every consumer gets this value (the
 * scout request and its opener filter, the visible listing and image, the ink crop, the director's
 * default page, the trail and memory), never currentPage()/pageRef read again later. In order: what the
 * student pointed at (a selection or circle on a page); for a check reply, the page the check was
 * offered on; the page of the marks taken with it; else the most visible page (`visible`).
 */
export function askedPage(o: { point?: Pointed | null; check?: number | null; mark?: number | null; visible: number }): number {
  return o.point?.page ?? o.check ?? o.mark ?? o.visible;
}

/**
 * The page a check question is about: the last page its answer pointed at or scrolled to (the page in
 * frame when it was offered), else the page the answer was asked on. A reply to it is asked on that
 * page, wherever the student has scrolled since (a reply about p12 went out with p6: recorded a28).
 */
export function checkPageOf(script: string, asked: number): number {
  let page = asked;
  for (const t of tagsOf(script)) {
    if (/^\s*svg\b/.test(t.inner)) continue;
    const g = readTag(t.inner), p = Number(g.args.p);
    if (g.args.p != null && g.args.on == null && Number.isInteger(p) && p >= 1) page = p;
  }
  return page;
}

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);
const words = (s: string) => s.replace(/\s+/g, ' ').trim();

/** The chip's label: a few words of what was selected or circled ("shaded triangle"), else what it was. */
export function pointedLabel(p: Pointed): string {
  const t = words(p.text);
  if (t) {
    const w = t.split(' ');
    return clip(w.length > 5 ? `${w.slice(0, 5).join(' ')}…` : t, 36);
  }
  if (p.kind === 'circle' && 'elements' in p && p.elements.length) return clip(p.elements.slice(0, 2).join(', '), 36);
  return p.kind === 'circle' ? 'circled region' : 'selection';
}

/** The `about` context: where it is, and what it says or covers. */
export function aboutContext(p: Pointed): string {
  const t = clip(words(p.text), 1200);
  if (p.kind === 'selection') return p.page != null ? `The student selected this text on page ${p.page}: "${t}"` : `The student selected this text on the board: "${t}"`;
  if (p.page != null) {
    const b = p.bbox, R = Math.round;
    return `The student circled a region of page ${p.page} (x ${R(b.x)}–${R(b.x + b.w)}, y ${R(b.y)}–${R(b.y + b.h)} of 1000)${t ? `; the text inside: "${t}"` : '; no text inside it'}. Their ink on the page is listed under STUDENT INK.`;
  }
  return `The student circled part of the board covering: ${p.elements.length ? p.elements.join(', ') : 'nothing drawn'}${t ? `; the text inside: "${t}"` : ''}.`;
}

/**
 * The `aside` context: the paused answer as the student has it so far: its plan (if the scout gave
 * one), the words said up to the pause (the last ~1200 characters), and what is on the board.
 */
export function asideContext(o: { question: string; plan?: string; said: string; board: string[] }): string {
  const lines = [`The paused answer was to: "${clip(words(o.question), 300)}"`];
  if (o.plan) lines.push(`Its plan: ${clip(words(o.plan), 1200)}`);
  const said = words(o.said);
  lines.push(`Said so far (it paused after the last word): "${said.length > 1200 ? `…${said.slice(-1200)}` : said}"`);
  if (o.board.length) lines.push(`On the board now: ${clip(o.board.join('; '), 1500)}`);
  return lines.join('\n');
}

/** A stroke closes on itself (a loop around something): its start and end meet within 25% of its length. */
export function isLoop(pts: { x: number; y: number }[]): boolean {
  if (pts.length < 6) return false;
  let len = 0;
  for (let i = 1; i < pts.length; i++) len += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
  const a = pts[0], b = pts[pts.length - 1];
  const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
  const span = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
  return len > 40 && span > 12 && Math.hypot(a.x - b.x, a.y - b.y) <= 0.25 * len;
}

export function bboxOf(pts: { x: number; y: number }[]): { x: number; y: number; w: number; h: number } {
  const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
  const x = Math.min(...xs), y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
}
