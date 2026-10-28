import { describe, expect, it } from 'vitest';
import { OpenerGate, ScoutJson } from '../../server/scoutStream';

/** Feeds `text` to a fresh parser in pieces of `n` characters; returns the string deltas and fields seen. */
function feed(text: string, n: number) {
  const deltas: Record<string, string> = {};
  const order: string[] = [];
  const j = new ScoutJson({
    onString: (k, d) => { deltas[k] = (deltas[k] ?? '') + d; },
    onField: (k) => { order.push(k); },
  });
  for (let i = 0; i < text.length; i += n) j.push(text.slice(i, i + n));
  return { j, deltas, order };
}

describe('ScoutJson (streamed scout object)', () => {
  const obj = { opener: 'It finds the {{highlight p=3 "best \\"fit\\""}} line — 90% of inliers.\nThen é ✓ 𝑥.', pages: [3, 5, 4], plan: 'walk 3, 5, 4; draw a line through points' };
  const text = JSON.stringify(obj);

  it('decodes every string field and parses the array, for any split of the stream', () => {
    for (const n of [1, 2, 3, 7, 64, text.length]) {
      const { j, deltas, order } = feed(text, n);
      expect(j.fields, `n=${n}`).toEqual(obj);
      expect(deltas.opener, `n=${n}`).toBe(obj.opener);
      expect(deltas.plan).toBe(obj.plan);
      expect(order).toEqual(['opener', 'pages', 'plan']);
      expect(j.complete).toBe(true);
    }
  });

  it('decodes \\u escapes, surrogate pairs included, split anywhere', () => {
    const t = '{"opener":"a\\u00e9b\\ud835\\udc65c","pages":[1],"plan":""}';
    for (const n of [1, 2, 5]) expect(feed(t, n).deltas.opener).toBe('aéb𝑥c');
  });

  it('streams the opener before the object is complete', () => {
    const seen: string[] = [];
    const j = new ScoutJson({ onString: (k, d) => { if (k === 'opener') seen.push(d); } });
    j.push('{"opener":"First sen');
    expect(seen.join('')).toBe('First sen');
    expect(j.fields).toEqual({});
    j.push('tence.","pag');
    expect(j.fields).toEqual({ opener: 'First sentence.' });
    expect(j.complete).toBe(false);
  });

  it('handles whitespace, other key orders and scalars; junk produces no fields and no throw', () => {
    expect(feed('{ "pages" : [ 2 , 3 ] ,\n "plan" : "p", "n": 4, "ok": true }', 3).j.fields).toEqual({ pages: [2, 3], plan: 'p', n: 4, ok: true });
    expect(feed('{"pages":[[1],{"a":"]"}],"plan":"x"}', 1).j.fields).toEqual({ pages: [[1], { a: ']' }], plan: 'x' });
    expect(() => feed('not json at all', 2)).not.toThrow();
    expect(feed('not json at all', 2).j.fields).toEqual({});
  });
});

describe('OpenerGate (opener → spoken script)', () => {
  const run = (parts: string[], page = 3) => {
    const g = new OpenerGate(page);
    const out = parts.map((p) => g.push(p));
    out.push(g.end());
    return { out, g };
  };

  it('releases whole sentences only: the first as soon as it ends', () => {
    const { out, g } = run(['It picks the li', 'ne with the most inliers. ', 'The rest are', ' outliers.']);
    expect(out).toEqual(['', 'It picks the line with the most inliers. ', '', '', 'The rest are outliers.']);
    expect(g.said).toBe('It picks the line with the most inliers. The rest are outliers.');
  });

  it('never splits inside a tag, nor at e.g. or a decimal point', () => {
    const { out } = run(['{{highlight p=3 "x. y"}} Sample e.g. 3.5 points. Next']);
    expect(out[0]).toBe('{{highlight p=3 "x. y"}} Sample e.g. 3.5 points. ');
    expect(out.at(-1)).toBe('Next');
  });

  it('keeps pointing tags on the visible page; drops other pages, the board, scrolls and sketches', () => {
    const { g } = run(['{{circle p=3 mark=#d2}} This dot, {{highlight p=7 "far"}}not that, {{scroll p=5}}{{sketch id=s near=p3 fit}}{{line on=s from=A to=B}}{{box p=3 mark=#e1}} and this box.']);
    expect(g.said).toBe('{{circle p=3 mark=#d2}} This dot, not that, {{box p=3 mark=#e1}} and this box.');
    expect(g.notes).toHaveLength(4);
  });

  it('cleans markdown and TeX from the narration (not inside tags)', () => {
    const { g } = run(['The **key** is $x$ and `y`: {{highlight p=3 "**raw**"}} here.']);
    expect(g.said).toBe('The key is x and y: {{highlight p=3 "**raw**"}} here.');
  });

  it('lets a very long sentence through at a clause break', () => {
    const long = `${'word '.repeat(50)}, and then ${'more '.repeat(10)}`;
    const g = new OpenerGate(1);
    expect(g.push(long)).toMatch(/, $/);
  });

  it('drops an unclosed tag at the end', () => {
    expect(run(['Look here {{highlight p=3 "unfinish']).g.said).toBe('Look here ');
  });
});
