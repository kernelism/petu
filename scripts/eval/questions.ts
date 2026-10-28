// scripts/eval/questions.ts — question set v1: 24 questions over 12 founder PDFs, dev/test split.
// The split is fixed here and hashed (QSET). Editing any row changes QSET and fails the pin in
// tests/eval/questions.test.ts until the pin is updated on purpose. The test split is never used
// while tuning: see assertSplitAllowed. PDFs are read in place; this file holds only page numbers
// and the questions, never PDF content.
import { createHash } from 'node:crypto';

export type Split = 'dev' | 'test';
export type QType = 'derive' | 'why' | 'what-if' | 'compare' | 'point-at' | 'navigation' | 'ink' | 'follow-up' | 'off-topic';
export type Question = {
  id: string;
  split: Split;
  /** Deck id from scripts/eval/decks.ts. */
  deck: string;
  /** 1-based pdf.js page index. */
  page: number;
  pick: 'hand' | 'random';
  type: QType;
  /** Free-form tags for the quotas ('point', 'text'). */
  tags?: string[];
  question: string;
  /** Ink question: the runner first draws a loop around the page's largest labelled mark. */
  ink?: boolean;
  /** Follow-up question: a second turn on the same page. */
  followUp?: string;
};

const q = (id: string, deck: string, page: number, pick: Question['pick'], type: QType, question: string, extra: Partial<Question> = {}): Question =>
  ({ id, split: id.startsWith('T') ? 'test' : 'dev', deck, page, pick, type, question, ...extra });

export const QUESTIONS: Question[] = [
  q('D1', 'lec02', 36, 'hand', 'derive', 'Derive the thin lens equation from the similar triangles here.'),
  q('D2', 'lec02', 18, 'hand', 'why', 'Why do parallel lines on the ground meet at the horizon?'),
  q('D3', 'lec06', 28, 'hand', 'why', 'Why does a separable filter save so much computation?'),
  q('D4', 'lec07', 20, 'hand', 'why', 'Why is R negative on an edge?', { tags: ['point'] }),
  q('D5', 'lec09', 17, 'hand', 'what-if', 'What if this were a corner instead of a straight edge? Show me why that fixes it.'),
  q('D6', 'lec09', 26, 'hand', 'compare', 'What\'s the difference between the "Edge" and "Corner" regions in this plot?'),
  q('D7', 'hw2', 5, 'hand', 'navigation', 'What exactly do I have to hand in for this part?', { tags: ['text'] }),
  // D8-D14: seed 670 over lec02, lec05, lec06, lec07, lec09, hw1, hw2 (hand picks excluded),
  // written from the page-head text before any model output was seen.
  q('D8', 'lec05', 26, 'random', 'point-at', 'Point to the image made with the biggest window and tell me what changed compared to the smallest.'),
  q('D9', 'lec09', 25, 'random', 'ink', 'What is this?', { ink: true }),
  q('D10', 'lec07', 59, 'random', 'follow-up', 'What is a feature descriptor?', { followUp: 'So why compare descriptors instead of comparing the raw pixels?' }),
  q('D11', 'lec06', 42, 'random', 'what-if', 'What if I take fewer samples of this sine wave than it needs? Show me what goes wrong.'),
  q('D12', 'hw1', 2, 'random', 'why', 'Why do we need pictures under several light directions to recover the normals?'),
  q('D13', 'lec02', 10, 'random', 'point-at', 'Where is the pinhole in this picture, and where does the light go from there?'),
  q('D14', 'hw2', 6, 'random', 'off-topic', 'What laptop should I buy for this class?'),
  q('T1', 'lec08', 40, 'hand', 'why', 'Why does RANSAC start from a random minimal subset each time?'),
  q('T2', 'lec08', 28, 'hand', 'what-if', 'What happens to this square if the shear doubles? Show me.'),
  q('T3', 'lec03', 8, 'hand', 'why', 'Why does a matte surface look equally bright from every direction?'),
  q('T4', 'szeliski', 60, 'hand', 'compare', 'What does panel (c) show, and how is it different from (a)?', { tags: ['point'] }),
  q('T5', 'midterm-review', 3, 'hand', 'derive', 'Show me why a ray parallel to the axis passes through the focal point.'),
  // T6-T10: seed 670 over lec03, lec08, lec10, midterm-review, szeliski (hand picks excluded).
  q('T6', 'lec03', 35, 'random', 'why', 'Why does a red surface look so different under a single-color light?'),
  q('T7', 'midterm-review', 5, 'random', 'derive', 'Walk me through the filtering formula for one output pixel with a 3x3 box filter.'),
  q('T8', 'lec10', 30, 'random', 'point-at', 'Point to where the cameras are in this picture, and what they are all looking at.'),
  q('T9', 'lec08', 24, 'random', 'ink', 'What is this?', { ink: true }),
  q('T10', 'szeliski', 1220, 'random', 'navigation', 'Where does the book introduce matte reflection?', { tags: ['text'] }),
];

