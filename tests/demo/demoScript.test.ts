// tests/demo/demoScript.test.ts
import { describe, it, expect, vi, afterEach } from 'vitest';
import { ScriptParser } from '../../src/script/parser';
import {
  DEMO_SCRIPT, DEMO_SIDE_SCRIPT, DEMO_PLANE_SCRIPT, DEMO_QUESTION, DEMO_SIDE_QUESTION, DEMO_PLANE_QUESTION, pickDemo,
} from '../../src/demo/demoScript';
import { SCRIPTS } from '../../src/demo/scripts';
import type { Action, Pt, RawAction } from '../../src/script/types';
import type { GroundMark } from '../../src/geometry/resolve';

afterEach(() => vi.restoreAllMocks());

function parseAll(script: string): Action[] {
  // Demo scripts use only literal coordinates: their raw actions are plain actions.
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  const p = new ScriptParser();
  const events = [...p.push(script), ...p.end()];
  expect(warn).not.toHaveBeenCalled();
  return events.flatMap((e) => (e.type === 'action' ? [e.action as Action] : []));
}
const em = (as: Action[]) => as.filter((a) => 'em' in a && a.em).map((a) => a.kind);
const ALL = [DEMO_SCRIPT, DEMO_SIDE_SCRIPT, DEMO_PLANE_SCRIPT, ...Object.values(SCRIPTS).map((x) => x.script)];

const look = (a: Action) => ('weight' in a ? a.weight : undefined);

describe('DEMO_SCRIPT (PDF only)', () => {
  it('stays on the page and builds in beats, ending on the slide\'s takeaway', () => {
    const as = parseAll(DEMO_SCRIPT);
    expect(as.map((a) => a.kind)).toEqual(['scroll', 'circle', 'line', 'highlight', 'line', 'line', 'label', 'highlight', 'emph']);
    expect(as.some((a) => a.kind === 'sketch' || ('region' in a && a.region))).toBe(false);
    const payoff = as.at(-2);
    expect(payoff?.kind === 'highlight' && payoff.quote).toContain('search becomes 1-D');
  });
  it('clips the ray inside image 1 and shows C′ looking at it with one faint sight line', () => {
    const [ray, sight] = parseAll(DEMO_SCRIPT).filter((a) => a.kind === 'line');
    expect(ray).toMatchObject({ weight: 'secondary', to: { x: 307, y: 362 } }); // image 1's top edge, not the bullets
    expect(sight).toMatchObject({ dash: true });
    expect(look(sight)).toBeUndefined(); // dash → faint by default
  });
  it('labels and re-traces l′ by id', () => {
    const as = parseAll(DEMO_SCRIPT);
    expect(as.find((a) => a.kind === 'label')).toMatchObject({ ref: 'lp', text: 'l′' });
    expect(as.at(-1)).toEqual({ kind: 'emph', ref: 'lp' });
  });
});

describe('DEMO_SIDE_SCRIPT (C)', () => {
  it('opens the board for page 3 with a normal section, early in the stream', () => {
    const as = parseAll(DEMO_SIDE_SCRIPT);
    expect(as.find((a) => a.kind === 'sketch')).toEqual({ kind: 'sketch', id: 'side', page: 3, size: 'm' });
    expect(DEMO_SIDE_SCRIPT.indexOf('{{sketch')).toBeLessThan(160);
  });
  it('connects the slide\'s x to the sketch\'s x', () => {
    expect(parseAll(DEMO_SIDE_SCRIPT).find((a) => a.kind === 'connect')).toEqual({
      kind: 'connect', from: { page: 3, at: { x: 305, y: 459 } }, to: { region: 'side', ref: 'x' },
    });
  });
  it('draws and labels both images, then re-traces image 2 in accent as l′', () => {
    const as = parseAll(DEMO_SIDE_SCRIPT);
    expect(as.filter((a) => a.kind === 'label').map((a) => a.kind === 'label' && a.text)).toEqual(['image 1', 'image 2', 'l′']);
    const im2 = as.find((a) => 'id' in a && a.id === 'im2'), lp = as.find((a) => 'id' in a && a.id === 'lp');
    expect(im2?.kind === 'line' && lp?.kind === 'line').toBe(true);
    if (im2?.kind === 'line' && lp?.kind === 'line') expect([lp.to, lp.from]).toEqual([im2.from, im2.to]); // same segment, traced inner end last
  });
  it('draws the ray secondary and the sight lines faint', () => {
    const lines = parseAll(DEMO_SIDE_SCRIPT).filter((a) => a.kind === 'line');
    expect(lines.filter((a) => look(a) === 'secondary')).toHaveLength(1);
    expect(lines.filter((a) => a.kind === 'line' && a.dash)).toHaveLength(3);
  });
  it('spreads the hits along l′: ≥ 100 units apart and ≥ 200 from C′', () => {
    const hits = parseAll(DEMO_SIDE_SCRIPT).flatMap((a) => (a.kind === 'point' && a.em ? [a.at] : []));
    expect(hits).toHaveLength(3);
    for (let i = 1; i < hits.length; i++) expect(Math.hypot(hits[i].x - hits[i - 1].x, hits[i].y - hits[i - 1].y)).toBeGreaterThan(100);
    for (const h of hits) expect(Math.hypot(h.x - 840, h.y - 668)).toBeGreaterThan(200);
  });
  it('accents only the takeaway: l′, its label, where the sight lines land, and the payoff', () => {
    expect(em(parseAll(DEMO_SIDE_SCRIPT))).toEqual(['line', 'label', 'point', 'point', 'point', 'write']);
  });
  it('ends on the written payoff', () => {
    const last = parseAll(DEMO_SIDE_SCRIPT).at(-1);
    expect(last?.kind === 'write' && last.text).toBe('x′ must be on l′');
  });
});

