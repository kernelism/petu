// tests/desk/sceneRelabel.test.ts — evidence C2 / C12 / rows 6, 10 of the draw benchmark (2026-10-29):
// a link and a kit block take a new label in place ("once drawn is drawn": a visible change, never an
// erase); emph where= on bars with readouts as variables; an engine plot in a scene is placed by the
// scene; note / pair in a plain sketch. Scripts are the benchmark's verbatim tags.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { buildElement } from '../../src/desk/elements';
import { Registry } from '../../src/desk/registry';
import { DEFAULTS } from '../../src/settings/settings';
import { ScriptParser } from '../../src/script/parser';
import { sceneStore } from '../../src/desk/scene/store';
import { kitStore } from '../../src/desk/kit/kit';
import type { BuildEnv, DeskApi, SceneClaim, SceneSpace, TargetCtx } from '../../src/desk/types';
import type { InkAction, RawAction, Target } from '../../src/script/types';
import type { SRect } from '../../src/geometry/space';

const SVG = 'http://www.w3.org/2000/svg';
const g = () => document.createElementNS(SVG, 'g') as SVGGElement;

function space(): SceneSpace {
  const claims: SceneClaim[] = [];
  return {
    claim(r: SRect, minor?: 'label' | 'line') {
      const c: SceneClaim = { r, minor, move(n) { c.r = n; }, drop() { claims.splice(claims.indexOf(c), 1); } };
      claims.push(c);
      return c;
    },
    rects: (o) => (o?.lines === false ? claims.filter((c) => c.minor !== 'line') : claims).map((c) => c.r),
    view: () => ({ x: 0, y: 0, w: 1000, h: 700 }),
    last: () => claims.filter((c) => !c.minor).at(-1)?.r ?? null,
    extent: () => null,
  };
}

function env(scene = true) {
  const layers = { highlight: g(), agent: g() };
  const sc = scene ? space() : undefined;
  const ctx = (t: Target): TargetCtx => ({ target: t, layers, h: 700, scale: () => 0.6, body: () => 16, toSpace: (p) => p, rectToSpace: (r) => r, runs: async () => [], ...(sc ? { scene: sc } : {}) });
  const desk = { growRegion: vi.fn(), centreRegion: vi.fn(), addConnector: vi.fn() } as unknown as DeskApi;
  const e: BuildEnv = { ctx: async (t) => ctx(t), registry: new Registry(), settings: DEFAULTS, rng: () => null, desk };
  return { e, layers, sc };
}

async function play(e: BuildEnv, script: string) {
  const p = new ScriptParser();
  const skips: string[] = [];
  for (const x of [...p.push(script), ...p.end()]) {
    if (x.type !== 'action') continue;
    const a = x.action as RawAction;
    if (a.kind === 'sketch' || a.kind === 'scroll' || a.kind === 'highlight' || a.kind === 'const' || a.kind === 'val') continue;
    if (a.kind === 'find') { kitStore(e.registry).finds.set(a.id, a); continue; }
    const plan = await buildElement(a as InkAction, e);
    if (typeof plan === 'string') { skips.push(`${a.kind}: ${plan}`); continue; }
    await plan.draw(new AbortController().signal, { speed: 1 });
  }
  e.registry.settle();
  return skips;
}

const area = (a: SRect, b: SRect) => Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
const texts = (el: Element | null | undefined) => [...(el?.querySelectorAll('text') ?? [])].map((t) => t.textContent);

