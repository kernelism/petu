// server/prompt/repair.ts — the live gate's repair note (design 2026-10-29 "Live commit gate" §6).
// Appended as the last user message after stage 2's own request and the text it released so far: the
// model writes one replacement beat. Principles only, no per-subject wording; bump REPAIR_VERSION on any
// change (it is recorded with every repair in .petu/answers.jsonl).
import type { RepairReport } from '../../src/gate/events';
import { rawSvgScript } from '../../src/svgboard/wire';

export const REPAIR_VERSION = 'r2';
/** The scene report (ON THE BOARD NOW) is cut at this many characters. */
export const BOARD_CHARS = 1500;

const q = (s: string) => JSON.stringify(s);

/** ON THE BOARD NOW: the failed beat's section in full (id kind "label"), the others as counts; consts; finds. */
export function boardReport(r: Pick<RepairReport, 'board' | 'consts' | 'finds'>, max = BOARD_CHARS): string {
  const lines: string[] = [];
  for (const s of r.board) {
    if (s.items) lines.push(`${s.section}: ${s.items.length ? s.items.map((i) => `${i.id} ${i.kind}${i.label ? ` ${q(i.label)}` : ''}`).join('; ') : '(empty)'}`);
    else lines.push(`${s.section}: ${s.count} element${s.count === 1 ? '' : 's'}`);
  }
  const consts = Object.entries(r.consts ?? {});
  if (consts.length) lines.push(`consts: ${consts.map(([k, v]) => `${k}=${v}`).join(' ')}`);
  if (r.finds?.length) lines.push(`finds: ${r.finds.join(' ')}`);
  const out = lines.length ? lines.join('\n') : '(nothing yet)';
  return out.length > max ? `${out.slice(0, max - 1)}…` : out;
}

/** One line per problem: `check: detail` (+ the fix hint). */
const problemLine = (p: RepairReport['problems'][number]) => `- ${p.check}: ${p.detail}${p.hint ? ` (fix: ${p.hint})` : ''}`;

/** The note the model repairs from (r1; r2 changed only the svg note). */
export function repairNote(r: RepairReport): string {
  return [
    `GATE REPORT (${REPAIR_VERSION}). The beat below was NOT shown: none of it was said or drawn.`,
    `FAILED BEAT: ${r.beat}`,
    `PROBLEMS:\n${r.problems.length ? r.problems.map(problemLine).join('\n') : '- (none listed)'}`,
    `ON THE BOARD NOW:\n${boardReport(r)}`,
    `LATER BEATS USE: ${r.later.length ? r.later.join(', ') : '(nothing)'}`,
    `WRITE only the replacement beat, continuing right after "…${r.tail}". Same point, ≤ ${r.maxWords} words.`,
    'Fix every problem; use only ids listed or ones you create (create every id in LATER BEATS USE); every board number via {{val}};',
    "never clear, fade or move earlier ink; don't repeat what was said. If it can't be drawn with your tags, say the point",
    'plainly with no pointing words and no tags.',
  ].join('\n');
}

/**
 * The svg answer mode's note (r2-svg): the failed beat as the model wrote it (raw <g> groups), the
 * problems the gate found, and the board's groups so far; the replacement is a beat in the same format.
 * r2: the beat's group first, then its sentences (the order the prompt teaches, p6.8; r1 asked for the
 * words first), and a beat that drew keeps a drawing: the gate never releases its words without one
 * (src/gate/live.ts), so a plain-words replacement would be withheld anyway.
 */
export function svgRepairNote(r: RepairReport): string {
  return [
    `GATE REPORT (${REPAIR_VERSION}-svg). The beat below was NOT shown: none of it was said or drawn.`,
    `FAILED BEAT:\n${rawSvgScript(r.beat).trim()}`,
    `PROBLEMS:\n${r.problems.length ? r.problems.map(problemLine).join('\n') : '- (none listed)'}`,
    `ON THE BOARD NOW:\n${boardReport(r)}`,
    `WRITE only the replacement beat, continuing right after "…${r.tail}": its <g id="…"> group first (the same id unless the problem is the id), then the same point in ≤ ${r.maxWords} spoken words.`,
    'Fix every problem: write every formula with the constants and names on the board, move or shorten text so no text overlaps text or crosses a line, keep everything inside the BOARD viewBox, use an id not on the board.',
    "Never redraw or erase earlier groups; don't repeat what was said. Keep a drawing: if the group can't be fixed, draw less (a simpler group), never words alone.",
  ].join('\n');
}
