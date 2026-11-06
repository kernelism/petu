// Page-image pixels put into the answer ahead of the window that reads them (src/pixels/stream.ts).
import { describe, expect, it } from 'vitest';
import { pixelAsks, pxId, runPixelsIn, withPixels, type PixelSource } from '../../src/pixels/stream';
import { readComputed } from '../../src/calc/stream';

const F = [[1, 2], [3, 4]];
const calls: string[] = [];
const read: PixelSource = async (mark, cols, page) => { calls.push(`${page ?? '-'} ${mark} ${cols}`); if (mark === '#i9') throw new Error('page 3 has no image #i9'); return F; };
const collect = async (chunks: string[]) => { let s = ''; for await (const c of withPixels((async function* () { yield* chunks; })(), read)) s += c; return s; };

describe('withPixels', () => {
  it('puts the table before the svg tag, once per answer; other text passes as it is', async () => {
    calls.length = 0;
    const svg = '{{svg <g id="eye" data-slide="#i1" data-kernel="b.k"/>}}';
    const out = await collect(['Look. ', svg, ' Then ', svg.replace('eye', 'eye2'), ' done.']);
    expect(out).toBe(`Look. {{computed id=px_i1_24 f=1,2;3,4}} ${svg} Then ${svg.replace('eye', 'eye2')} done.`);
    expect(calls).toEqual(['- #i1 24']);
    expect(readComputed(out.slice(out.indexOf('{{') + 2, out.indexOf('}}')))?.values.f).toEqual(F);
  });

  it('holds an svg tag split across chunks until it closes', async () => {
    const out = await collect(['a {{s', 'vg <g data-slide="#i2" data-px="8" data-p', 'age="5"/>}', '} b']);
    expect(out).toBe('a {{computed id=px_p5_i2_8 f=1,2;3,4}} {{svg <g data-slide="#i2" data-px="8" data-page="5"/>}} b');
  });

  it('an image that cannot be read gets a failed table (the board then says why)', async () => {
    const out = await runPixelsIn('{{svg <g data-slide="#i9"/>}}', read);
    expect(out).toMatch(/^\{\{computed id=px_i9_24 failed="page 3 has no image #i9"\}\} \{\{svg/);
  });

  it('leaves calc windows and plain svg alone', async () => {
    const t = 'x {{svg <g data-slide="img.f"/>}} {{svg <rect/>}} y';
    expect(await runPixelsIn(t, read)).toBe(t);
  });
});

describe('pixelAsks', () => {
  it('reads the columns (capped at 40) and the page; ids name both', () => {
    expect(pixelAsks(`<g data-slide=' #i3 ' data-px="99"/><g data-slide="#i3" data-px="99"/>`)).toEqual([{ mark: '#i3', cols: 40 }]);
    expect(pxId({ mark: '#i3', cols: 40, page: 12 })).toBe('px_p12_i3_40');
  });
});
