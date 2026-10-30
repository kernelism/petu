// @vitest-environment jsdom
// The svg answer mode end to end, offline: the model's raw beats (the prompt's own examples) → the
// server filter (wire tags) → the parser, the gate's splitter and checks, the scheduler's anchoring.
import { describe, expect, it } from 'vitest';
import { SvgBeatFilter, boardOf } from '../../server/svgBeats';
import { SVG_EXAMPLES } from '../../server/prompt/svgExamples';
import { ScriptParser } from '../../src/script/parser';
import { BeatSplitter, tokenize, units } from '../../src/gate/segment';
import { newScope } from '../../src/svgboard/data';
import { checkGroups, groupGeometry, newBoardState, acceptGroups, pathPolys, segHitsBox } from '../../src/svgboard/check';
import { namesWord } from '../../src/playback/scheduler';
import { anchorWords } from '../../src/script/parseTag';
import { completeSvg, rawSvgScript } from '../../src/svgboard/wire';
import type { RawAction } from '../../src/script/types';

const wire = (raw: string, step: number) => {
  const f = new SvgBeatFilter(() => 0);
  let out = '';
  for (let i = 0; i < raw.length; i += step) out += f.push(raw.slice(i, i + step));
  out += f.end();
  return { out, f };
};
const actions = (s: string): RawAction[] => { const p = new ScriptParser(); return [...p.push(s), ...p.end()].flatMap((e) => (e.type === 'action' ? [e.action] : [])); };

