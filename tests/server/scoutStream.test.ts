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
    const { out, g } = run(['{{highlight p=3 "x. y"}} Sample e.g. the points. Next']);
    expect(out[0]).toBe('{{highlight p=3 "x. y"}} Sample e.g. the points. ');
    expect(out.at(-1)).toBe('Next');
    // A decimal is a number: its sentence goes whole (not cut at the point).
    expect(run(['Sample 3.5 points. Next']).g.notes).toEqual(['opener: dropped a number "Sample 3.5 points."']);
    expect(g.notes).toEqual([]);
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

  it('lets a clause through as soon as it ends (not a tiny one), never inside a tag', () => {
    const g = new OpenerGate(3);
    expect(g.push('So, ')).toBe('');
    // The clause's separator waits for the next piece (it may be cut there: see the numbers below).
    expect(g.push('the window slides over the corner, and ')).toBe('So, the window slides over the corner');
    expect(g.push('{{highlight p=3 "a, b"}} both shift')).toBe('');
    expect(g.end()).toBe(', and {{highlight p=3 "a, b"}} both shift');
    expect(g.said).toBe('So, the window slides over the corner, and {{highlight p=3 "a, b"}} both shift');
  });

  it('a dropped mark the sentence used as a word keeps its words; a dropped pointer says nothing', () => {
    // Synthetic: the opener quotes another page (dropped), but the sentence needs its words.
    expect(run(['{{highlight p=7 "osmosis"}} moves water across the membrane. ']).g.said).toBe('Osmosis moves water across the membrane. ');
    expect(run(['The {{highlight p=7 "cell membrane"}} lets water through, so cells swell. ']).g.said).toBe('The cell membrane lets water through, so cells swell. ');
    expect(run(['Water crosses the {{underline p=7 "membrane"}}. ']).g.said).toBe('Water crosses the membrane. ');
    expect(run(['The {{highlight p=7 "membrane"}} membrane lets water through. ']).g.said.replace(/\s+/g, ' ')).toBe('The membrane lets water through. ');
    expect(run(['{{highlight p=7 "Osmosis"}} This page explains it. ']).g.said.trim()).toBe('This page explains it.');
  });

  it('drops an unclosed tag at the end', () => {
    expect(run(['Look here {{highlight p=3 "unfinish']).g.said).toBe('Look here ');
  });

  // C7: the opener orients; the worked case (stage 2, with a board) makes the numeric claims.
  describe('a sentence that says a number is not spoken', () => {
    it('drops a numeric sentence and releases the clean one after it on the push that completes it', () => {
      const g = new OpenerGate(3);
      expect(g.push('It lands 180 m downstream. ')).toBe('');
      expect(g.push('The aim has to cancel the current. ')).toBe('The aim has to cancel the current. ');
      expect(g.end()).toBe('');
      expect(g.said).toBe('The aim has to cancel the current. ');
      expect(g.notes).toEqual(['opener: dropped a number "It lands 180 m downstream."']);
    });

    it('spelled cardinals count; "one", ordinals and names with digits do not', () => {
      expect(run(['Thirty and sixty degrees land together. Both fly. ']).g.said).toBe('Both fly. ');
      expect(run(['It takes twice as long. Both fly. ']).g.said).toBe('Both fly. ');
      expect(run(['The one on the right comes first. ']).g.said).toBe('The one on the right comes first. ');
      expect(run(['CO2 and the L1 norm stay put. ']).g.said).toBe('CO2 and the L1 norm stay put. ');
      // Counting what the page shows (eval D18) and a concept's name are not results.
      expect(run(['Percent change uses the average of the two values. ']).g.said).toBe('Percent change uses the average of the two values. ');
      expect(run(['It moves two metres. Both fly. ']).g.said).toBe('Both fly. ');
    });

    it('a page number or quoted figure inside a tag is pointing, not a claim', () => {
      const { g } = run(['{{highlight p=3 "range 35.3 m"}} This line is the claim we test. ']);
      expect(g.said).toBe('{{highlight p=3 "range 35.3 m"}} This line is the claim we test. ');
    });

    it('a later clause that turns numeric cuts the sentence there and closes it: no dangling comma', () => {
      // Eval D20's opener (p6.1): the clause before the number has already played.
      const g = new OpenerGate(6);
      const out = [g.push('Those effects balance, '), g.push('so 30 and 60 degrees land at the same spot. '), g.push('Both rise and fall. '), g.end()];
      expect(out).toEqual(['Those effects balance', '. ', 'Both rise and fall. ', '']);
      expect(g.said).toBe('Those effects balance. Both rise and fall. ');
    });

    it('a sentence numeric from its first clause goes whole, its clean clauses too', () => {
      expect(run(['The 60-degree launch goes higher and stays longer, ', 'but it moves sideways more slowly. ', 'So the effects balance. ']).g.said).toBe('So the effects balance. ');
    });

    it('keeps at least one sentence: when all say a number, the first is spoken at the end', () => {
      const { out, g } = run(['It lands 180 m downstream, ', 'in 120 s. ', 'The aim is 37 degrees. ']);
      expect(out.slice(0, 3)).toEqual(['', '', '']);
      expect(g.said).toBe('It lands 180 m downstream, in 120 s. ');
      expect(g.notes.at(-1)).toBe('opener: every sentence said a number; the first is spoken anyway');
    });

    it('the first caption word is not later: a clean first clause goes out on the push that completes it', () => {
      const g = new OpenerGate(3);
      expect(g.push('The ferry aims upstream because, ')).toBe('The ferry aims upstream because');
      // An opener that stops at the clause still ends on a word boundary (no hold at the seam to stage 2).
      expect(g.end()).toBe(', ');
    });
  });
});
