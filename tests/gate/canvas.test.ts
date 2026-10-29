import { describe, expect, it } from 'vitest';
import { checkLayout, checkPageText, type El } from '../../src/gate/layout';

const el = (o: Partial<El> & Pick<El, 'id' | 'kind' | 'bbox'>): El => ({ boxes: [o.bbox], strokes: [], text: [], ...o });

describe('gate: the slide as canvas', () => {
  const lines = [{ x: 100, y: 100, w: 500, h: 14 }, { x: 100, y: 120, w: 500, h: 14 }];
  it('flags a page note that covers the page text, passes one beside it', () => {
    const over = el({ id: 'n1', kind: 'annot', page: 4, bbox: { x: 300, y: 102, w: 80, h: 12 }, text: [{ x: 300, y: 102, w: 80, h: 12 }] });
    const beside = el({ id: 'n2', kind: 'annot', page: 4, bbox: { x: 620, y: 102, w: 80, h: 12 }, text: [{ x: 620, y: 102, w: 80, h: 12 }] });
    const f = checkPageText([over, beside], (p) => (p === 4 ? lines : undefined));
    expect(f).toHaveLength(1);
    expect(f[0]).toMatchObject({ kind: 'covers-page-text', ids: ['n1'] });
    expect(checkPageText([over], () => undefined)).toEqual([]); // no grounding: nothing to check against
  });
  it('flags a lift outside its section', () => {
    const inside = el({ id: 'a', kind: 'lift', region: 's', bbox: { x: 200, y: 60, w: 500, h: 600 } });
    const below = el({ id: 'b', kind: 'lift', region: 't', bbox: { x: 200, y: 300, w: 500, h: 600 } });
    expect(checkLayout([inside], []).filter((f) => f.kind === 'lift-outside')).toEqual([]);
    expect(checkLayout([below], [])).toEqual([expect.objectContaining({ kind: 'lift-outside', ids: ['b'] })]);
  });
});
