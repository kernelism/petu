import { describe, expect, it } from 'vitest';
import { endsSentence } from '../../src/playback/clock';
import { endsSentence as captionEnds } from '../../src/ui/captionWindow';
import { VoiceClock } from '../../src/playback/voiceClock';

describe('sentence ends (voice pieces, captions)', () => {
  it('an abbreviation or an open parenthesis ends no sentence (founder lec06: "Linear filtering (aka." spoken alone)', () => {
    for (const w of ['(aka.', 'aka.', 'e.g.', 'i.e.', 'Fig.', 'etc.', '(see', 'vs.']) { expect(endsSentence(w), w).toBe(false); expect(captionEnds(w), w).toBe(false); }
    for (const w of ['far.', 'right?', 'done!', 'this).', 'end.”', 'kernel.)']) { expect(endsSentence(w), w).toBe(true); expect(captionEnds(w), w).toBe(true); }
  });

  it('the voice is never sent a fragment that ends on an abbreviation', () => {
    const sent: string[] = [];
    const v = new VoiceClock(async (t) => { sent.push(t); return null; }, { play: () => ({ stop() {} }) }, () => 155, () => 1, () => 0);
    for (const w of 'Linear filtering (aka. Convolutions) changes an image by combining nearby pixels.'.split(' ')) v.enqueue(w);
    expect(sent[0]).not.toBe('Linear filtering (aka.');
    expect(sent.join(' ')).toContain('(aka. Convolutions)');
  });
});
