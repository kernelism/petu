import { describe, it, expect, vi } from 'vitest';
import { EXAMPLES, type Example } from '../../server/prompt/examples';
import { ScriptFilter } from '../../server/scriptFilter';
import { Lint } from '../../server/lint';
import { ScriptParser } from '../../src/script/parser';
import { Figures, type GroundMark } from '../../src/geometry/resolve';
import { evalConst } from '../../src/geometry/live';
import { GateState, UNBOUND_TEXT } from '../../src/gate/engine';
import type { Pt, RawAction } from '../../src/script/types';

/**
 * A geometry fixture (the lever left the prompt in p5.6: geometry was not where answers failed). It
 * still runs every check below, so a fitted sketch with one let and its constructions stays executable.
 */
const LEVER: Example = {
    title: 'several pages walked, one figure that grows: point at the rule, draw the case',
    question: 'How can a small push lift something heavy with a lever?',
    page: 6,
    pages: [6, 7, 8],
    plan: 'The student sees a bar on a pivot but not why distance trades for force. Walk: the pivot and bar on 6, the balance rule on 7, the payoff on 8. Central illustration: one bar on its pivot, a heavy load close on one side, a light push far on the other; mark both distances, then let the bar turn so the push end visibly travels farther.',
    listing: String.raw`PAGE 6 (visible; 16:9 slide; image attached)
t1 60 40–300: Levers
t2 170 40–760: A lever is a rigid bar that turns about a fixed point, the pivot.
t3 760 470–530: pivot
#d1 dot 500,700 "pivot"
#s1 line 150,640→850,640
PAGE 7 (16:9 slide; image attached)
t1 60 40–420: The law of the lever
t2 180 40–700 math: F₁ × d₁ = F₂ × d₂
t3 260 40–820: Force times distance from the pivot is the same on both sides.
PAGE 8 (16:9 slide; listing only, no image)
t1 60 40–480: Mechanical advantage
t2 180 40–900: Push three times as far from the pivot, and a third of the force balances the load.`,
    script: String.raw`{{circle p=6 mark=#d1}} A lever trades distance for force: push three times farther from the pivot, and a third of the force lifts the load. <plan>Side view, up negative. Pivot P=0,0. Bar from the load end A=-100,0 to the push end B=along(A,P,4) = 300,0, three times as far from P. Forces as down arrows, 50 per unit: load 3 at A to LA=-100,150; push 1 at B to PB=300,50. Turned bar: A2=-97,-25, B2=along(A2,P,4) = 291,75, so B moves three times as far as A. Draw: pivot, bar, load, push, the two distances (braces left to right, above the bar), the turned bar, both ends' paths (em on the push end's).</plan>{{sketch id=v near=p6 fit}}{{let on=v P=0,0 A=-100,0 B=along(A,P,4) LA=-100,150 PB=300,50 A2=-97,-25 B2=along(A2,P,4)}} {{point on=v at=P "pivot" dir=s}} Here's the pivot, {{line on=v from=A to=B}} with the bar across it. {{arrow on=v from=A to=LA}} A heavy load sits one step out on this side. {{arrow on=v from=B to=PB}} You push three steps out on the other, with a third of the force. {{scroll p=7}} {{highlight p=7 mark=#t2}} This rule is why that balances: force times distance must match on both sides. {{brace on=v from=A to=P "1"}} The load gives three units of force times one step, {{brace on=v from=P to=B "3"}} and you give one unit times three steps. {{line on=v from=A2 to=B2 dash}} Now let the bar turn a little. {{line on=v from=A to=A2 weight=secondary}} The load rises a short way, {{line on=v from=B to=B2 em}} while your hand travels three times as far. {{scroll p=8}} {{highlight p=8 "a third of the force balances the load"}} That's the bargain: a gentler push, over a longer path.`,

};

type Line = { id: string; y: number; x0: number; x1: number; text: string };

/**
 * Reads the model-facing listings back into marks (the same format src/agent/context emits): the
 * visible page first, then any other page sent with a listing. Marks are per page.
 */