describe('set "label" on a link (C2: the board never contradicts the narration)', () => {
  beforeEach(() => { vi.spyOn(window, 'matchMedia').mockReturnValue({ matches: true } as MediaQueryList); });
  afterEach(() => vi.restoreAllMocks());

  const TERRA_D2 = '{{scene id=coins near=p5}} Imagine the {{node on=coins id=buyer "buyer"}} buyer gives seven coins to the {{node on=coins id=seller "seller" right=buyer}}{{link on=coins id=payment from=buyer to=seller "7 coins"}} seller. ' +
    'Now the tax is added. {{set id=payment "8 coins"}} The buyer gives eight coins. {{node on=coins id=government "government" below=payment}}{{link on=coins from=payment to=government "2 coins"}} Two go to the government, {{set id=payment "8 coins paid; 6 to seller"}} leaving six for the seller.';

  it('terra D2 verbatim: every set lands, the arrow ends reading the new words', async () => {
    const { e } = env();
    const skips = await play(e, TERRA_D2);
    expect(skips).toEqual([]);
    const link = e.registry.get('payment')!;
    expect(texts(link.group)).toEqual(['8 coins paid; 6 to seller']);
  });

  it('the new label is placed again: clear of every thing and of the other label', async () => {
    const { e } = env();
    await play(e, TERRA_D2);
    const lbox = e.registry.get('payment')!.boxes.at(-1)!;
    // Measured for the new, longer words.
    expect(lbox.w).toBeGreaterThan(80);
    for (const id of ['buyer', 'seller', 'government']) expect(area(lbox, sceneStore(e.registry).get(id)!.rect), id).toBe(0);
  });

  it('opus-low / sol D2 verbatim: a short money label', async () => {
    const { e } = env();
    const skips = await play(e, '{{scene id=k near=p12}} {{node on=k id=kid "buyer"}} {{node on=k id=shop "seller" right=kid}} {{link on=k id=pay from=kid to=shop "$7"}} {{node on=k id=gov "government" below=pay}} {{set id=pay "$8"}}');
    expect(skips).toEqual([]);
    expect(texts(e.registry.get('pay')!.group)).toEqual(['$8']);
  });

  it('a link drawn without a label gets one', async () => {
    const { e } = env();
    const skips = await play(e, '{{scene id=k near=p1}} {{node on=k id=a "a"}} {{node on=k id=b "b" right=a}} {{link on=k id=l from=a to=b}} {{set id=l "pays"}}');
    expect(skips).toEqual([]);
    expect(texts(e.registry.get('l')!.group)).toEqual(['pays']);
  });
});

describe('set "label" on a kit block sets its caption (C2, opus-low-code D1)', () => {
  beforeEach(() => { vi.spyOn(window, 'matchMedia').mockReturnValue({ matches: true } as MediaQueryList); });
  afterEach(() => vi.restoreAllMocks());

  it('bars in a scene: the caption reads the new words, the old ones are gone', async () => {
    const { e } = env();
    const skips = await play(e, '{{scene id=pk near=p4}}{{bars on=pk id=occ vals=4,4,4 labels=S_in_pocket,I_in_pocket,empty "12 enzymes, [S] = 2"}} Take twelve enzymes. {{set id=occ "12 enzymes, [S] = 4"}} Now double the substrate. {{set id=occ "12 enzymes, [S] = 20"}} Flood it.');
    expect(skips).toEqual([]);
    const all = texts(kitStore(e.registry).get('occ')!.g);
    expect(all).toContain('12 enzymes, [S] = 20');
    expect(all).not.toContain('12 enzymes, [S] = 2');
    expect(all).not.toContain('12 enzymes, [S] = 4');
  });

  it('a block in a plain sketch too; one with no caption is told why', async () => {
    const { e } = env(false);
    const skips = await play(e, '{{sketch id=s near=p1}} {{bars on=s id=v vals=1,2 "before"}} {{set id=v "after"}} {{table on=s id=t cols=a,b vals=1,2}} {{set id=t "x"}}');
    expect(texts(kitStore(e.registry).get('v')!.g)).toContain('after');
    expect(texts(kitStore(e.registry).get('v')!.g)).not.toContain('before');
    expect(skips).toHaveLength(1);
    expect(skips[0]).toMatch(/no caption/);
  });
});

describe('emph where= on bars (row 6: the highlight matches the engine\'s own threshold)', () => {
  beforeEach(() => { vi.spyOn(window, 'matchMedia').mockReturnValue({ matches: true } as MediaQueryList); });
  afterEach(() => vi.restoreAllMocks());
  const em = (e: BuildEnv, id: string) => [...((kitStore(e.registry).get(id)!.el.bars as { emBars: Set<number> }).emBars)].sort();

  it('opus-low D11 verbatim: where="x>=0.7" on bars marks exactly the bars that satisfy it', async () => {
    const { e } = env(false);
    const skips = await play(e, '{{sketch id=s near=p1}} {{bars on=s id=te vals=0.45,0.7,0.85,0.3}} {{emph id=te where="x>=0.7"}}');
    expect(skips).toEqual([]);
    expect(em(e, 'te')).toEqual([1, 2]);
  });

  it('a calc result and a readout are variables in where', async () => {
    const { e } = env(false);
    const skips = await play(e, '{{sketch id=s near=p1}} {{bars on=s id=cal vals=0.2,0.4,0.1}} {{calc on=s id=q of=cal reduce=max}} {{bars on=s id=te vals=0.45,0.7,0.85,0.3 below=cal}} {{emph id=te where="x<=q"}}');
    expect(skips).toEqual([]);
    expect(em(e, 'te')).toEqual([3]);
    const { e: e2 } = env(false);
    const s2 = await play(e2, '{{sketch id=s near=p1}} {{plot on=s id=p fn="x" domain=0,1}} {{find id=h of=p x=0.6}} {{bars on=s id=te vals=0.45,0.7,0.85,0.3}} {{emph id=te where="x>=h"}}');
    expect(s2).toEqual([]);
    expect(em(e2, 'te')).toEqual([1, 2]);
  });

  it('a later where replaces the earlier marks', async () => {
    const { e } = env(false);
    await play(e, '{{sketch id=s near=p1}} {{bars on=s id=te vals=0.45,0.7,0.85,0.3}} {{emph id=te where="x>=0.7"}} {{emph id=te where="x<0.4"}}');
    expect(em(e, 'te')).toEqual([3]);
  });
});

