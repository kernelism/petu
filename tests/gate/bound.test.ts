// Gated beats, step 2: bound numbers in the gate (typed engine numbers flagged, unresolved vals fail
// the beat), constants before statements (gate + lint).
import { describe, expect, it } from 'vitest';
import { checkOrder, checkUnbound } from '../../src/gate/check';
import { GateState } from '../../src/gate/engine';
import { parseTag } from '../../src/script/parseTag';
import { gateAnswer } from '../../scripts/gate-beats/gateRun';
import type { Recording } from '../../scripts/gate-beats/recordings';
import { Lint } from '../../server/lint';
import { EXAMPLES } from '../../server/prompt/examples';
import { ScriptFilter } from '../../server/scriptFilter';

const W = (s: string) => s.split(/\s+/).filter(Boolean);
const rec = (script: string): Recording => ({ run: 'r', q: 'q', dir: '', question: 'Why?', script, stage2At: 0, chunks: [], stage2Chunk: 0, words: [], timings: [], registry: [] });
const flagsOf = (script: string) => gateAnswer(rec(script), { pages: new Map() }).beats.flatMap((b) => b.verdict.flags);

describe('bound numbers in the gate', () => {
  it('flags a typed number only the engine has; the page, literals and small counts pass', () => {
    const st = new GateState();
    for (const t of ['bars on=s id=v vals=12,30,48', 'calc on=s id=t of=v reduce=sum']) st.apply(parseTag(t)!, 0);
    st.addValues([90], 'page', 'p1', -1);
    expect(checkUnbound(W('The total is 90, and 12 is the first.'), st.values)).toEqual([]); // 90 is also on the page; 12 a literal
    const st2 = new GateState();
    for (const t of ['bars on=s id=v vals=12,30,48', 'calc on=s id=t of=v reduce=mean']) st2.apply(parseTag(t)!, 0);
    expect(checkUnbound(W('The mean is 30.'), st2.values)).toEqual([]); // 30 is also a literal bar
    st2.apply(parseTag('bars on=s id=d map=v fn="x*1.5"')!, 0);
    expect(checkUnbound(W('so the last becomes 72, about 45 for the second.'), st2.values).map((f) => f.check)).toEqual(['unbound']); // 72 typed; 45 hedged
  });
  it('a val-bound script passes; the same number typed fails; an unknown val fails the beat', () => {
    const s = '{{sketch id=s}} Prices {{bars on=s id=p vals=2,4,7}} add up {{calc on=s id=t of=p reduce=sum}} to {{val id=t}}, as the board shows.';
    expect(flagsOf(s).filter((f) => f.check === 'unbound' || f.check === 'tag')).toEqual([]);
    expect(flagsOf(s.replace('{{val id=t}}', '13')).map((f) => f.check)).toContain('unbound');
    expect(flagsOf(s.replace('{{val id=t}}', '{{val id=q}}')).find((f) => f.check === 'tag')?.detail).toMatch(/val id=q.*unbound/);
  });
  it('readouts and moves replay in the gate as at runtime', () => {
    const s = '{{sketch id=s}} {{const tax=0}} Two lines {{plot on=s id=d fn="12-x/5" domain=0,50}} and {{plot on=s id=u fn="2+tax+x/10" domain=0,50 axes=d}} meet {{find id=E of=d,u}} at {{val id=E}}. ' +
      '{{beforeafter of=u tax=1.5}} With the tax the price is {{val id=E}}, and {{contrast of=u tax=3}} a bigger tax lifts it more.';
    expect(flagsOf(s).filter((f) => f.check === 'tag' || f.check === 'unbound')).toEqual([]);
    expect(flagsOf(s.replace('at {{val id=E}}', 'at 5.33')).map((f) => f.check)).toContain('unbound');
  });
});

describe('the prompt examples', () => {
  it('state no engine number by hand, and every val resolves', () => {
    for (const ex of EXAMPLES) {
      const f = new ScriptFilter();
      const flags = flagsOf(f.push(ex.script) + f.end()).filter((x) => x.check === 'unbound' || x.check === 'order' || (x.check === 'tag' && /val/.test(x.detail)));
      expect(flags, ex.title).toEqual([]);
    }
  });
});

describe('constants before statements', () => {
  const consts = [{ name: 'v', v: 20, beat: 3 }];
  it('allows one beat of look-ahead, flags earlier use', () => {
    expect(checkOrder(W('It leaves at 20 metres a second.'), 2, consts)).toEqual([]);
    expect(checkOrder(W('It leaves at 20 metres a second.'), 1, consts).map((f) => f.check)).toEqual(['order']);
    expect(checkOrder(W('It leaves at 20 metres a second.'), 4, consts)).toEqual([]);
  });
  it('lint notes a formula or a val naming a constant declared later', () => {
    const l = new Lint();
    l.push('{{plot on=s id=p fn="v*x-g*x^2/2" domain=0,4}} it is {{val id=g}} {{const v=20 g=9.8}} {{plot on=s fn="v*x" domain=0,1}}');
    l.end();
    expect(l.notes.filter((n) => /before it is declared/.test(n)).map((n) => n.split(':')[0])).toEqual(['constant v used before it is declared', 'constant g used before it is declared']);
  });
});
