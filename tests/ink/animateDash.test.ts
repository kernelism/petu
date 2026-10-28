// tests/ink/animateDash.test.ts
import { it, expect } from 'vitest';
import { drawStrokes } from '../../src/ink/agent/animate';

it('dash and opacity land on the stroke path', async () => {
  const g = document.createElementNS('http://www.w3.org/2000/svg', 'g') as SVGGElement;
  await drawStrokes(g, [[{ x: 0, y: 0 }, { x: 10, y: 0 }]], { color: '#000', width: 2, mode: 'fade', scale: 1, fadeMs: 0, dash: '7 6', opacity: 0.75 });
  const p = g.querySelector('path')!;
  expect(p.getAttribute('stroke-dasharray')).toBe('7 6');
  expect(p.getAttribute('stroke-opacity')).toBe('0.75');
});
