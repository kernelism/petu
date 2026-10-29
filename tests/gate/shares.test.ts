// C10 of the draw benchmark (opus-low D1 t1): the value model knows `shares`, so {{val id=w[2] as=percent}}
// is said with the share the board shows, before and after a set.
import { describe, expect, it } from 'vitest';
import { GateState } from '../../src/gate/engine';
import { parseTag } from '../../src/script/parseTag';
import { ScriptParser } from '../../src/script/parser';

const said = (script: string) => {
  const p = new ScriptParser();
  const out = [...p.push(script), ...p.end()];
  return out.filter((x) => x.type === 'word').map((x) => (x as { text: string }).text).join(' ');
};

describe('shares in the value model', () => {
  it('a share part is its normalised value; set and a computed source follow', () => {
    const st = new GateState();
    for (const t of ['shares on=b id=w vals=1,1,1 labels=empty,ES,EI']) expect(st.apply(parseTag(t)!, 0)).toBeUndefined();
    expect(st.value('w[2]')).toMatchObject({ v: 1 / 3 });
    st.apply(parseTag('set id=w vals=1,2,1')!, 1);
    expect(st.value('w[2]')).toMatchObject({ v: 0.5 });
    st.apply(parseTag('bars on=b id=v vals=2,6')!, 2);
    st.apply(parseTag('shares on=b id=s map=v fn="x"')!, 2);
    expect(st.value('s[2]')).toMatchObject({ v: 0.75 });
    st.apply(parseTag('set id=v vals=1,1')!, 3);
    expect(st.value('s[2]')).toMatchObject({ v: 0.5 });
  });

  it('opus-low D1 t1 verbatim: every val on the shares part is bound', () => {
    const s = '{{scene id=b near=p4}} {{shares on=b id=w vals=1,1,1 labels=empty,ES,EI below=n "with I, [S] = 2"}} The ES share drops to {{val id=w[2] as=percent fmt=0}}, so the rate is below half. ' +
      '{{set id=w vals=1,2,1}} Double the substrate to four, and ES climbs back to {{val id=w[2] as=percent fmt=0}}. {{set id=w vals=1,20,1}} ES reaches {{val id=w[2] as=percent fmt=0}}.';
    const text = said(s);
    expect(text).toContain('to 33%,');
    expect(text).toContain('back to 50%.');
    expect(text).toContain('reaches 91%.');
    expect(text).not.toContain('—');
  });
});
