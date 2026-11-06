import { describe, expect, it } from 'vitest';
import vm from 'node:vm';
import { CalcError, checkValues, pick, prepareCalc, stripComments } from '../../src/calc/prepare';
import { WORKER_SOURCE } from '../../src/calc/sandbox';

/** Runs a calc the way the worker does: the same lockdown script, in a fresh node realm. */
function run(id: string, src: string, ms = 500): Record<string, unknown> {
  const p = prepareCalc(id, src);
  let reply: { ok: boolean; values?: unknown; error?: string } | null = null;
  const ctx: Record<string, unknown> = { postMessage: (m: typeof reply) => { reply = m; }, navigator: {}, indexedDB: {}, caches: {} };
  ctx.self = ctx;
  vm.createContext(ctx);
  vm.runInContext(`self = this; ${WORKER_SOURCE}`, ctx);
  ctx.msg = { id: p.id, body: p.body };
  vm.runInContext('self.onmessage({ data: msg })', ctx, { timeout: ms });
  const r = reply as { ok: boolean; values?: unknown; error?: string } | null;
  if (!r) throw new Error('no reply');
  if (!r.ok) throw new CalcError(r.error ?? 'failed');
  return checkValues(id, structuredClone(r.values));
}

describe('calc programs', () => {
  it('computes the rod by slices', () => {
    const v = run('rod', `
      const M = 1, L = 1;
      // sum of x² dm, with the slice's middle as x
      const slices = n => { let I = 0; for (let i = 0; i < n; i++) { const x = -L/2 + (i + .5) * L/n; I += x*x * M/n; } return I; };
      export const I4 = slices(4), I10 = slices(10), I100 = slices(100);
      export const exact = M*L*L/12;`);
    expect(v.I4).toBeCloseTo(0.078125, 12);
    expect(v.I10).toBeCloseTo(0.0825, 12);
    expect(v.I100).toBeCloseTo(0.083325, 12);
    expect(v.exact).toBeCloseTo(1 / 12, 12);
  });

  it('computes a box, a Gaussian and a median over one row', () => {
    const v = run('row', `
      const r = [10,10,10,100,10,10,70,70,70,70];
      const win = (a, i) => [a[i-1], a[i], a[i+1]];
      const dot = (a, w) => a.reduce((s, x, k) => s + x * w[k], 0);
      const med = a => [...a].sort((x, y) => x - y)[1];
      const idx = [1,2,3,4,5,6,7,8];
      export const box = idx.map(i => dot(win(r, i), [1/3, 1/3, 1/3]));
      export const gauss = idx.map(i => dot(win(r, i), [1/4, 1/2, 1/4]));
      export const median = idx.map(i => med(win(r, i)));`);
    expect((v.box as number[]).map((x) => +x.toFixed(9))).toEqual([10, 40, 40, 40, 30, 50, 70, 70]);
    expect(v.gauss).toEqual([10, 32.5, 55, 32.5, 25, 55, 70, 70]);
    expect(v.median).toEqual([10, 10, 10, 10, 10, 70, 70, 70]);
  });

  it('computes the slide-33 patch', () => {
    const v = run('p', `
      const P = [[10,15,20],[23,90,27],[33,31,30]];
      const all = P.flat();
      export const box = all.reduce((s, x) => s + x, 0) / 9;
      export const median = [...all].sort((a, b) => a - b)[4];
      export const sharpen = 2 * P[1][1] - box;
      export { P };`);
    expect(v.box).toBe(31);
    expect(v.median).toBe(27);
    expect(v.sharpen).toBe(149);
    expect(pick(v as never, 'P[1][1]')).toBe(90);
  });

  it('the rest of the plan\'s fixtures (§6 Phase 1): raw difference, the patch\'s Gaussian, box5 boundary modes', () => {
    const v = run('fx', `
      const r = [10,10,10,100,10,10,70,70,70,70];
      export const diff = r.slice(1).map((x, i) => x - r[i]);
      const P = [[10,15,20],[23,90,27],[33,31,30]], G = [[1,2,1],[2,4,2],[1,2,1]];
      export const gauss = P.flat().reduce((s, x, i) => s + x * G.flat()[i], 0) / 16;
      const a = [10, 20, 30, 40];
      const at = (mode, i) => i >= 0 && i < a.length ? a[i] : mode === 'constant' ? 0 : mode === 'nearest' ? a[i < 0 ? 0 : a.length - 1] : mode === 'reflect' ? a[i < 0 ? -i - 1 : 2 * a.length - i - 1] : a[(i + a.length) % a.length];
      export const box5 = ['constant', 'nearest', 'reflect', 'wrap'].map(m => [-2, -1, 0, 1, 2].reduce((s, d) => s + at(m, d), 0) / 5);`);
    expect(v.diff).toEqual([0, 0, 90, -90, 0, 60, 0, 0, 0]);
    expect(v.gauss).toBe(40.3125);
    expect(v.box5).toEqual([12, 16, 18, 26]);
  });

  it('adds with carries', () => {
    const v = run('add', `
      const a = [4,7,8], b = [3,5,6];
      const cols = [], digits = []; let c = 0;
      for (let i = 2; i >= 0; i--) { const s = a[i] + b[i] + c; cols.unshift(s); digits.unshift(s % 10); c = Math.floor(s / 10); }
      export const sums = cols, sum = Number(digits.join('')) + c * 1000;`);
    expect(v.sums).toEqual([8, 13, 14]);
    expect(v.sum).toBe(834);
  });

  it('is deterministic: Math.random is seeded by the id, Date.now is fixed', () => {
    const src = 'export const r = [Math.random(), Math.random()], t = Date.now();';
    expect(run('a', src)).toEqual(run('a', src));
    expect(run('a', src).r).not.toEqual(run('b', src).r);
    expect(run('a', src).t).toBe(0);
  });

  it('an exported helper function is left out; the numbers still come back (live answer, 2026-11-05)', () => {
    const v = run('case', 'export const f = [10, 90, 10];\nexport const box = i => (f[i-1] + f[i] + f[i+1]) / 3;\nexport const b = box(1);');
    expect(v.b).toBeCloseTo(110 / 3, 12);
    expect('box' in v).toBe(false);
  });

  it('exports objects and traces', () => {
    const v = run('t', 'export const steps = [1,2,3].map(i => ({ i, sq: i * i }));');
    expect(pick(v as never, 'steps[2].sq')).toBe(9);
  });
});