describe('DEMO_PLANE_SCRIPT (B)', () => {
  it('circles x in the first sentence and takes the stage right after it', () => {
    const first = DEMO_PLANE_SCRIPT.indexOf('. ');
    expect(DEMO_PLANE_SCRIPT.indexOf('{{circle')).toBeLessThan(first);
    expect(DEMO_PLANE_SCRIPT.indexOf('{{sketch')).toBe(first + 2);
    expect(parseAll(DEMO_PLANE_SCRIPT).find((a) => a.kind === 'sketch')).toMatchObject({ size: 'l' });
  });
  it('outlines and labels the image planes and tints the plane as the takeaway', () => {
    const as = parseAll(DEMO_PLANE_SCRIPT);
    const shades = as.filter((a) => a.kind === 'shade');
    expect(shades.map((a) => a.kind === 'shade' && (a.outline ? 'outline' : a.em ? 'em' : 'plain'))).toEqual(['outline', 'outline', 'em']);
    expect(as.filter((a) => a.kind === 'write').map((a) => a.kind === 'write' && a.text).slice(0, 2)).toEqual(['image 1', 'image 2']);
    expect(as.filter((a) => look(a) === 'secondary')).toHaveLength(2); // the rays to X
    expect(em(as)).toEqual(['shade', 'line', 'label', 'write']);
  });
});

describe('lec09 (C, near vs far)', () => {
  const as = () => parseAll(SCRIPTS.lec09.script);
  it('sketches only the comparison: no cameras, baseline, f or retyped formula', () => {
    // math only sets the row labels; the slide's formula is circled on the page, never retyped
    expect(as().flatMap((a) => (a.kind === 'math' ? [a.tex] : []))).toEqual(['z', '2z']);
    expect(as().filter((a) => a.kind === 'brace').map((a) => a.kind === 'brace' && a.text)).toEqual(['x − x′', 'half']);
  });
  it('accents only the far brace, and points at the slide\'s own formula and line', () => {
    expect(em(as())).toEqual(['brace']);
    const page = as().filter((a) => 'page' in a && a.page === 40 && a.kind !== 'scroll' && a.kind !== 'sketch').map((a) => a.kind);
    expect(page).toEqual(['box', 'circle', 'highlight']);
    const last = as().at(-1);
    expect(last?.kind === 'highlight' && last.quote).toBe('Disparity is inversely proportional to depth.');
  });
  it('lines the two offsets up on one centre, the far one half as long', () => {
    const [near, far] = as().filter((a) => a.kind === 'brace');
    if (near.kind !== 'brace' || far.kind !== 'brace') throw new Error('braces');
    expect((near.from.x + near.to.x) / 2).toBe((far.from.x + far.to.x) / 2);
    expect(Math.abs(far.from.x - far.to.x) * 2).toBe(Math.abs(near.from.x - near.to.x));
  });
});

describe('toolkit', () => {
  it('exercises every weight and every shade look', () => {
    const as = parseAll(SCRIPTS.toolkit.script);
    expect(new Set(as.map(look).filter(Boolean))).toEqual(new Set(['secondary', 'faint']));
    expect(as.filter((a) => a.kind === 'shade').map((a) => a.kind === 'shade' && (a.outline ? 'outline' : a.em ? 'em' : 'plain'))).toEqual(['plain', 'outline', 'em']);
  });
});

