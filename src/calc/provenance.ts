// src/calc/provenance.ts — check (b), inputs (teaching-engine §3.6): is a calc's data the document's, or an
// example the model made up? A number the page or the question gives is data; a program whose numbers mostly
// are not on the pages in play is an example, and the student is told so ("Example numbers, not from your
// slides": §7 decision 4). The eval measures the same rule offline (scripts/eval/provenance.ts).
import { textNumbers } from '../gate/numbers';

/** A run of whole numbers that indexes or places something (`[-2, -1, 0, 1, 2]` a kernel's coordinates, `[0, 1, 2, 3]` indices): structure, not data. */
const isRange = (l: number[]): boolean => l.every((v, i) => Number.isInteger(v) && (i === 0 || v - l[i - 1] === 1)) && (l[0] === 0 || l[0] === -l[l.length - 1]);

/** A program's data lists: its array literals that hold 3 or more numbers (rows, lists), less fills (`[0, 0, 0]`: a start, not data) and index ranges. */
export function dataLists(code: string): number[][] {
  const out: number[][] = [];
  // Innermost brackets that hold only numbers: a row, a list.
  for (const m of code.matchAll(/\[([-\d.,\s/]+)\]/g)) {
    const vs = m[1].split(',').map((x) => x.trim()).filter(Boolean).map((x) => (x.includes('/') ? Number(x.split('/')[0]) / Number(x.split('/')[1]) : Number(x)));
    if (vs.length >= 3 && vs.every(Number.isFinite) && new Set(vs).size > 1 && !isRange(vs)) out.push(vs);
  }
  return out;
}

/** A program's data: the numbers of its data lists. */
export const dataNumbers = (code: string): number[] => dataLists(code).flat();

/** A list of digits that spells a given number (478 as [4, 7, 8]: a column sum's digits). */
const spells = (l: number[], given: Set<number>): boolean => l.every((d) => Number.isInteger(d) && d >= 0 && d <= 9) && given.has(Number(l.join('')));

/** Whether a calc's data is the document's (or the question's): at least half its distinct numbers are there. */
export function fromDocument(nums: number[], given: Set<number>): boolean {
  const distinct = [...new Set(nums)];
  return distinct.filter((v) => given.has(v)).length >= distinct.length / 2;
}

/** The numbers an answer may use as data: those in the page texts in play and in the question. */
export function givenNumbers(pages: Iterable<string>, question = ''): Set<number> {
  return new Set([...pages, question].flatMap((t) => textNumbers(t)));
}

/** Whether a program is an example: it has data, and most of it is not the document's. Programs without data (pure formulas) are not. */
export function isExample(code: string, given: Set<number>): boolean {
  const lists = dataLists(code);
  if (!lists.length) return false;
  const known = new Set(given);
  for (const l of lists) if (spells(l, given)) for (const d of l) known.add(d);
  return !fromDocument(lists.flat(), known);
}