describe('an engine plot in a scene is placed by the scene (row 10)', () => {
  beforeEach(() => { vi.spyOn(window, 'matchMedia').mockReturnValue({ matches: true } as MediaQueryList); });
  afterEach(() => vi.restoreAllMocks());

  it('it keeps clear of the chips already there and claims its room', async () => {
    const { e, sc } = env();
    const skips = await play(e, '{{scene id=s near=p4}} {{node on=s id=a "enzyme"}} {{node on=s id=b "substrate" right=a}} {{node on=s id=c "inhibitor" below=a}} {{plot on=s id=p fn="10*x/(2+x)" domain=0,20 "no inhibitor"}}');
    expect(skips).toEqual([]);
    const r = kitStore(e.registry).get('p')!.placed.rect;
    for (const id of ['a', 'b', 'c']) expect(area(r, sceneStore(e.registry).get(id)!.rect), id).toBe(0);
    expect(sc!.rects()).toContainEqual(r);
    expect(sceneStore(e.registry).get('p')).toBeTruthy();
  });
});

describe('note / pair in a plain sketch (C12)', () => {
  beforeEach(() => { vi.spyOn(window, 'matchMedia').mockReturnValue({ matches: true } as MediaQueryList); });
  afterEach(() => vi.restoreAllMocks());

  it('haiku D4 / sonnet D8 shapes: a callout and a bracket draw, inside the section, clear of the ink', async () => {
    const { e } = env(false);
    const skips = await play(e, '{{sketch id=r near=p1}} {{arrow on=r id=HB from=150,300 to=400,300}} {{arrow on=r id=CF from=850,300 to=600,300}} ' +
      '{{note on=r "uncompetitive: both intercept and slope move" annotate=HB}} {{pair on=r from=HB to=CF "equal and opposite pair"}}');
    expect(skips).toEqual([]);
    const notes = sceneStore(e.registry).ofKind('note');
    expect(notes).toHaveLength(1);
    const n = notes[0].rect;
    expect(n.x).toBeGreaterThanOrEqual(0);
    expect(n.y).toBeGreaterThanOrEqual(0);
    expect(n.x + n.w).toBeLessThanOrEqual(1000);
    expect(n.y + n.h).toBeLessThanOrEqual(700);
    for (const id of ['HB', 'CF']) expect(area(n, e.registry.get(id)!.bbox), id).toBe(0);
    expect(sceneStore(e.registry).ofKind('pair')).toHaveLength(1);
  });
});

describe('a note bound to a value refreshes after set (row 11)', () => {
  beforeEach(() => { vi.spyOn(window, 'matchMedia').mockReturnValue({ matches: true } as MediaQueryList); });
  afterEach(() => vi.restoreAllMocks());

  it('note value=w[2] shows the share the board shows, before and after a set', async () => {
    const { e } = env();
    const skips = await play(e, '{{scene id=b near=p4}} {{shares on=b id=w vals=1,1,1 labels=empty,ES,EI}} {{note on=b id=nt "ES now" value=w[2] annotate=w[2]}}');
    expect(skips).toEqual([]);
    expect(texts(e.registry.get('nt')!.group).join(' ')).toBe('ES now 33%');
    await play(e, '{{set id=w vals=1,2,1}}');
    await new Promise((r) => setTimeout(r, 50));
    expect(texts(e.registry.get('nt')!.group).join(' ')).toBe('ES now 50%');
    // The note's words can change too; its value stays after them.
    expect(await play(e, '{{set id=nt "ES with twice the substrate"}}')).toEqual([]);
    expect(texts(e.registry.get('nt')!.group).join(' ')).toBe('ES with twice the substrate 50%');
  });
});
