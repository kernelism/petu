import { describe, it, expect } from 'vitest';
import { EXPERIMENT_RUN } from '../../scripts/eval/replayStress';

describe('replay-stress leaves experiment runs out', () => {
  it('matches prompt-variant and replay experiments only', () => {
    for (const r of ['2026-10-29-claude-opus-low-ask-p5.7-exdemos-q2-ae05d5d6-3', '2026-10-29-claude-opus-low-ask-p5.7-boardfirst-q2-ae05d5d6', '2026-10-29-claude-opus-low-ask-p5.7-svgboard-q2-x', '2026-10-29-claude-opus-low-ask-replay-e5-p5.7-q2-ae05d5d6-2', '2026-10-29-terra-none-replay-gateoff-p5.7-q2-ae05d5d6'])
      expect(EXPERIMENT_RUN.test(r)).toBe(true);
    for (const r of ['2026-10-29-claude-opus-low-ask-p5.7-q2-ae05d5d6-4', '2026-10-29-terra-none-p5.5-draw-5b74be89', '2026-10-29-claude-opus-low-replay-p5.6-draw-5b74be89-2'])
      expect(EXPERIMENT_RUN.test(r)).toBe(false);
  });
});
