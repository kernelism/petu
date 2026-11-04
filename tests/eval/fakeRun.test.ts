import { describe, it, expect } from 'vitest';
import { chunkLog } from '../../scripts/eval/fakeRun';
import { DEMOS, suggestionsFor } from '../../src/demo/demoScript';

describe('fake run', () => {
  it('chunks reassemble to the script, with rising offsets and a seed', () => {
    const d = DEMOS[0];
    const a = chunkLog(d.script, d.question, 1);
    expect(a.chunks.map((c) => c.d).join('')).toBe(d.script);
    for (let i = 1; i < a.chunks.length; i++) expect(a.chunks[i].t).toBeGreaterThan(a.chunks[i - 1].t);
    expect(chunkLog(d.script, d.question, 1)).toEqual(a);
    expect(chunkLog(d.script, d.question, 2)).not.toEqual(a);
  });
});

describe('the sample\'s suggestions', () => {
  it('offer the stand-alone question first, the follow-ups ("Sketch it from the side") only after an answer', () => {
    expect(suggestionsFor(false)).toEqual(['Why does stereo matching only search along a line?']);
    expect(suggestionsFor(true)).toEqual(['Sketch it from the side', 'Show me the whole epipolar plane']);
  });
});
