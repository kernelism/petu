import { describe, expect, it } from 'vitest';
import { BeatSplitter, beats, tokenize, units } from '../../src/gate/segment';
import { listRuns, loadRun, runsDir } from '../../scripts/gate-beats/recordings';

/** Deterministic pseudo-random chunking. */
function rng(seed: number) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32; }; }
function chunked(text: string, seed: number): string[] {
  const r = rng(seed), out: string[] = [];
  for (let i = 0; i < text.length;) { const n = 1 + Math.floor(r() * 24); out.push(text.slice(i, i + n)); i += n; }
  return out;
}
function split(text: string, mode: 'sentence' | 'beat', seed: number) {
  const s = new BeatSplitter(mode);
  const out = chunked(text, seed).flatMap((c) => s.push(c));
  return [...out, ...s.end()];
}
/** A unit as its tokens (words and tag bodies), sorted tags last: what the gate checks. */
const toks = (t: string) => { const ts = tokenize(t); return [...ts.filter((x) => x.kind === 'word').map((x) => (x as { text: string }).text), ...ts.filter((x) => x.kind === 'tag').map((x) => `{${(x as { body: string }).body}}`)].join(' '); };
const btoks = (b: { words: { text: string }[]; tags: { body: string }[] }) => [...b.words.map((w) => w.text), ...b.tags.map((t) => `{${t.body}}`)].join(' ');

const SCRIPT = [
  'A competitive inhibitor {{highlight p=4 "The inhibitor competes"}} competes with the substrate, so e.g. 0.5 more is needed. It still reaches Vmax!',
  '{{sketch id=s near=p4}} {{bars on=s id=v vals=1,2,3}} Here are the rates as bars. {{bars on=s id=w map=v fn="x*2" right=v}} Doubling them gives these, with a few more words to pass the minimum easily.',
  'A tag {{line on=s\nfrom=A}} broken by a newline is narration. The end {{emph id=v}}',
].join('\n\n');

describe('BeatSplitter', () => {
  it('reproduces the stream exactly and equals beats() / units() at random chunk boundaries', () => {
    for (let seed = 1; seed < 60; seed++) {
      const b = split(SCRIPT, 'beat', seed);
      expect(b.map((u) => u.text).join('')).toBe(SCRIPT);
      expect(b.map((u) => toks(u.text))).toEqual(beats(SCRIPT, { tail: false }).map(btoks));
      const s = split(SCRIPT, 'sentence', seed);
      expect(s.map((u) => u.text).join('')).toBe(SCRIPT);
      expect(s.map((u) => toks(u.text))).toEqual(units(SCRIPT).map(btoks));
    }
  });

  it('waits for a partial word and an unclosed tag; a sentence closes once followed by whitespace', () => {
    const s = new BeatSplitter('sentence');
    expect(s.push('One two.')).toEqual([]);
    expect(s.push(' Three {{highlight p=1 "a b')).toMatchObject([{ text: 'One two.' }]);
    expect(s.push('"}} four.')).toEqual([]);
    expect(s.end()).toMatchObject([{ text: ' Three {{highlight p=1 "a b"}} four.' }]);
  });

  it('tags after a sentence end ride with the next sentence', () => {
    const s = new BeatSplitter('sentence');
    expect(s.push('One. {{sketch id=s}} ')).toMatchObject([{ text: 'One.' }]);
    expect(s.end()).toMatchObject([{ text: ' {{sketch id=s}} ' }]);
  });

  it('switching to sentence mode closes the beat in progress', () => {
    const s = new BeatSplitter('beat');
    expect(s.push('One two three. Four five. ')).toEqual([]);
    expect(s.setMode('sentence')).toMatchObject([{ text: 'One two three. Four five.', kind: 'beat' }]);
    expect(s.push('Six. Seven')).toMatchObject([{ text: ' Six.', kind: 'sentence' }]);
  });

  it('every recorded stage-2 script splits back to itself, equal to beats()', () => {
    const root = runsDir();
    let n = 0;
    for (const run of listRuns(root).filter((r) => /draw|q2/.test(r)).slice(0, 12)) {
      for (const rec of loadRun(run, root)) {
        const text = rec.script.slice(rec.stage2At);
        const b = split(text, 'beat', n + 7);
        expect(b.map((u) => u.text).join('')).toBe(text);
        expect(b.map((u) => toks(u.text)).filter(Boolean)).toEqual(beats(text, { tail: false }).map(btoks));
        n++;
      }
    }
    if (listRuns(root).length) expect(n).toBeGreaterThan(0);
  });
});
