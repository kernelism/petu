import { describe, it, expect, vi } from 'vitest';
import { EXAMPLES, type Example } from '../../server/prompt/examples';
import { ScriptFilter } from '../../server/scriptFilter';
import { Lint } from '../../server/lint';
import { ScriptParser } from '../../src/script/parser';
import { Figures, type GroundMark } from '../../src/geometry/resolve';
import type { Pt, RawAction } from '../../src/script/types';

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
  const ground = parseListings(ex.listing);
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
  it('three invented documents of different reach; at least one walks several pages', () => {
    expect(EXAMPLES).toHaveLength(3);
    expect(EXAMPLES.some((e) => e.pages.length >= 3 && new Set(run(e).acts.flatMap((a) => ('page' in a && a.page != null ? [a.page] : []))).size >= 3)).toBe(true);
    expect(EXAMPLES.some((e) => e.pages.length === 1 && run(e).acts.every((a) => a.kind !== 'sketch'))).toBe(true);
  });

  for (const ex of EXAMPLES) {
    describe(ex.title, () => {
      it('its listings are in the grounding format: the visible page first, then the scout pages in order', () => {
        const g = parseListings(ex.listing);
        expect(g.heads[0]).toMatch(new RegExp(`^PAGE ${ex.page} \\(visible; (16:9 slide|4:3 slide|portrait page|page); image attached\\)$`));
        for (const h of g.heads.slice(1)) expect(h).toMatch(/^PAGE \d+ \((16:9 slide|4:3 slide|portrait page|page); (image attached|listing only, no image)\)$/);
        expect([...g.byPage.keys()]).toEqual([ex.page, ...ex.pages.filter((p) => p !== ex.page)]);
        expect(g.unknown).toEqual([]);
        expect(ex.plan.split(/\s+/).length).toBeLessThanOrEqual(80);
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
          if (!('quote' in a) || a.page == null) continue;
          const hits = ground.lines(a.page).filter((l) => l.text.includes(a.quote));
          expect(hits.length, a.quote).toBeGreaterThan(0);
          const count = hits.reduce((n, l) => n + l.text.split(a.quote).length - 1, 0);
          if (a.quote.length <= 2 || count > 1) {
            expect(a.near, `${a.quote} needs near=`).toBeDefined();
            const near = a.near as Pt;
            expect(hits.some((l) => near.x >= l.x0 - 10 && near.x <= l.x1 + 10 && Math.abs(near.y - (l.y + 15)) <= 30), a.quote).toBe(true);
          }
        }
      });

      it('plans and declares every sketch: a <plan> before it, a fitted sketch, then one let', () => {
        const { plan, acts } = run(ex);
        const sketches = acts.filter((a) => a.kind === 'sketch');
        expect(Boolean(plan.trim())).toBe(sketches.length > 0);
        if (!sketches.length) return;
        expect(ex.script.indexOf('<plan>')).toBeLessThan(ex.script.indexOf('{{sketch'));
        for (const s of sketches) {
          const i = acts.indexOf(s);
          expect(s.kind === 'sketch' && s.fit).toBe(true);
          expect(acts[i + 1].kind).toBe('let');
        }
      });
    });
  }

  it('what-if: both shadow tips land where the geometry says (120, then 240 long)', () => {
    const ex = EXAMPLES.find((e) => e.title.includes('what-if'))!;
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

  it('lever: the push end is three times as far from the pivot, and travels three times as far', () => {
    const ex = EXAMPLES.find((e) => e.pages.length === 3)!;
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