describe('svg beats: the server filter', () => {
  for (const ex of SVG_EXAMPLES) {
    it(`wire form is chunk-independent and lifts plan + groups (${ex.title.slice(0, 30)})`, () => {
      const a = wire(ex.script, 1000000).out;
      for (const step of [1, 3, 7, 50]) expect(wire(ex.script, step).out).toBe(a);
      const { f } = wire(ex.script, 5);
      // p6.1: the first sentence (page pointing, no drawing) plays before the board opens; no group before it.
      expect(a.indexOf('{{svgboard h=')).toBeGreaterThan(0);
      expect(a.indexOf('{{svgboard h=')).toBeLessThan(a.indexOf('{{svg <'));
      expect(a).not.toMatch(/<plan>|BOARD viewBox|```/);
      expect(f.plan).toMatch(/BOARD viewBox/);
      const groups = ex.script.match(/<g id="[^"]+"/g)!.map((g) => g.slice(7, -1));
      // Nested <g id> inside a group are part of it: the top-level ones are what the filter sends.
      expect(f.groups.length).toBeGreaterThanOrEqual(3);
      expect(groups).toEqual(expect.arrayContaining(f.groups));
      // No tag in the wire form has a newline or a brace inside.
      for (const m of a.matchAll(/\{\{svg ([\s\S]*?)\}\}/g)) expect(m[1]).not.toMatch(/[\n{}]/);
      const acts = actions(a);
      expect(acts.find((x) => x.kind === 'sketch')).toMatchObject({ kind: 'sketch', svgboard: { w: 1000 } });
      const svgs = acts.filter((x) => x.kind === 'svg');
      expect(svgs.map((x) => (x as { id?: string }).id)).toEqual(f.groups);
      // Narration survives intact (no SVG leaks into captions).
      const words = (() => { const p = new ScriptParser(); return [...p.push(a), ...p.end()].flatMap((e) => (e.type === 'word' ? [e.text] : [])); })();
      expect(words.join(' ')).not.toMatch(/<|\/>|stroke=|viewBox/);
      expect(words.length).toBeGreaterThan(40);
      // The repair note shows the model its own format back.
      expect(rawSvgScript(a)).toContain(`<g id="${f.groups[0]}"`);
    });

    it(`the gate's checks pass the examples (${ex.title.slice(0, 30)})`, () => {
      const a = wire(ex.script, 1e6).out;
      const acts = actions(a);
      const sb = acts.find((x) => x.kind === 'sketch') as Extract<RawAction, { kind: 'sketch' }>;
      const board = newBoardState(sb.svgboard!.w, sb.svgboard!.h);
      // One data scope for the answer (as the live gate keeps it): later groups read earlier constants, frames and curves.
      const scope = newScope();
      for (const g of acts.filter((x): x is Extract<RawAction, { kind: 'svg' }> => x.kind === 'svg')) {
        const r = checkGroups([g.svg], board, 16, scope);
        expect(r.flags, g.id).toEqual([]);
        acceptGroups(board, r.geos, r.grow);
      }
    });
  }

  it('drops wrappers, wraps a stray element, opens a default board without a plan', () => {
    const { out, f } = wire('```svg\n<svg viewBox="0 0 1000 700">\nThe arm swings out.\n<g id="arm"><line x1="0" y1="0" x2="10" y2="10" stroke="#000"/></g>\n<rect x="1" y="1" width="5" height="5"/>\n</svg>\n```\nDone.', 4);
    expect(out).toMatch(/^\{\{svgboard h=700\}\}|The arm/);
    expect(out).toContain('{{svg <g id="arm">');
    expect(out).toContain('{{svg <g><rect');
    expect(out).not.toMatch(/```|<svg|<\/svg>/);
    expect(f.groups).toEqual(['arm']);
  });

  it('keeps narration with a "<" in it, and closes a group cut off by the stream end', () => {
    const { out } = wire('<plan>BOARD viewBox="0 0 1000 900"</plan>When x < 3 it rises.\n<g id="up"><path d="M0 0 L5 5" stroke="red"/>', 2);
    expect(out).toContain('When x < 3 it rises.');
    expect(out).toContain('{{svgboard h=900}}');
    expect(out).toMatch(/\{\{svg <g id="up">.*<\/g>\}\}/);
  });

  it('reads the BOARD line', () => {
    expect(boardOf('x\nBOARD viewBox="0 0 1000 820"\nregions: …')).toEqual({ w: 1000, h: 820, extend: false });
    expect(boardOf('BOARD extend viewBox="0 0 1000 1200"')).toEqual({ w: 1000, h: 1200, extend: true });
    expect(boardOf('no board')).toBeNull();
  });
});

describe('svg beats: the gate splitter keeps a beat\'s group with its sentences', () => {
  const ex = SVG_EXAMPLES[0];
  const text = wire(ex.script, 1e6).out;
  it('sentence units: every group rides in a unit with words (p6.1: the group first, then its sentences)', () => {
    const us = units(text);
    for (const u of us) if (u.tags.some((t) => t.action?.kind === 'svg')) expect(u.words.length).toBeGreaterThan(0);
  });
  for (const mode of ['sentence', 'beat'] as const) {
    it(`incremental (${mode} mode) gives the stream back and never splits a group from its beat`, () => {
      for (const step of [1, 9, 80]) {
        const s = new BeatSplitter(mode);
        const out: string[] = [];
        for (let i = 0; i < text.length; i += step) out.push(...s.push(text.slice(i, i + step)).map((u) => u.text));
        out.push(...s.end().map((u) => u.text));
        expect(out.join('')).toBe(text);
        // A unit that starts with a group is that group alone (its sentences went out before it).
        for (const u of out.slice(1)) if (u.trimStart().startsWith('{{svg <')) expect(u.replace(/\{\{svg <[^}]*\}\}/g, '').trim()).toBe('');
        // p6.1: a beat's group comes before its sentences, so a group is never released after them (the
        // splitter may send it with the sentence before; the scheduler paces it across its own beat's words).
        const at = (id: string) => out.join('').indexOf(`<g id="${id}"`);
        expect(at('drift')).toBeLessThan(out.join('').indexOf('Point it straight'));
      }
    });
  }
  it('a sentence never waits for its group; the group goes out alone as soon as it closes', () => {
    const s = new BeatSplitter('sentence');
    expect(s.push('{{svgboard h=700}} The arm swings out.')).toEqual([]);
    expect(s.push(' ')).toHaveLength(1);
    expect(s.push('\n{{svg <g id="arm"><line x1="0" y1="0" x2="9" y2="9"')).toEqual([]);
    const u = s.push(' stroke="#000"/></g>}}');
    expect(u.map((x) => x.text)).toEqual([' \n{{svg <g id="arm"><line x1="0" y1="0" x2="9" y2="9" stroke="#000"/></g>}}']);
  });
});

describe('svg checks', () => {
  const G = (body: string) => `<g id="t">${body}</g>`;
  it('flags text on text, text across a line, out of the canvas, a reused id and bad XML', () => {
    const b = newBoardState(1000, 700);
    expect(checkGroups([G('<text x="100" y="100" font-size="20">first label</text><text x="110" y="104" font-size="20">second label</text>')], b).flags[0].detail).toMatch(/overlaps/);
    // Across groups a crossing fails; within one group the label is nudged off its own line (polish.ts)…
    const own = checkGroups([G('<line x1="50" y1="94" x2="400" y2="94" stroke="#000"/><text x="100" y="100" font-size="20">crossed</text>')], b);
    expect(own.flags).toEqual([]);
    expect(own.notes).toEqual([]);
    expect(Math.abs(own.geos[0].texts[0].y - (100 - 0.78 * 20))).toBeGreaterThan(3);
    // …and where no nearby spot is clear it only notes (the halo keeps it legible).
    const boxed = checkGroups([G('<path d="M60 70 H400 M60 84 H400 M60 94 H400 M60 104 H400 M60 118 H400 M60 130 H400 M90 40 V160 M180 40 V160" stroke="#000"/><text x="100" y="100" font-size="20">crossed</text>')], b);
    expect(boxed.flags).toEqual([]);
    expect(boxed.notes[0]).toMatch(/crosses text/);
    const b2 = newBoardState();
    acceptGroups(b2, checkGroups(['<g id="lab"><text x="100" y="100" font-size="20">crossed</text></g>'], b2).geos);
    expect(checkGroups(['<g id="ray"><line x1="50" y1="94" x2="400" y2="94" stroke="#000"/></g>'], b2).flags[0].detail).toMatch(/a line of ray crosses text "crossed" \(lab\)/);
    expect(checkGroups([G('<text x="980" y="100" font-size="20">far right</text>')], b).flags[0].detail).toMatch(/outside/);
    expect(checkGroups([G('<circle cx="10" cy="10" r="5" stroke="#000"/>'), G('<circle cx="40" cy="10" r="5"/>')], b).flags[0].detail).toMatch(/twice/);
    expect(checkGroups(['<g id="x"><line x1="0" y1="0"></g>'], b).flags[0].detail).toMatch(/parse/);
  });
  it('passes a label beside a line, and lets the bottom grow a little', () => {
    const b = newBoardState(1000, 700);
    expect(checkGroups([G('<line x1="50" y1="120" x2="400" y2="120" stroke="#000"/><text x="100" y="100" font-size="20">clear label</text>')], b).flags).toEqual([]);
    const r = checkGroups([G('<rect x="10" y="650" width="100" height="100" stroke="#000"/>')], b);
    expect(r.flags).toEqual([]);
    expect(r.grow).toBeGreaterThan(750);
  });
  it('text is measured at the board minimum (the renderer raises it)', () => {
    const b = newBoardState();
    const src = G('<text x="100" y="100" font-size="10">aaaa</text><text x="125" y="100" font-size="10">bbbb</text>');
    expect(checkGroups([src], b, 10).flags).toEqual([]);
    expect(checkGroups([src], b, 22).flags.length).toBeGreaterThan(0);
    // A list (one line under the other) is restacked when raised: its lines no longer collide.
    const list = G('<text x="100" y="100" font-size="10">aaaa</text><text x="100" y="116" font-size="10">bbbb</text>');
    const r = checkGroups([list], newBoardState(), 22);
    expect(r.flags).toEqual([]);
    expect(r.geos[0].texts[1].y).toBeGreaterThanOrEqual(r.geos[0].texts[0].y + 22);
  });
  it('geometry: transforms, tspans, paths', () => {
    const g = groupGeometry('<g id="a" transform="translate(100,50)"><text x="0" y="20" font-size="20" text-anchor="middle">ab<tspan x="0" dy="24">cd</tspan></text><path d="M0 0 C 10 0 20 10 20 20 Z" stroke="#000"/></g>');
    expect(g.texts.length).toBe(2);
    expect(g.texts[0].x).toBeLessThan(100);
    expect(g.texts[1].y).toBeGreaterThan(g.texts[0].y);
    expect(g.segs.length).toBeGreaterThan(8);
    expect(pathPolys('M0 0 h10 v10 z')[0]).toEqual([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 0 }]);
    expect(segHitsBox({ x: 0, y: 5 }, { x: 20, y: 5 }, { x: 5, y: 0, w: 5, h: 10 })).toBe(true);
    expect(segHitsBox({ x: 0, y: 50 }, { x: 20, y: 50 }, { x: 5, y: 0, w: 5, h: 10 })).toBe(false);
  });
});

describe('a group is drawn on the word that names it', () => {
  it('id words', () => {
    expect(anchorWords('arm-in')).toEqual(['arm', 'in']);
    expect(anchorWords('forceArrow')).toEqual(['force', 'arrow']);
    expect(namesWord('arms,', ['arm'])).toBe(true);
    expect(namesWord('Triangle’s', ['triangle'])).toBe(true);
    expect(namesWord('drifts', ['drift'])).toBe(true);
    expect(namesWord('the', ['arm'])).toBe(false);
  });
});

it('tokenize sees a wire group as one tag', () => {
  const t = tokenize('Look. {{svg <g id="a"><text x="1" y="2">5" wide</text></g>}} Next.');
  expect(t.filter((x) => x.kind === 'tag').length).toBe(1);
});

describe('follow-ups remember the svg board', () => {
  it('MEMORY lists the groups by id with their words, and the BOARD layout', async () => {
    const { recordOf, entryText } = await import('../../src/agent/context/memory');
    const ex = SVG_EXAMPLES[0];
    const { out, f } = wire(ex.script, 1e6);
    const r = recordOf({ question: ex.question, page: ex.page, pages: ex.pages, plan: ex.plan, script: out, answerPlan: f.plan });
    const t = entryText(1, r);
    expect(t).toMatch(/board layout: BOARD viewBox="0 0 1000 \d+"/);
    for (const id of f.groups) expect(t).toContain(`svg group ${id}`);
    expect(r.sections).toEqual([{ id: 'board', kind: 'svgboard' }]);
  });
});

describe('svg beats: a cut-off group', () => {
  it('completeSvg keeps whole children and closes the root; none whole, or not a group start: null', () => {
    expect(completeSvg('<g id="a"><line x1="0"/><g><circle r="2"/></g><text x="1">Hel')).toBe('<g id="a"><line x1="0"/><g><circle r="2"/></g></g>');
    expect(completeSvg('<g id="a"><line x1="0" y1="')).toBeNull();
    expect(completeSvg('<g id="a"><g><circle r="2"/>')).toBeNull(); // the inner group is not whole
    expect(completeSvg('<g id="a"><line/></g>')).toBe('<g id="a"><line/></g>');
    expect(completeSvg('text <g>')).toBeNull();
    expect(completeSvg('<g id="a"><text>a &gt; b</text><!-- c --><path d="M0')).toBe('<g id="a"><text>a &gt; b</text></g>');
  });

  it('the server filter cuts a half element off a group at the stream end (it would not parse), or drops the group', () => {
    const half = wire('Look.\n<g id="up"><path d="M0 0 L5 5" stroke="red"/><circle cx="4', 3);
    expect(half.out).toContain('{{svg <g id="up"><path d="M0 0 L5 5" stroke="red"/></g>}}');
    expect(groupGeometry('<g id="up"><path d="M0 0 L5 5" stroke="red"/></g>').error).toBeUndefined();
    const none = wire('Look.\n<g id="up"><path d="M0 0 L5', 3);
    expect(none.out).not.toContain('{{svg');
    expect(none.f.notes.join(' ')).toMatch(/cut off/);
  });

  it('the gate at the stream end: a half group is its whole children, never words; mid-stream it waits', () => {
    const s = new BeatSplitter('sentence');
    const out = [...s.push('Here is the river. {{svg <g id="r"> <line x1="0"/> <circle cx="4'), ...s.end()];
    const ts = tokenize(out[out.length - 1].text, { end: true });
    expect(ts.filter((t) => t.kind === 'word')).toEqual([]);
    const tag = ts.find((t) => t.kind === 'tag') as { action: { kind: string; svg: string } };
    expect(tag.action).toMatchObject({ kind: 'svg', svg: '<g id="r"> <line x1="0"/></g>' });
    expect(actions('Here is the river. {{svg <g id="r"> <line x1="0"/> <circle cx="4')).toMatchObject([{ kind: 'svg', svg: '<g id="r"> <line x1="0"/></g>' }]);
  });
});

describe('svg demos (gallery scenes)', () => {
  it('every svg demo opens a board and draws groups that pass the gate checks at the board minimum', async () => {
    const { SVG_DEMOS } = await import('../../src/demo/svg');
    expect(Object.keys(SVG_DEMOS).sort()).toEqual(['svg-ceiling', 'svg-dough', 'svg-ferry', 'svg-rent', 'svg-session', 'svg-sinx', 'svg-skater', 'svg-slope', 'svg-spin', 'svg-tunnel']);
    for (const [k, d] of Object.entries(SVG_DEMOS)) {
      const acts = actions(d.script);
      expect(acts[0], k).toMatchObject({ kind: 'sketch', svgboard: {} });
      const groups = acts.filter((x) => x.kind === 'svg');
      expect(groups.length, k).toBeGreaterThanOrEqual(4);
      for (const g of groups) expect(groupGeometry((g as { svg: string }).svg).error, k).toBeUndefined();
      // Every group passes the gate's checks in order, its data resolving (the engine demos' formulas included).
      const sb = acts[0] as Extract<RawAction, { kind: 'sketch' }>;
      const board = newBoardState(sb.svgboard!.w, sb.svgboard!.h);
      let scope: ReturnType<typeof checkGroups>['scope'] | undefined;
      if (k.startsWith('svg-ceiling') || k.startsWith('svg-spin') || k.startsWith('svg-slope')) for (const g of groups) {
        const r = checkGroups([(g as { svg: string }).svg], board, 20, scope);
        scope = r.scope;
        expect(r.flags, `${k} ${(g as { id?: string }).id}`).toEqual([]);
        acceptGroups(board, r.geos, r.grow);
      }
      // A session's later answers (aside, follow-ups) open (or extend) a board and pass the same checks.
      for (const [q, a] of Object.entries(d.answers ?? {})) {
        const later = actions(a);
        expect(later[0], `${k}: ${q}`).toMatchObject({ kind: 'sketch', svgboard: {} });
        for (const g of later.filter((x) => x.kind === 'svg')) expect(groupGeometry((g as { svg: string }).svg).error, `${k}: ${q}`).toBeUndefined();
      }
    }
  });
});

describe('p6.1: the first sentence before the plan', () => {
  it('passes the sentence through at once, with a boundary, and lifts the plan after it', async () => {
    const { SvgBeatFilter } = await import('../../server/svgBeats');
    const f = new SvgBeatFilter(() => 0);
    let out = f.push('{{highlight p=2 "x"}} It holds because the push never stops.');
    out += f.push('<plan>\ncase\nBOARD viewBox="0 0 1000 600"\ngroups: axes\n</plan>\nOn these <g id="axes"><line x1="0" y1="0" x2="10" y2="10"/></g> axes, the');
    out += f.end();
    expect(out.startsWith('{{highlight p=2 "x"}} It holds because the push never stops. ')).toBe(true);
    expect(out).toContain('{{svgboard h=600}}');
    expect(out).toMatch(/On these \{\{svg <g id="axes">.*\}\}\s+axes, the/);
    expect(f.plan).toMatch(/BOARD viewBox/);
  });
});
