// @vitest-environment jsdom
// Check (f), conventions (src/gate/conventions.ts): the operation the words name, the numbers the slide prints.
import { describe, expect, it } from 'vitest';
import { conventionNotes, pageTables, viewsIn } from '../../src/gate/conventions';

// lec06 p22's text as pdf.js gives it.
const P22 = 'Constant factor at front makes volume sum to 1 (can be ignored when computing the fi lter values, as we should renormalize weights to sum to 1 in any case) Gaussian kernel 22 0.003 0.013 0.022 0.013 0.003 0.013 0.059 0.097 0.059 0.013 0.022 0.097 0.159 0.097 0.022 0.013 0.059 0.097 0.059 0.013 0.003 0.013 0.022 0.013 0.003 5 x 5, σ = 1 Source: C. Rasmussen';
const xs = [-2, -1, 0, 1, 2];
const G = xs.map((y) => xs.map((x) => Math.exp(-(x * x + y * y) / 2) / (2 * Math.PI)));
const pages = new Map([[22, P22]]);

describe('pageTables', () => {
  it('reads p22\'s 5x5 Gaussian table and its rounding', () => {
    const t = pageTables(22, P22);
    expect(t).toHaveLength(1);
    expect(t[0]).toMatchObject({ rows: 5, cols: 5, dp: 3 });
    expect(t[0].vals[12]).toBe(0.159);
  });
  it('a short run of small integers is a list, not a kernel', () => {
    expect(pageTables(1, 'a 2 x 2 example: 1 2 3 4')).toEqual([]);
  });
});

describe('conventionNotes', () => {
  it('a grid from the formula matches the slide; a normalised one is noted with the first difference', () => {
    expect(conventionNotes('', [{ id: 'gk', kind: 'grid', m: G }], pages)).toEqual([]);
    const sum = G.flat().reduce((a, b) => a + b, 0);
    const notes = conventionNotes('', [{ id: 'gk', kind: 'grid', m: G.map((r) => r.map((v) => v / sum)) }], pages);
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatch(/grid gk is 5x5 like the table on p22/);
  });
  it('the operation the words name must be the one the window does', () => {
    const k = [[1, 0, -1], [1, 0, -1], [1, 0, -1]];
    expect(conventionNotes('Convolution turns the kernel around', [{ id: 'conv', kind: 'window', m: k }], new Map())[0]).toMatch(/does not turn its kernel/);
    expect(conventionNotes('Convolution turns the kernel around', [{ id: 'conv', kind: 'window', m: k, flip: true }], new Map())).toEqual([]);
    expect(conventionNotes('cross-correlation slides it as it is', [{ id: 'c', kind: 'window', m: k, flip: true }], new Map())[0]).toMatch(/turns its kernel/);
    // Both named (a comparison) or neither: nothing to check.
    expect(conventionNotes('correlation versus convolution', [{ id: 'c', kind: 'window', m: k }], new Map())).toEqual([]);
  });
});

describe('viewsIn', () => {
  it('reads windows\' kernels and grids\' cells from the groups', () => {
    const v = viewsIn(['<g id="conv" data-slide="img.f" data-kernel="img.k" data-flip=""/><g id="gk" data-grid="g.G"/>'], () => [[1, 2], [3, 4]], (id) => (id === 'gk' ? [[5]] : null));
    expect(v).toEqual([{ id: 'conv', kind: 'window', m: [[1, 2], [3, 4]], flip: true }, { id: 'gk', kind: 'grid', m: [[5]] }]);
  });
});

// Through the live gate (as check (c) is in dataset.test.ts), with p22 as the answer's page.
import { GatePreflight } from '../../src/gate/live';

describe('check (f) in the gate', () => {
  const DATA = '{{computed id=img f=1,2,3,4;5,6,7,8;9,10,11,12 k=1,0,-1;1,0,-1;1,0,-1}}';
  const win = (flip: boolean) => `{{svg <g id="conv" data-const="k=0" data-slide="img.f" data-kernel="img.k"${flip ? ' data-flip=""' : ''} data-origin="20,40" data-cell="30"></g>}}`;
  const run = async (severity: 'default' | 'design', flip: boolean) => new GatePreflight({ severity, pages: () => pages }).check({ key: '0', kind: 'beat', text: ` {{svgboard w=560 h=600}} {{beat}} ${DATA} ${win(flip)} Convolution turns the kernel around before it slides. ` });

  it('a convolution that does not turn its kernel is noted by default, failed under design', async () => {
    const d = await run('default', false);
    expect(d.flags).toEqual([]);
    expect(d.notes.join('\n')).toMatch(/conventions: the words say convolution but window conv does not turn its kernel/);
    expect((await run('design', false)).flags.map((f) => f.check)).toEqual(['conventions']);
    expect((await run('design', true)).flags).toEqual([]);
  });
});
