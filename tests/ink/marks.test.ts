import { describe, it, expect, vi, afterEach } from 'vitest';
import { drawHighlight } from '../../src/ink/agent/marks';

const SVG = 'http://www.w3.org/2000/svg';
const durations = (g: SVGGElement) =>
  Array.from(g.querySelectorAll('rect')).map((r) => Number(/(\d+)ms/.exec((r as SVGRectElement).style.transition)?.[1]));

async function sweep(speed?: number) {
  vi.useFakeTimers();
  vi.stubGlobal('requestAnimationFrame', (f: FrameRequestCallback) => setTimeout(() => f(0), 0));
  const g = document.createElementNS(SVG, 'g') as SVGGElement;
  const p = drawHighlight(g, [{ x: 0, y: 0, w: 300, h: 10 }, { x: 0, y: 12, w: 100, h: 10 }], '#ff0', 0.5, speed);
  await vi.runAllTimersAsync();
  await p;
  return durations(g);
}

describe('drawHighlight', () => {
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

  it('sweeps each line in proportion to its width (~550ms total) at nominal speed', async () => {
    expect(await sweep()).toEqual([413, 160]);
  });
  it('compresses under backlog, like strokes', async () => {
    expect(await sweep(0.5)).toEqual([206, 80]);
  });
  it('clamps speed to 0.35–1', async () => {
    expect(await sweep(0.1)).toEqual([144, 56]);
    expect(await sweep(3)).toEqual([413, 160]);
  });
});
