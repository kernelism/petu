import { describe, expect, it } from 'vitest';
import { SvgScriptFilter } from '../../server/svgBoard';
import { ScriptParser } from '../../src/script/parser';

describe('svgboard (experiment)', () => {
  it('lifts the SVG out of the stream and leaves {{svgboard}} and the show tags', () => {
    let got = '';
    const f = new SvgScriptFilter((s) => { got = s; }, () => 0);
    const src = '```svg\n<svg viewBox="0 0 1000 700"><g id="a"><path d="M0 0L10 10" stroke="black"/></g></svg>\n```\n{{show a}} The ball **falls** here. {{show b, c}} Then it rises.';
    let out = '';
    for (let i = 0; i < src.length; i += 7) out += f.push(src.slice(i, i + 7));
    out += f.end();
    expect(got).toBe('<svg viewBox="0 0 1000 700"><g id="a"><path d="M0 0L10 10" stroke="black"/></g></svg>');
    expect(out).toBe('{{svgboard}} {{show a}} The ball falls here. {{show b, c}} Then it rises.');
    const p = new ScriptParser();
    const acts = [...p.push(out), ...p.end()].flatMap((e) => (e.type === 'action' ? [e.action] : []));
    expect(acts).toEqual([{ kind: 'sketch', id: 'svgb', size: 'm', svgboard: true }, { kind: 'svgshow', ids: ['a'] }, { kind: 'svgshow', ids: ['b', 'c'] }]);
  });
});

describe('svgboard nesting (experiment)', () => {
  it('drops a stray bare <svg> before the real one and closes nested svgs in pairs', () => {
    let got = '';
    const f = new SvgScriptFilter((s) => { got = s; }, () => 0);
    const src = '<svg>\n<svg viewBox="0 0 1000 700"><svg x="1"><g id="a"/></svg><g id="b"/></svg>\n</svg>\n{{show a}} Hi.';
    let out = '';
    for (let i = 0; i < src.length; i += 5) out += f.push(src.slice(i, i + 5));
    out += f.end();
    expect(got).toBe('<svg viewBox="0 0 1000 700"><svg x="1"><g id="a"/></svg><g id="b"/></svg>');
    expect(out).toBe('{{svgboard}} {{show a}} Hi.');
  });
});
