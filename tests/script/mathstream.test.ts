// tests/script/mathstream.test.ts
import { it, expect } from 'vitest';
import { ScriptParser } from '../../src/script/parser';
it('a math tag with }} inside its TeX survives any chunking', () => {
  const s = 'So {{math on=side at=1,1 "\\frac{1}{x^{2}}"}} this one and {{axes on=side at=100,600 size=500,400 x="depth z" y="d"}} done.';
  for (let k = 1; k < 9; k++) {
    const p = new ScriptParser();
    const ev = [];
    for (let i = 0; i < s.length; i += k) ev.push(...p.push(s.slice(i, i + k)));
    ev.push(...p.end());
    const acts = ev.filter((e) => e.type === 'action').map((e) => (e as any).action);
    expect(acts).toHaveLength(2);
    expect(acts[0].tex).toBe('\\frac{1}{x^{2}}');
    expect(acts[1].xLabel).toBe('depth z');
  }
});
