import { describe, it, expect, vi } from 'vitest';
import { EXAMPLES, type Example } from '../../server/prompt/examples';
import { ScriptFilter } from '../../server/scriptFilter';
import { Lint } from '../../server/lint';
import { ScriptParser } from '../../src/script/parser';
import { Figures, type GroundMark } from '../../src/geometry/resolve';
import type { Pt, RawAction } from '../../src/script/types';

type Line = { id: string; y: number; x0: number; x1: number; text: string };

/** Reads the model-facing listing back into marks (the same format src/agent/context emits). */
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
    else unknown.push(l);
  }
  return { mark: (p: number, id: string) => (p === page ? marks.get(id) : undefined), lines, unknown };
}

const DRAW = new Set(['circle', 'box', 'highlight', 'underline', 'line', 'arrow', 'point', 'curve', 'shade', 'angle', 'brace', 'axes', 'plot', 'math', 'write', 'label', 'connect']);

function run(ex: Example) {
  const f = new ScriptFilter();
  const text = f.push(ex.script) + f.end();
  const p = new ScriptParser();
  const acts = [...p.push(text), ...p.end()].flatMap((e) => (e.type === 'action' ? [e.action] : [])) as RawAction[];
  const ground = parseListing(ex.page, ex.listing);
  const figs = new Figures(ground);
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
  it('cover four different question types, from the fixture and off-domain synthetic pages only', () => {
    expect(EXAMPLES).toHaveLength(4);
    expect(EXAMPLES.map((e) => e.title.split(':')[0])).toEqual(['point-at', 'what-if', 'derive', 'why']);
    expect(EXAMPLES.map((e) => e.source)).toEqual(['fixture', 'synthetic', 'synthetic', 'synthetic']);
  });

  for (const ex of EXAMPLES) {
    describe(ex.title, () => {
      it('its listing is in the grounding format', () => {
        expect(ex.listing.split('\n')[0]).toMatch(new RegExp(`^PAGE ${ex.page} \\(visible; (16:9 slide|4:3 slide|portrait page|page); image attached\\)$`));
        expect(parseListing(ex.page, ex.listing).unknown).toEqual([]);
      });

      it('parses with no malformed tag, resolves every tag, and passes lint untouched', () => {
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

      it('follows the answer shape', () => {
        const { text, acts } = run(ex);
        const ss = sentences(text);
        // On the visible page the answer opens with its mark (no scroll: the page is already in view).
        expect(DRAW.has(acts[0].kind) && 'page' in acts[0] && acts[0].page === ex.page, JSON.stringify(acts[0])).toBe(true);
        // Sentence 1: the answer in ≤ 16 words, already pointing.
        expect(ss[0].words.length).toBeLessThanOrEqual(16);
        expect(ss[0].tags.some((k) => DRAW.has(k))).toBe(true);
        // One new drawn element per sentence, 3–8 in all, exactly one accent.
        for (const s of ss) expect(s.tags.filter((k) => DRAW.has(k)).length, s.words.join(' ')).toBeLessThanOrEqual(1);
        const drawn = acts.filter((a) => DRAW.has(a.kind)).length;
        expect(drawn).toBeGreaterThanOrEqual(3);
        expect(drawn).toBeLessThanOrEqual(8);
        expect(acts.filter((a) => 'em' in a && a.em)).toHaveLength(1);
        // Spoken math only: no TeX, markdown or symbols in the narration.
        const spoken = ss.flatMap((x) => x.words).join(' ');
        expect(spoken).not.toMatch(/[\\$^_*#`={}]/);
      });

      it('copies quotes from the listing, with near= where a quote is short or repeated', () => {
        const { acts, ground } = run(ex);
        for (const a of acts) {
          if (!('quote' in a) || a.page == null) continue;
          const hits = ground.lines.filter((l) => l.text.includes(a.quote));
          expect(hits.length, a.quote).toBeGreaterThan(0);
          const count = hits.reduce((n, l) => n + l.text.split(a.quote).length - 1, 0);
          if (a.quote.length <= 2 || count > 1) {
            expect(a.near, `${a.quote} needs near=`).toBeDefined();
            const near = a.near as Pt;
            expect(hits.some((l) => near.x >= l.x0 - 10 && near.x <= l.x1 + 10 && Math.abs(near.y - (l.y + 15)) <= 30), a.quote).toBe(true);
          }
        }
      });

      it('plans and declares every sketch: <plan> after sentence 1, a fitted sketch, then one let', () => {
        const { plan, acts } = run(ex);
        const sketches = acts.filter((a) => a.kind === 'sketch');
        expect(Boolean(plan.trim())).toBe(sketches.length > 0);
        if (!sketches.length) return;
        expect(ex.script.indexOf('<plan>')).toBeGreaterThan(ex.script.search(/[.?!]\s/));
        for (const s of sketches) {
          const i = acts.indexOf(s);
          expect(s.kind === 'sketch' && s.fit).toBe(true);
          expect(acts[i + 1].kind).toBe('let');
        }
      });
    });
  }

  it('what-if: both shadow tips land where the geometry says (120, then 240 long)', () => {
    const ex = EXAMPLES.find((e) => e.title.startsWith('what-if'))!;
    const { figs, plan } = run(ex);
    const fig = figs.figure({ region: 's' });
    const at = (n: string) => fig.world({ ref: n }) as Pt;
    expect(at('S').x).toBeCloseTo(320, 6);
    expect(at('S').y).toBeCloseTo(0, 6);
    expect(at('S2').x).toBeCloseTo(640, 6);
    expect(at('S2').y).toBeCloseTo(0, 6);
    // Twice the distance from the lamp's foot gives twice the shadow.
    expect(at('S2').x - at('P2').x).toBeCloseTo(2 * (at('S').x - at('P').x), 6);
    expect(at('P2').x - at('O').x).toBeCloseTo(2 * (at('P').x - at('O').x), 6);
    expect(plan).toMatch(/meet\(L,H,O,P\)/);
  });

  it('derive: the staircase and its flipped copy tile the n by n+1 rectangle exactly', () => {
    const ex = EXAMPLES.find((e) => e.title.startsWith('derive'))!;
    const { acts, figs } = run(ex);
    const fig = figs.figure({ region: 'd' });
    const shades = acts.filter((a) => a.kind === 'shade' && 'pts' in a) as { pts: Parameters<typeof fig.world>[0][] }[];
    expect(shades).toHaveLength(2);
    const area = (ps: Pt[]) => Math.abs(ps.reduce((s, p, i) => { const q = ps[(i + 1) % ps.length]; return s + p.x * q.y - q.x * p.y; }, 0)) / 2;
    const polys = shades.map((s) => s.pts.map((p) => fig.world(p) as Pt));
    const [A, B, C, D] = ['A', 'B', 'C', 'D'].map((n) => fig.world({ ref: n }) as Pt);
    const rect = area([A, B, C, D]);
    expect(area(polys[0])).toBeCloseTo(rect / 2, 6);
    expect(area(polys[1])).toBeCloseTo(rect / 2, 6);
    // n = 4 columns of width 100, n + 1 = 5 rows of height 100.
    expect(Math.abs(B.x - A.x)).toBe(400);
    expect(Math.abs(C.y - B.y)).toBe(500);
  });
});
