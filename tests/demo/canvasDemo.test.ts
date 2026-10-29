import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { groundPage } from '../../src/agent/context/build';
import { groundingOf, type PageGround } from '../../src/agent/context/types';
import { Figures } from '../../src/geometry/resolve';
import { ScriptParser } from '../../src/script/parser';
import { SCRIPTS } from '../../src/demo/scripts';
import type { RawAction } from '../../src/script/types';

// ?script=canvas resolves against public/fixtures/canvas.pdf's own grounding (its charts and marks),
// as an answer would: every tag must resolve (nothing skipped), and the chart drawings must land on
// the slide's axes.
describe('?script=canvas on its own pages', () => {
  const grounds: PageGround[] = [];
  beforeAll(async () => {
    const doc = await pdfjs.getDocument({ data: new Uint8Array(readFileSync('public/fixtures/canvas.pdf')), verbosity: 0, isEvalSupported: false, fontExtraProperties: true }).promise;
    for (let p = 1; p <= doc.numPages; p++) grounds.push(await groundPage(await doc.getPage(p) as never, pdfjs.OPS as unknown as Record<string, number>));
  });
  const actions = () => {
    const p = new ScriptParser();
    return [...p.push(SCRIPTS.canvas.script), ...p.end()].flatMap((e) => (e.type === 'action' ? [e.action] : [])) as RawAction[];
  };

  it('the chart readouts are said with the engine values, before and after the tax doubles (3.2)', () => {
    groundingOf(grounds); // the app's latest grounding: the live parser reads chart axes from it
    const p = new ScriptParser();
    const said = [...p.push(SCRIPTS.canvas.script), ...p.end()].flatMap((e) => (e.type === 'word' ? [e.text] : [])).join(' ');
    expect(said).toContain('buyers pay 8.');
    expect(said).toContain('Double the tax to 4:');
    expect(said).toContain('now pay 9 for 15 units');
  });
  it('every page has a calibrated chart #c1', () => {
    expect(grounds.map((g) => g.charts?.map((c) => c.id))).toEqual([['#c1'], ['#c1'], ['#c1']]);
  });
  it('resolves every tag (no skips): chart drawings, lifts, notes', () => {
    const f = new Figures(groundingOf(grounds));
    const as = actions();
    as.forEach((a) => f.note(a));
    const out = as.map((a) => [a.kind, f.resolve(a)] as const);
    expect(out.filter(([, r]) => typeof r === 'string')).toEqual([]);
    for (const k of ['lift', 'annot', 'plot']) expect(as.some((a) => a.kind === k), k).toBe(true);
    // The tax bracket's end (Q 15, P 9) on the slide's axes (make-decks.ts: a 330 × 300 pt box at 90,150 for
    // Q 0–60, P 0–14, on an 800 × 560 pt page).
    const br = out.find(([k]) => k === 'brace')![1] as { from: { x: number; y: number } };
    expect(br.from.x).toBeCloseTo(((90 + (15 / 60) * 330) / 800) * 1000, 0);
    expect(br.from.y).toBeCloseTo(((450 - (9 / 14) * 300) / 560) * 1000, 0);
    // The crossing is a readout on the chart, placed by the kit (it follows the beforeafter).
    expect(out.find(([k, r]) => k === 'point' && typeof r === 'object' && r && (r as { text?: string }).text === 'Pb')![1]).toMatchObject({ at: { ref: 'E' }, onChart: {} });
  });
});
