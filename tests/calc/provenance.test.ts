import { describe, expect, it } from 'vitest';
import { dataNumbers, givenNumbers, isExample } from '../../src/calc/provenance';
import { readComputed, withCalcs } from '../../src/calc/stream';
import type { CalcResult } from '../../src/calc/prepare';
import { ScriptParser } from '../../src/script/parser';

async function* chunks(...parts: string[]) { for (const p of parts) yield p; }
const collect = async (src: AsyncIterable<string>) => { let s = ''; for await (const c of src) s += c; return s; };
const fake = async (id: string): Promise<CalcResult> => ({ id, values: { out: [1, 2, 3] } });

describe('example numbers (check (b), live)', () => {
  const page = 'The image patch is 10 12 14 16 and the kernel is 1 0 -1.';
  const given = givenNumbers([page], 'apply the kernel');

  it("a program's data is its lists of 3 or more numbers", () => {
    expect(dataNumbers('const f = [10, 12, 14, 16]; const k = [1, 0, -1]; const s = 2;')).toEqual([10, 12, 14, 16, 1, 0, -1]);
    expect(dataNumbers('const p = [3, 4];')).toEqual([]);
  });

  it("data from the page is the document's; made-up data is an example; a pure formula is neither", () => {
    expect(isExample('const f = [10, 12, 14, 16]; const k = [1, 0, -1];', given)).toBe(false);
    expect(isExample('const f = [3, 7, 2, 9, 5]; const k = [1, 0, -1];', given)).toBe(true);
    expect(isExample('export const T = 2 * Math.PI * Math.sqrt(6.37e6 / 9.8);', given)).toBe(false);
  });

  it('numbers the question gives count as given', () => {
    expect(isExample('const xs = [2, 5, 9];', givenNumbers([page], 'what if the signal is 2, 5, 9?'))).toBe(false);
  });

  it('an example calc carries src=example through the wire, and the parser keeps it', async () => {
    const out = await collect(withCalcs(chunks('<calc id="ex">const f = [3, 7, 2, 9, 5]; export const out = f;</calc> Then.'), fake, { given: () => given }));
    expect(out).toContain('{{computed id=ex out=1,2,3 src=example}}');
    const c = readComputed('computed id=ex out=1,2,3 src=example');
    expect(c).toEqual({ id: 'ex', values: { out: [1, 2, 3] }, example: true });
    const p = new ScriptParser();
    const actions = [...p.push(out), ...p.end()].flatMap((e) => (e.type === 'action' ? [e.action] : []));
    expect(actions.some((a) => a.kind === 'computed' && a.example)).toBe(true);
  });

  it("the document's data, or no page numbers to compare with, leaves the tag as it was", async () => {
    const ok = await collect(withCalcs(chunks('<calc id="f">const f = [10, 12, 14, 16];</calc>'), fake, { given: () => given }));
    expect(ok).not.toContain('src=example');
    const none = await collect(withCalcs(chunks('<calc id="f">const f = [3, 7, 2, 9];</calc>'), fake));
    expect(none).not.toContain('src=example');
  });
});

describe('example numbers with no page text', () => {
  it('nothing to judge by (no page read yet): never marked', async () => {
    const out = await collect(withCalcs(chunks('<calc id="f">const f = [3, 7, 2, 9];</calc>'), fake, { given: () => null }));
    expect(out).not.toContain('src=example');
  });
});

describe('example numbers: digits and fills', () => {
  it("a number's digits are that number; a list of one value is a fill, not data", () => {
    const code = 'const a = [4, 7, 8], b = [3, 5, 6]; const d = [0, 0, 0, 0];';
    expect(isExample(code, givenNumbers([], 'How does 478 + 356 work, with carrying?'))).toBe(false);
    expect(isExample(code, givenNumbers([], 'How does 512 + 109 work?'))).toBe(true);
    expect(dataNumbers('const z = [0, 0, 0];')).toEqual([]);
  });
});

describe('example numbers: ranges', () => {
  it("a kernel's coordinates and an index run are structure; a made-up row that counts from 1 is data", () => {
    expect(dataNumbers('const xs = [-2, -1, 0, 1, 2]; const i = [0, 1, 2, 3];')).toEqual([]);
    expect(dataNumbers('const row = [1, 2, 3, 4, 5];')).toEqual([1, 2, 3, 4, 5]);
  });
});
