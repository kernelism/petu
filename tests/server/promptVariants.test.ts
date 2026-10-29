// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';
import { systemPrompt, promptVersionOf, PROMPT_VERSION, PROMPT_PARTS, buildSystemPrompt } from '../../server/prompt/system';
import { VARIANT_NAMES } from '../../server/prompt/variants/index';
import { DEMO_EXAMPLES } from '../../server/prompt/variants/exdemos';
import { BoardFirst, toBoardFirst, namesIn } from '../../server/boardFirst';
import { EXAMPLES } from '../../server/prompt/examples';
import { ScriptParser } from '../../src/script/parser';
import { ScriptFilter } from '../../server/scriptFilter';

/** EXPERIMENT knob (PETU_PROMPT_VARIANT): the default stays the p5.x prompt; variants differ only where they say. */
describe('prompt variants', () => {
  it('the default is untouched', () => {
    expect(systemPrompt()).toBe(buildSystemPrompt(PROMPT_PARTS));
    expect(systemPrompt(undefined)).toBe(systemPrompt());
    expect(promptVersionOf()).toBe(PROMPT_VERSION);
    expect(promptVersionOf('exdemos')).toBe(`${PROMPT_VERSION}-exdemos`);
    expect(() => systemPrompt('nope')).toThrow(/unknown prompt variant/);
    expect(VARIANT_NAMES).toEqual(['exdemos', 'boardfirst']);
  });

  it('exdemos: the three sentences gone, the demo examples in, nothing else changed', () => {
    const d = systemPrompt(), e = systemPrompt('exdemos');
    for (const gone of ['Say less and let the board carry it.', '40–70 spoken words', 'rather than adding beside it']) { expect(d).toContain(gone); expect(e).not.toContain(gone); }
    expect(e).toContain('Why does a competitive inhibitor not change Vmax?');
    expect(e).not.toContain('lighthouse');
    const head = (s: string) => s.slice(0, s.indexOf('EXAMPLES ('));
    const strip = (s: string) => s.replace(' rather than adding beside it', '').replace('Say less and let the board carry it. ', '').replace(/The PLAN's beats are your budget[^.]*\. /, '');
    expect(head(e)).toBe(strip(head(d)));
  });

  it('exdemos examples parse with no malformed tag and quote only listed text', () => {
    for (const ex of DEMO_EXAMPLES) {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      const p = new ScriptParser();
      const evs = [...p.push(ex.script), ...p.end()];
      expect(warn.mock.calls.filter((c) => String(c[0]).includes('malformed'))).toEqual([]);
      warn.mockRestore();
      expect(evs.filter((e) => e.type === 'action').length).toBeGreaterThan(8);
      for (const q of ex.script.matchAll(/p=\d+:?"([^"]+)"|\{\{(?:highlight|connect)[^}]*?"([^"]+)"/g)) {
        const quote = q[1] ?? q[2];
        if (/^\{\{connect/.test(q[0]) && !q[1]) continue;
        expect(ex.listing, quote).toContain(quote);
      }
      for (const m of ex.script.matchAll(/mark=(#\w+)|p\d+:(#\w+)/g)) expect(ex.listing).toContain(`${m[1] ?? m[2]} `);
    }
  });

  it('boardfirst changes only the output sentence, TIMING and the examples\' form', () => {
    const d = systemPrompt(), b = systemPrompt('boardfirst');
    expect(b).toContain('BOARD FIRST, THEN NARRATION');
    expect(b).not.toContain('\nTIMING\n');
    const cut = (s: string) => s.slice(s.indexOf('WHAT YOU GET'), s.indexOf('EXAMPLE 1'));
    expect(cut(b)).toBe(cut(d));
    expect(b.match(/SCRIPT:\n<board>/g)?.length).toBe(3); // example 1 draws nothing on the board
  });
});

/** Board actions (not sections, lets or constants) and the word they fire on. */
function played(script: string) {
  const f = new ScriptFilter();
  const text = f.push(script) + f.end();
  const p = new ScriptParser();
  let words = 0;
  const out: string[] = [];
  for (const e of [...p.push(text), ...p.end()]) {
    if (e.type === 'word') words++;
    else if (e.type === 'action' && !['sketch', 'let', 'const', 'emph'].includes(e.action.kind)) {
      const { id: _id, ...rest } = e.action as unknown as Record<string, unknown>;
      out.push(`${words}:${e.action.kind}:${JSON.stringify(rest).length}`);
    }
  }
  return out;
}

describe('board first', () => {
  it('names a tag mentions: ids and references, not keys, quotes or marks', () => {
    expect(namesIn('{{link on=s from=a to=f[2] strength=p[2] "what it does"}}')).toEqual(['s', 'a', 'f', 'p']);
    expect(namesIn('{{connect from=p4:#d3 to=s:X}}')).toEqual(['p4', 's', 'X']);
    expect(namesIn('{{val id=c.baker}}')).toEqual(['c']);
  });

  it('round trip: every p5.7 example converted and streamed back plays the same board on the same words', () => {
    for (const ex of EXAMPLES) {
      const bf = toBoardFirst(ex.script);
      const t = new BoardFirst();
      // stream it in awkward chunks, as the model would
      let out = '';
      for (let i = 0; i < bf.length; i += 7) out += t.push(bf.slice(i, i + 7));
      out += t.end();
      expect(out).not.toContain('<board>');
      expect(played(out), ex.title).toEqual(played(ex.script));
      expect(t.stats().hidden).toEqual([]);
    }
  });

  it('holds a declared element until the narration names it; deps first; unnamed stay hidden', () => {
    const t = new BoardFirst();
    const s = '<plan>p</plan><board>{{scene id=s near=p4}} {{node on=s id=a "A"}} {{node on=s id=b "B" right=a}} {{link on=s id=l from=a to=b "x"}} {{node on=s id=z "never"}}</board>\nFirst words. {{emph id=l}} Then the link. {{emph id=a}} Again.';
    const out = t.push(s) + t.end();
    expect(out).toBe('<plan>p</plan>{{scene id=s near=p4}} \nFirst words. {{node on=s id=a "A"}} {{node on=s id=b "B" right=a}} {{link on=s id=l from=a to=b "x"}} Then the link. {{emph id=a}} Again.');
    expect(t.stats()).toMatchObject({ declared: 4, revealed: 3, hidden: ['z'], immediate: 1 });
  });

  it('without a block the stream passes unchanged', () => {
    const t = new BoardFirst();
    const s = 'Plain {{highlight p=2 "x"}} words <b and {{emph id=q}} more.';
    expect(t.push(s.slice(0, 10)) + t.push(s.slice(10)) + t.end()).toBe(s);
  });
});

describe('PETU_PROMPT_VARIANT', async () => {
  const { parseEnv } = await import('../../server/env');
  const env = (v?: string) => parseEnv((k) => (k === 'PETU_PROMPT_VARIANT' ? v : undefined), { root: '/r', home: '/h' });
  it('is absent by default and validated', () => {
    expect('promptVariant' in env().model).toBe(false);
    expect(env('boardfirst').model.promptVariant).toBe('boardfirst');
    expect(() => env('p9')).toThrow(/PETU_PROMPT_VARIANT/);
  });
});
