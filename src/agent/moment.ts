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
 * offered on; the page of the marks taken with it; the tutor's focus page (`focus`: the page it last
 * steered to, which the indicator names: a glide that centred ink low on p7 can leave p8 the most
 * visible, and the question went out about p8 under an indicator saying 7); else the most visible page.
 */
export function askedPage(o: { point?: Pointed | null; check?: number | null; mark?: number | null; focus?: number | null; visible: number }): number {
  return o.point?.page ?? o.check ?? o.mark ?? o.focus ?? o.visible;
}

/**
 * The answer's home: the page it is spoken on from its first word. The asked page above is only where
 * the student was; the answer lives where its content is, the first page the scout teaches from (its
 * pages, in teaching order), and the asked page only when it is one of them, or when the student pinned
 * the question to it (pointed at it, drew on it, replies to a check offered on it). Was: the asked page,
 * always, until stage 2's first scroll: a question about p87 asked on the cover spoke its opening ~10 s
 * over the cover, labelled "Page 1", and the trail kept "p.1". Pure: the server's opener gate, the
 * two-stage stream's opening move and stage 2's context all decide it with this one rule.
 */
export function homePage(asked: number, pages: readonly number[], pinned = false): number {
  return pinned || !pages.length || pages.includes(asked) ? asked : pages[0];
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
/** A calc table's numbers in the computed tag's notation (rows with ";"), or null when there are none. */
type Nums = number | number[] | number[][];
const numsText = (v: Nums): string => typeof v === 'number' ? String(+v.toPrecision(6)) : Array.isArray(v[0]) ? (v as number[][]).map((r) => r.map((x) => +x.toPrecision(6)).join(',')).join(';') : (v as number[]).map((x) => +x.toPrecision(6)).join(',');

/**
 * The process on the board as it stands (teaching-engine Phase 2, "re-explain this step"): every calc's
 * numbers (the program's and an engine window's outputs, `conv.out`) and the step constants where they
 * are now. An aside runs on a board of its own, where these names do not resolve: it copies the numbers it
 * needs into a calc of its own.
 */
export function boardState(calcs: ReadonlyMap<string, Record<string, Nums>>, consts: Record<string, number>, max = 1200): string {
  const parts: string[] = [];
  for (const [id, t] of calcs) for (const [k, v] of Object.entries(t)) if (k !== 'n') parts.push(`${id}.${k}=${numsText(v)}`);
  const cs = Object.entries(consts).map(([k, v]) => `${k}=${+v.toPrecision(6)}`);
  if (!parts.length && !cs.length) return '';
  return clip([parts.length ? `computed: ${parts.join(' ')}` : '', cs.length ? `constants now: ${cs.join(' ')}` : ''].filter(Boolean).join('; '), max);
}

export function asideContext(o: { question: string; plan?: string; said: string; board: string[]; state?: string }): string {
  const lines = [`The paused answer was to: "${clip(words(o.question), 300)}"`];
  if (o.plan) lines.push(`Its plan: ${clip(words(o.plan), 1200)}`);
  const said = words(o.said);
  lines.push(`Said so far (it paused after the last word): "${said.length > 1200 ? `…${said.slice(-1200)}` : said}"`);
  if (o.board.length) lines.push(`On the board now: ${clip(o.board.join('; '), 1500)}`);
  if (o.state) lines.push(`Its numbers as they stand (the steps went this far; copy what you need into a calc of your own, the names do not carry over): ${o.state}`);
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
