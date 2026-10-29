import { describe, expect, it } from 'vitest';
import { ShadowStage } from '../../src/gate/shadow';
import { DEFAULTS } from '../../src/settings/settings';
import { parseTag } from '../../src/script/parseTag';
import type { RawAction } from '../../src/script/types';

const tag = (b: string) => parseTag(b) as RawAction;

describe('ShadowStage', () => {
  it('reports the real board’s skips offscreen and rebuilds to the accepted actions', async () => {
    const s = new ShadowStage({ desk: () => null, viewer: () => null, settings: () => DEFAULTS });
    const sk = tag('sketch id=s');
    const r1 = await s.apply([sk, tag('emph id=ghost')]);
    expect(r1.skipped.has(sk)).toBe(false);
    expect([...r1.skipped.values()].join()).toMatch(/ghost|unknown/);
    const dup = tag('sketch id=s');
    const r2 = await s.apply([dup]);
    expect(r2.skipped.get(dup)).toBe('duplicate region id');
    await s.rebuild([]);
    const again = tag('sketch id=s');
    expect((await s.apply([again])).skipped.has(again)).toBe(false);
    expect(document.querySelectorAll('[data-petu-shadow]').length).toBe(1);
    s.destroy();
    expect(document.querySelectorAll('[data-petu-shadow]').length).toBe(0);
  });
});