describe('calc fences', () => {
  const refuse = (src: string, word: RegExp) => expect(() => prepareCalc('x', src)).toThrow(word);

  it('refuses the words an escape needs', () => {
    refuse('export const a = fetch("http://e")', /fetch/);
    refuse('export const a = import("http://e")', /import/);
    refuse('export const a = (() => 0).constructor("return 1")()', /constructor/);
    refuse('export const a = globalThis', /globalThis/);
    refuse('export const a = eval("1")', /eval/);
    refuse('export const a = [][\'__proto__\']', /__proto__/);
    refuse('export const a = `x`', /template/);
  });

  it('reads comments as words, not code', () => {
    expect(stripComments('const a = 1; // with this\n/* fetch */ const b = "//";')).toBe('const a = 1; \n  const b = "//";');
    expect(prepareCalc('x', '// weights with this\nexport const a = 1;').names).toEqual(['a']);
  });

  it('needs an export, and plain values', () => {
    refuse('const a = 1;', /exports nothing/);
    expect(() => run('x', 'export const f = 1, g = undefined;')).toThrow(/undefined/);
  });

  it('takes away the network and string evaluation even when a name is spelled around the check', () => {
    // Bracket access with a built string: the source check cannot see it, the lockdown must.
    expect(() => run('x', 'const k = "con" + "structor"; export const a = (() => 0)[k]("return 1")();')).toThrow(/not available/);
        expect(run('x', 'export const a = typeof navigator + typeof indexedDB + typeof caches;').a).toBe('undefinedundefinedundefined');
  });

  it('stops an endless loop', () => {
    expect(() => run('x', 'let i = 0; while (true) i++; export const a = i;', 100)).toThrow(/timed out|Script execution/);
  });

  it('a thrown error comes back as the reason', () => {
    expect(() => run('x', 'const a = []; export const b = a[0].c;')).toThrow(/undefined/);
  });
});

describe('the node runner (eval harness)', () => {
  it('runs a calc with the same lockdown, and stops an endless loop', async () => {
    const { runCalcNode } = await import('../../src/calc/node');
    expect((await runCalcNode('a', 'export const x = [1, 2].map(v => v * 21);')).values.x).toEqual([21, 42]);
    await expect(runCalcNode('b', 'let i = 0; while (true) i++; export const y = i;', 100)).rejects.toThrow(/calc b/);
  });
});
