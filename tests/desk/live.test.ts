// tests/desk/live.test.ts — live geometry on the board: drawn once, then updated in place as constants change.
import { describe, it, expect } from 'vitest';
import { Registry } from '../../src/desk/registry';
import { liveGeo } from '../../src/desk/live';
import { kitStore } from '../../src/desk/kit/kit';
import { Figures } from '../../src/geometry/resolve';
import { parseTag } from '../../src/script/parseTag';
import type { Action, RawAction } from '../../src/script/types';
import type { BuildEnv, TargetCtx } from '../../src/desk/types';

const SVG = 'http://www.w3.org/2000/svg';

describe('LiveGeo', () => {
  it('moves the same path and dot each time a constant changes, and traces the point', async () => {
    const reg = new Registry();
    const store = kitStore(reg);
    store.defineConsts([['th', '0'], ['R', '100']]);
    const figs = new Figures({ mark: () => undefined }, () => store.consts);
    const acts = ['let on=k O=500,350 S=500+R*cos(th),350-R*sin(th)', 'line on=k from=O to=S', 'point on=k at=S "S" trace'].map((t) => parseTag(t) as RawAction);
    acts.forEach((a) => figs.note(a));
    const layer = document.createElementNS(SVG, 'g') as SVGGElement;
    const ctx = { target: { region: 'k' }, layers: { agent: layer }, h: 700, scale: () => 1, toSpace: (p: { x: number; y: number }) => p } as unknown as TargetCtx;
    const env = { ctx: async () => ctx, registry: reg, settings: { inkStyle: 'clean' } } as unknown as BuildEnv;
    // As the toolkit leaves them once drawn: a line's group holds its path, a point's its dot.
    const lg = layer.appendChild(document.createElementNS(SVG, 'g')) as SVGGElement;
    const path = lg.appendChild(document.createElementNS(SVG, 'path'));
    reg.define({ id: 'ln', kind: 'line', target: { region: 'k' }, bbox: { x: 0, y: 0, w: 0, h: 0 }, boxes: [], anchor: { x: 0, y: 0 }, group: lg });
    const pg = layer.appendChild(document.createElementNS(SVG, 'g')) as SVGGElement;
    const dot = pg.appendChild(document.createElementNS(SVG, 'circle'));
    reg.define({ id: 'pt', kind: 'point', target: { region: 'k' }, bbox: { x: 0, y: 0, w: 0, h: 0 }, boxes: [], anchor: { x: 0, y: 0 }, group: pg });
    const live = liveGeo(reg);
    const res = (a: RawAction, id: string) => () => { const r = figs.resolve(a); return r && typeof r === 'object' ? ({ ...r, id } as Action) : r; };
    await live.add('ln', acts[1], res(acts[1], 'ln'), env);
    await live.add('pt', acts[2], res(acts[2], 'pt'), env);
    expect(path.getAttribute('d')).toMatch(/^M500\.00 350\.00 .*L600\.00 350\.00$/);
    store.setConst('th', Math.PI / 2); store.constsChanged();
    expect(lg.querySelector('path')).toBe(path); // the same ink, moved: never erased and redrawn
    expect(path.getAttribute('d')).toMatch(/L500\.00 250\.00$/);
    expect(dot.getAttribute('cy')).toBe('250');
    expect(reg.get('pt')!.anchor).toEqual({ x: 500, y: 250 });
    const trace = layer.querySelector('path[data-trace]')!;
    expect(trace.getAttribute('d')).toMatch(/^M600\.00 350\.00 L500\.00 250\.00$/);
    // A frame where it no longer resolves keeps the last state.
    delete store.consts.th; store.constsChanged();
    expect(dot.getAttribute('cy')).toBe('250');
  });
});