export function parseListings(listing: string) {
  const byPage = new Map<number, ReturnType<typeof parseListing>>();
  const heads: string[] = [];
  let cur: string[] = [];
  const flush = () => { if (cur.length) { const page = Number(/^PAGE (\d+)/.exec(cur[0])![1]); byPage.set(page, parseListing(page, cur.join('\n'))); heads.push(cur[0]); } };
  for (const l of listing.split('\n')) { if (l.startsWith('PAGE ')) { flush(); cur = [l]; } else cur.push(l); }
  flush();
  return { heads, byPage, mark: (p: number, id: string) => byPage.get(p)?.mark(p, id), lines: (p: number) => byPage.get(p)?.lines ?? [], unknown: [...byPage.values()].flatMap((x) => x.unknown) };
}

/** One page's listing back into marks. */
export function parseListing(page: number, listing: string) {
  const dots = new Map<string, Pt>(), marks = new Map<string, GroundMark>();
  const lines: Line[] = [], unknown: string[] = [];
  const P = (s: string): Pt => { if (dots.has(s)) return dots.get(s)!; const [x, y] = s.split(',').map(Number); return { x, y }; };
  for (const l of listing.split('\n').slice(1)) {
    let m;
    if ((m = l.match(/^(t\d+) (\d+) (\d+)–(\d+)(?: math)?: (.*)$/))) {
      marks.set(`#${m[1]}`, { kind: 'text', rect: { x: +m[3], y: +m[2], w: +m[4] - +m[3], h: 30 }, text: m[5] });
      lines.push({ id: m[1], y: +m[2], x0: +m[3], x1: +m[4], text: m[5] });
    } else if ((m = l.match(/^(#d\d+) dot (\d+,\d+)( "[^"]+")?$/))) { dots.set(m[1], P(m[2])); marks.set(m[1], { kind: 'dot', at: P(m[2]) }); }
    else if ((m = l.match(/^(#[sa]\d+) (line|arrow) (#d\d+|\d+,\d+)→(#d\d+|\d+,\d+)( "[^"]+")?$/))) marks.set(m[1], { kind: m[2] as 'line', from: P(m[3]), to: P(m[4]) });
    else if ((m = l.match(/^(#[gbie]\d+) (figure|box|image|equation) (\d+),(\d+) (\d+)×(\d+)( \(\d+ paths\))?( "[^"]+")?$/))) marks.set(m[1], { kind: m[2] as 'box', rect: { x: +m[3], y: +m[4], w: +m[5], h: +m[6] } });
    else if ((m = l.match(/^(#c\d+) chart (\d+),(\d+) (\d+)×(\d+) x "[^"]*" (-?[\d.]+)–(-?[\d.]+), y "[^"]*" (-?[\d.]+)–(-?[\d.]+)$/))) {
      // A calibrated chart: its axes run along the rect (x left → right, y bottom → top).
      const [x, y, w, h, x0, x1, y0, y1] = m.slice(2).map(Number);
      marks.set(m[1], { kind: 'chart', rect: { x, y, w, h }, x: { lo: x0, hi: x1, p0: x, p1: x + w }, y: { lo: y0, hi: y1, p0: y + h, p1: y } });
    } else unknown.push(l);
  }
  return { mark: (p: number, id: string) => (p === page ? marks.get(id) : undefined), lines, unknown };
}

const DRAW = new Set(['circle', 'box', 'highlight', 'underline', 'line', 'arrow', 'point', 'curve', 'shade', 'angle', 'brace', 'axes', 'plot', 'math', 'write', 'label', 'connect']);

function run(ex: Example) {
  const f = new ScriptFilter();
  const text = f.push(ex.script) + f.end();
  const p = new ScriptParser();
  const acts = [...p.push(text), ...p.end()].flatMap((e) => (e.type === 'action' ? [e.action] : [])) as RawAction[];
  const ground = parseListings(ex.listing);
  // The answer's constants as the engine holds them (live geometry reads them on every resolve).
  const consts: Record<string, number> = {};
  for (const a of acts) if (a.kind === 'const') for (const [k, v] of a.defs) { const n = evalConst(v, consts); if (typeof n === 'number') consts[k.toLowerCase()] = n; }
  const figs = new Figures(ground, () => consts);
  acts.forEach((a) => figs.note(a));
  return { text, plan: f.plan, acts, ground, figs };
}

/** Sentences of the spoken script (as the parser sees it), each with the kinds of the tags that fire in it. */
function sentences(text: string) {
  const out: { words: string[]; tags: string[] }[] = [];
  let cur = { words: [] as string[], tags: [] as string[] };
  const parser = new ScriptParser();
  for (const e of [...parser.push(text), ...parser.end()]) {
    if (e.type === 'action') cur.tags.push(e.action.kind);
    if (e.type !== 'word') continue;
    cur.words.push(e.text);
    if (/[.?!]$/.test(e.text)) { out.push(cur); cur = { words: [], tags: [] }; }
  }
  if (cur.words.length || cur.tags.length) out.push(cur);
  return out;
}

describe('prompt examples', () => {
  it('four invented documents of different reach; one walks several pages, one makes the thing happen (a tween with a live readout), one has the engine compute', () => {
    expect(EXAMPLES).toHaveLength(4);
    // p5.7: something happening is drawn and made to happen: a figure bound to a constant that a tween drives, its quantity read live.
    const moving = EXAMPLES.map((e) => run(e).acts).find((acts) => acts.some((a) => a.kind === 'tween'));
    expect(moving).toBeDefined();
    expect(moving!.some((a) => a.kind === 'let')).toBe(true);
    expect(moving!.some((a) => a.kind === 'write' && 'value' in a && a.value != null)).toBe(true);
    // the engine computes: a plot or a found reading from a formula, a block from an operation (never a hand-written result)
    expect(EXAMPLES.some((e) => run(e).acts.some((a) => a.kind === 'find' || ('src' in a && !('vals' in (a as { src: object }).src))))).toBe(true);
    expect(EXAMPLES.some((e) => e.pages.length >= 3 && new Set(run(e).acts.flatMap((a) => ('page' in a && a.page != null ? [a.page] : []))).size >= 3)).toBe(true);
    expect(EXAMPLES.some((e) => e.pages.length === 1 && run(e).acts.every((a) => a.kind !== 'sketch'))).toBe(true);
  });

  for (const ex of [...EXAMPLES, LEVER]) {
    describe(ex.title, () => {
      it('its listings are in the grounding format: the visible page first, then the scout pages in order', () => {
        const g = parseListings(ex.listing);
        expect(g.heads[0]).toMatch(new RegExp(`^PAGE ${ex.page} \\(visible; (16:9 slide|4:3 slide|portrait page|page); image attached\\)$`));
        for (const h of g.heads.slice(1)) expect(h).toMatch(/^PAGE \d+ \((16:9 slide|4:3 slide|portrait page|page); (image attached|listing only, no image)\)$/);
        expect([...g.byPage.keys()]).toEqual([ex.page, ...ex.pages.filter((p) => p !== ex.page)]);
        expect(g.unknown).toEqual([]);
        expect(ex.plan.split(/\s+/).length).toBeLessThanOrEqual(100);
      });

      it('parses with no malformed tag, resolves every tag, and lint notes nothing', () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const { text, acts, figs } = run(ex);
        expect(warn).not.toHaveBeenCalled();
        warn.mockRestore();
        expect((ex.script.match(/\{\{/g) ?? []).length).toBe(acts.length);
        for (const a of acts) { const r = figs.resolve(a); expect(typeof r, JSON.stringify(a)).not.toBe('string'); }
        const lint = new Lint();
        expect(lint.push(text) + lint.end()).toBe(text);
        expect(lint.notes).toEqual([]);
      });

      it('answers first while pointing at the visible page, and speaks math, never TeX', () => {
        const { text, acts } = run(ex);
        const ss = sentences(text);
        expect(DRAW.has(acts[0].kind) && 'page' in acts[0] && acts[0].page === ex.page, JSON.stringify(acts[0])).toBe(true);
        expect(ss[0].tags.some((k) => DRAW.has(k))).toBe(true);
        const spoken = ss.flatMap((x) => x.words).join(' ');
        expect(spoken).not.toMatch(/[\\$^_*#`={}]/);
      });

      it('every number it says through val is the engine\'s (none speaks —)', () => {
        const { text } = run(ex);
        const p = new ScriptParser(new GateState(parseListings(ex.listing)));
        const said = [...p.push(text), ...p.end()].flatMap((e) => (e.type === 'word' ? [e.text] : [])).join(' ');
        expect(said).not.toContain(UNBOUND_TEXT);
      });

      it('only marks pages sent with a listing, and scrolls to another page before marking it', () => {
        const { acts } = run(ex);
        const listed = new Set(parseListings(ex.listing).byPage.keys());
        let shown = ex.page;
        for (const a of acts) {
          if (a.kind === 'scroll') { shown = a.page; continue; }
          if ('page' in a && a.page != null && a.kind !== 'sketch') {
            expect(listed.has(a.page), JSON.stringify(a)).toBe(true);
            expect(a.page, `${a.kind} on p${a.page} without a scroll there`).toBe(shown);
          }
        }
      });

      it('the board never duplicates: no board text copies a page line or a sentence of the narration', () => {
        const { text, acts } = run(ex);
        const g = parseListings(ex.listing);
        const pageText = [...g.byPage.keys()].flatMap((p) => g.lines(p).map((l) => l.text.toLowerCase()));
        const spoken = sentences(text).map((x) => x.words.join(' ').toLowerCase());
        for (const a of acts) {
          if (!('region' in a) || a.region == null) continue;
          const t = (('text' in a && a.text) || (a.kind === 'math' && a.tex) || '') as string;
          if (t.split(/\s+/).length < 3) continue; // a label
          expect(pageText.some((l) => l.includes(t.toLowerCase())), t).toBe(false);
          expect(spoken.some((l) => l.includes(t.toLowerCase())), t).toBe(false);
        }
      });

      it('copies quotes from the listing, with near= where a quote is short or repeated', () => {
        const { acts, ground } = run(ex);
        for (const a of acts) {
          if (!('quote' in a) || !a.quote || a.page == null) continue;
          const quote = a.quote;
          const hits = ground.lines(a.page).filter((l) => l.text.includes(quote));
          expect(hits.length, a.quote).toBeGreaterThan(0);
          const count = hits.reduce((n, l) => n + l.text.split(quote).length - 1, 0);
          if (a.quote.length <= 2 || count > 1) {
            expect(a.near, `${a.quote} needs near=`).toBeDefined();
            const near = a.near as Pt;
            expect(hits.some((l) => near.x >= l.x0 - 10 && near.x <= l.x1 + 10 && Math.abs(near.y - (l.y + 15)) <= 30), a.quote).toBe(true);
          }
        }
      });

      it('plans and declares every sketch: a <plan> before it; a drawn figure is fitted then one let (kit blocks need neither)', () => {
        const { plan, acts } = run(ex);
        const sketches = acts.filter((a) => a.kind === 'sketch');
        expect(Boolean(plan.trim())).toBe(sketches.length > 0);
        if (!sketches.length) return;
        expect(ex.script.indexOf('<plan>')).toBeLessThan(Math.max(ex.script.indexOf('{{sketch'), ex.script.indexOf('{{scene')));
        for (const s of sketches) {
          const i = acts.indexOf(s);
          if (s.kind !== 'sketch' || s.scene) continue;
          const kitOnly = acts.every((a) => !('region' in a) || a.region !== s.id || ['grid', 'bars', 'scatter', 'table', 'calc', 'fit', 'shares', 'plot', 'tokens'].includes(a.kind) || (a.kind === 'point' && 'ref' in (a.at as object)));
          if (kitOnly) continue;
          expect(s.fit).toBe(true);
          expect(acts[i + 1].kind).toBe('let');
        }
      });
    });
  }

  it('every example that draws changes what it drew (moves, sets, splits, sweeps, shifts), and ends on a question to the student', () => {
    const MOVES = new Set(['tween', 'set', 'move', 'split', 'merge', 'fade', 'emph', 'step', 'sweep', 'beforeafter', 'limit', 'contrast']);
    for (const ex of EXAMPLES) {
      const { acts, text } = run(ex);
      if (acts.some((a) => 'region' in a && a.region != null || 'chart' in a && a.chart != null)) expect(acts.some((a) => MOVES.has(a.kind)), ex.title).toBe(true);
      if (ex.plan.includes('check')) expect(text.trim().endsWith('?'), ex.title).toBe(true);
    }
  });

  it('village: the coins are marks that move between owners; the village keeps what came in minus what went out', () => {
    const ex = EXAMPLES.find((e) => e.title.includes('coins as marks'))!;
    const { acts, text } = run(ex);
    expect(acts.some((a) => a.kind === 'tokens')).toBe(true);
    expect(acts.filter((a) => a.kind === 'set' && 'state' in a && a.state).length).toBeGreaterThanOrEqual(3);
    expect(acts.some((a) => a.kind === 'node' || a.kind === 'link')).toBe(false); // the things, not chips
    const p = new ScriptParser(new GateState(parseListings(ex.listing)));
    const said = [...p.push(text), ...p.end()].flatMap((e) => (e.type === 'word' ? [e.text] : [])).join(' ');
    expect(said).toContain('keeps 40,');
  });

  it('lighthouse: the spot is bound to the turn and sits on the shore; the turn is tweened and the readout climbs', () => {
    const ex = EXAMPLES.find((e) => e.title.includes('made to happen'))!;
    const { acts, text, figs } = run(ex);
    expect(acts.some((a) => a.kind === 'tween')).toBe(true);
    expect(acts.some((a) => a.kind === 'point' && 'trace' in a && a.trace)).toBe(true);
    const at = (n: string) => figs.figure({ region: 'c' }).world({ ref: n }) as Pt;
    expect(at('S').y).toBeCloseTo(at('N').y, 6); // on the shore
    expect(at('B').x - at('A').x).toBeGreaterThan(at('A').x - at('N').x); // equal turns, longer stretch
    const p = new ScriptParser(new GateState(parseListings(ex.listing)));
    const said = [...p.push(text), ...p.end()].flatMap((e) => (e.type === 'word' ? [e.text] : [])).join(' ');
    expect(said).toMatch(/reaching 30\d metres a second/);
  });

  it("counter: the guess is tested on the slide's own chart: a readout where it fails, then the curve shifted with its ghost", () => {
    const ex = EXAMPLES.find((e) => e.title.includes("slide's own chart"))!;
    const { acts, text } = run(ex);
    expect(acts.every((a) => !('region' in a) || a.region == null)).toBe(true); // the board never opens
    expect(acts.some((a) => a.kind === 'find')).toBe(true);
    expect(acts.some((a) => a.kind === 'beforeafter')).toBe(true);
    const p = new ScriptParser(new GateState(parseListings(ex.listing)));
    const said = [...p.push(text), ...p.end()].flatMap((e) => (e.type === 'word' ? [e.text] : [])).join(' ');
    expect(said).toContain('reads 30 minutes');
    expect(said).toContain('wait 5 minutes');
  });

  it('lever: the push end is three times as far from the pivot, and travels three times as far', () => {
    const ex = LEVER;
    const { figs } = run(ex);
    const fig = figs.figure({ region: 'v' });
    const at = (n: string) => fig.world({ ref: n }) as Pt;
    const d = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);
    expect(d(at('B'), at('P'))).toBeCloseTo(3 * d(at('A'), at('P')), 6);
    expect(d(at('B2'), at('P'))).toBeCloseTo(3 * d(at('A2'), at('P')), 6);
    expect(d(at('B'), at('B2'))).toBeCloseTo(3 * d(at('A'), at('A2')), 6);
    // The turned bar still passes through the pivot.
    const cross = (at('B2').x - at('A2').x) * (at('P').y - at('A2').y) - (at('B2').y - at('A2').y) * (at('P').x - at('A2').x);
    expect(cross).toBeCloseTo(0, 6);
  });
});