describe('every script', () => {
  it('parses with no warnings', () => {
    for (const s of ALL) expect(parseAll(s).length).toBeGreaterThan(5);
  });
  it('never stacks two tags on one word', () => {
    for (const s of ALL) expect(s).not.toMatch(/\}\}\s*\{\{/);
  });
  it('only draws into declared regions (no cap on how many)', () => {
    for (const s of ALL) {
      const as = parseAll(s);
      const ids = as.flatMap((a) => (a.kind === 'sketch' ? [a.id] : []));
      for (const a of as) if ('region' in a && a.region) expect(ids).toContain(a.region);
    }
  });
  it('defines every id before referencing it', () => {
    for (const s of ALL) {
      const seen = new Set<string>();
      for (const a of parseAll(s)) {
        // a kit part (o[1,2]) or a table column (t.c) names its block
        // a bound number may also name a constant, a readout's field (E.x) or a tokens state (coins.tax)
        const r = a as unknown as RawAction; if (r.kind === 'const') for (const [k] of r.defs) seen.add(k);
        if ('ref' in a) expect(seen, `${a.kind} ${a.ref}`).toContain(a.ref.replace(/\[.*$|\.[A-Za-z]\w*$/, ''));
        if (a.kind === 'connect') for (const e of [a.from, a.to]) if ('ref' in e) expect(seen).toContain(e.ref.replace(/\[.*$/, ''));
        if ('id' in a && a.id && a.kind !== 'sketch') seen.add(a.id);
      }
    }
  });
});

describe('pickDemo', () => {
  it('matches typed questions by word overlap, defaulting to the PDF demo', () => {
    expect(pickDemo(DEMO_SIDE_QUESTION).question).toBe(DEMO_SIDE_QUESTION);
    expect(pickDemo('can you sketch the SIDE view').question).toBe(DEMO_SIDE_QUESTION);
    expect(pickDemo('show the epipolar plane').question).toBe(DEMO_PLANE_QUESTION);
    expect(pickDemo('why only a line?').question).toBe(DEMO_QUESTION);
    expect(pickDemo('hello').question).toBe(DEMO_QUESTION);
  });
});

describe('demos through the resolver', () => {
  it('every demo and dev script resolves to the very objects it parsed (byte-identical playback)', async () => {
    const { Figures } = await import('../../src/geometry/resolve');
    // `relational` is literal-free by design (it shows the agent grammar): checked on its own below.
    // `canvas` draws on its slides' own charts and lifts their marks: checked against its grounding in canvasDemo.test.ts.
    const all = { DEMO_SCRIPT, DEMO_SIDE_SCRIPT, DEMO_PLANE_SCRIPT, ...Object.fromEntries(Object.entries(SCRIPTS).filter(([k]) => k !== 'relational' && k !== 'canvas').map(([k, v]) => [k, v.script])) };
    for (const [name, script] of Object.entries(all)) {
      const raw = parseAll(script);
      const f = new Figures({ mark: () => undefined });
      raw.forEach((a) => f.note(a));
      for (const a of raw) expect(f.resolve(a), `${name}: ${a.kind}`).toBe(a);
    }
  });
});

describe('relational (agent grammar on the fixture, no API call)', () => {
  // The fixture p3 marks, as scripts/ground.ts lists them.
  const marks: Record<string, GroundMark> = {
    '#d1': { kind: 'dot', at: { x: 238, y: 813 } }, '#d2': { kind: 'dot', at: { x: 713, y: 813 } }, '#d3': { kind: 'dot', at: { x: 290, y: 473 } },
    '#g2': { kind: 'figure', rect: { x: 588, y: 348, w: 225, h: 268 } },
  };
  const resolved = async () => {
    const { Figures } = await import('../../src/geometry/resolve');
    const raw = parseAll(SCRIPTS.relational.script) as unknown as RawAction[];
    const f = new Figures({ mark: (page, id) => (page === 3 ? marks[id] : undefined) });
    raw.forEach((a) => f.note(a));
    return { raw, out: raw.map((a) => f.resolve(a)), fig: f.figure({ region: 's' }) };
  };
  it('uses let, meet, along, through, fit and page marks #d1 / #d3, with no literal geometry in the sketch', async () => {
    const s = SCRIPTS.relational.script;
    for (const k of ['{{let ', 'meet(', 'along(', 'through=', ' fit}}', 'mark=#d1', 'mark=#d3']) expect(s).toContain(k);
    const { raw } = await resolved();
    // Sketch elements name points (no x,y literals); only the let defines coordinates.
    for (const a of raw.filter((a) => 'region' in a && a.region === 's' && a.kind !== 'let')) expect(JSON.stringify(a)).not.toMatch(/"x":/);
  });
  it('resolves every action (nothing skipped), with the whole figure inside its frame', async () => {
    const { out, fig } = await resolved();
    expect(out.filter((o) => typeof o === 'string')).toEqual([]);
    expect(fig.outOfFrame).toBe(0);
  });
  it('rays pass through their points and image points sit on their rays', async () => {
    const { out } = await resolved();
    const acts = out.filter((o): o is Action => !!o && typeof o !== 'string');
    const ray = acts.find((a) => a.kind === 'line' && a.id === 'ray') as Extract<Action, { kind: 'line' }>;
    const x = acts.find((a) => a.kind === 'point' && a.id === 'x') as Extract<Action, { kind: 'point' }>;
    const cross = (a: Pt, b: Pt, p: Pt) => ((b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x)) / Math.hypot(b.x - a.x, b.y - a.y);
    expect(Math.abs(cross(ray.from, ray.to, x.at))).toBeLessThan(0.5);
    const far = acts.find((a) => a.kind === 'point' && a.id === 'X2') as Extract<Action, { kind: 'point' }>;
    expect(Math.abs(cross(ray.from, ray.to, far.at))).toBeLessThan(0.5);
  });
});
