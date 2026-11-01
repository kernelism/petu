// tests/desk/quoteReading.test.ts — a page quote with several exact hits and no near= lights the hit
// nearest where the reading is (the page's last mark), not the first in reading order (diag C8: a
// term that was also the page title lit the title while the narration was on the body).
import { describe, it, expect, vi } from 'vitest';
import { buildElement } from '../../src/desk/elements';
import { Registry } from '../../src/desk/registry';
import { DEFAULTS } from '../../src/settings/settings';
import type { TextRun } from '../../src/locate/locateQuote';
import type { BuildEnv, DeskApi, TargetCtx } from '../../src/desk/types';
import type { InkAction, Target } from '../../src/script/types';

const SVG = 'http://www.w3.org/2000/svg';
const g = () => document.createElementNS(SVG, 'g') as SVGGElement;
const run = (text: string, y: number, w: number): TextRun => ({ text, rect: { x: 100, y, w, h: 14 } });
const runs = [run('Gradient descent', 60, 128), run('The learning rate sets the step size of each update.', 200, 416), run('Gradient descent with momentum smooths the steps.', 400, 400)];

function env(): BuildEnv {
  const layers = { highlight: g(), agent: g() };
  const ctx = (t: Target): TargetCtx => ({ target: t, layers, h: 1000, scale: () => 1, toSpace: (p) => p, rectToSpace: (r) => r, runs: async () => runs });
  return { ctx: async (t) => ctx(t), registry: new Registry(), settings: DEFAULTS, rng: () => null, desk: { region: () => null } as unknown as DeskApi };
}
const hl = (quote: string): InkAction => ({ kind: 'highlight', page: 1, quote } as InkAction);
const yOf = async (e: BuildEnv, a: InkAction) => { const p = await buildElement(a, e); if (typeof p === 'string') throw new Error(p); return p.bbox.y; };

describe('page quotes follow the reading', () => {
  it('no mark yet on the page: the first hit (reading order)', async () => {
    expect(await yOf(env(), hl('gradient descent'))).toBe(60);
  });

  it('after a mark lower on the page, the hit nearest it', async () => {
    const e = env();
    expect(await yOf(e, hl('smooths the steps'))).toBe(400);
    expect(await yOf(e, hl('gradient descent'))).toBe(400);
    // A circle or box at coordinates moves the reading too.
    await buildElement({ kind: 'box', page: 1, at: { x: 100, y: 50 }, w: 200, h: 30 } as InkAction, e);
    expect(await yOf(e, hl('gradient descent'))).toBe(60);
  });

  it('near= still decides, and the reading is per page and cleared with the registry', async () => {
    const e = env();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    await yOf(e, hl('smooths the steps'));
    expect(await yOf(e, { ...hl('gradient descent'), near: { x: 150, y: 65 } } as InkAction)).toBe(60);
    await yOf(e, hl('smooths the steps'));
    expect(await yOf(e, { ...hl('gradient descent'), page: 2 } as InkAction)).toBe(60);
    e.registry.clear();
    expect(await yOf(e, hl('gradient descent'))).toBe(60);
  });
});