export const bySplit = (split: Split | 'both', qs: Question[] = QUESTIONS): Question[] =>
  split === 'both' ? qs : qs.filter((x) => x.split === split);

const stable = (v: unknown): string => JSON.stringify(v, (_k, val) =>
  val && typeof val === 'object' && !Array.isArray(val)
    ? Object.fromEntries(Object.entries(val as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : 1)))
    : val);

/** Content hash of the set (hex, 64 chars). */
export const qsetHash = (qs: Question[] = QUESTIONS): string => createHash('sha256').update(stable(qs)).digest('hex');
/** Version label used in runIds: `q1-<first 8 of the hash>`. */
export const QSET_VERSION = 'q1';
export const qsetId = (qs: Question[] = QUESTIONS): string => `${QSET_VERSION}-${qsetHash(qs).slice(0, 8)}`;
export const QSET = qsetId();

/** Sanity checks on the set itself (used by tests and by `freeze`). */
export function validateSet(qs: Question[]): string[] {
  const errs: string[] = [];
  const ids = new Set<string>();
  for (const x of qs) {
    if (ids.has(x.id)) errs.push(`duplicate id ${x.id}`);
    ids.add(x.id);
    if ((x.split === 'test') !== x.id.startsWith('T')) errs.push(`${x.id}: id prefix does not match split`);
    if (!x.question.trim()) errs.push(`${x.id}: empty question`);
    if (x.page < 1) errs.push(`${x.id}: bad page`);
  }
  const pages = new Map<string, string>();
  for (const x of qs) {
    const k = `${x.deck}:${x.page}`;
    if (pages.has(k)) errs.push(`${x.id} shares page ${k} with ${pages.get(k)}`);
    pages.set(k, x.id);
  }
  return errs;
}

/**
 * The test split is for the baseline (bake-off, once) and validation only. Tuning phases refuse it.
 * `testUsedBefore`: number of earlier runs that touched a test question (read from the eval dir).
 */
export function assertSplitAllowed(ids: string[], phase: string, testUsedBefore: number, qs: Question[] = QUESTIONS): void {
  const touchesTest = ids.some((id) => qs.find((x) => x.id === id)?.split === 'test');
  if (!touchesTest) return;
  if (phase === 'validate') return;
  if (phase === 'bakeoff' && testUsedBefore === 0) return;
  throw new Error(`the test split is held out: refusing to run it in phase "${phase}" (allowed: the one bake-off baseline, and validate)`);
}

/** Freeze the set into <evalDir>/questions.json. */
export async function freeze(evalDir: string): Promise<string> {
  const errs = validateSet(QUESTIONS);
  if (errs.length) throw new Error(errs.join('; '));
  const { mkdirSync, writeFileSync } = await import('node:fs');
  const { join } = await import('node:path');
  mkdirSync(evalDir, { recursive: true });
  const file = join(evalDir, 'questions.json');
  writeFileSync(file, JSON.stringify({ qset: QSET, hash: qsetHash(), questions: QUESTIONS }, null, 1));
  return file;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  console.log('wrote', await freeze(process.argv[2] ?? '.petu/eval'), QSET);
}
