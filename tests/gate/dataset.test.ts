// @vitest-environment jsdom
// Check (c), one dataset (teaching-engine §3.6): engine windows that compare operators slide over one input.
import { describe, expect, it } from 'vitest';
import { GatePreflight } from '../../src/gate/live';

const DATA = '{{computed id=img f=1,2,3,4;5,6,7,8;9,10,11,12 g=4,3,2,1;8,7,6,5;12,11,10,9}}';
const slide = (id: string, inp: string, op: string) => `{{svg <g id="${id}" data-const="${id}k=0" data-slide="${inp}" data-op="${op}" data-size="3x3" data-step="${id}k" data-origin="20,${id === 'a' ? 40 : 300}" data-cell="30"></g>}}`;

async function run(severity: 'default' | 'design', second: string) {
  const pre = new GatePreflight({ severity });
  const u1 = { key: '0', kind: 'beat' as const, text: ` {{svgboard w=560 h=600}} {{beat}} ${DATA} ${slide('a', 'img.f', 'mean')} The mean window slides over the image. ` };
  const r1 = await pre.check(u1);
  pre.accept(u1);
  const u2 = { key: '1', kind: 'beat' as const, text: ` {{beat}} ${slide('b', second, 'median')} The median window slides over it too. ` };
  return { r1, r2: await pre.check(u2) };
}

describe('one dataset', () => {
  it('a second window over another input is noted by default, failed under the design table', async () => {
    const d = await run('default', 'img.g');
    expect(d.r1.flags).toEqual([]);
    expect(d.r2.flags).toEqual([]);
    expect(d.r2.notes.join('\n')).toMatch(/dataset: a window slides over img\.g, an earlier one over img\.f/);
    const s = await run('design', 'img.g');
    expect(s.r2.flags.map((f) => f.check)).toEqual(['dataset']);
  });

  it('the same input is fine', async () => {
    const d = await run('design', 'img.f');
    expect(d.r2.flags).toEqual([]);
    expect(d.r2.notes.join('\n')).not.toMatch(/dataset/);
  });
});
