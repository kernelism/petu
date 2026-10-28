import { describe, it, expect } from 'vitest';
import { fontLookup, fontRepair, glyphUnicode, implausible, repairText } from '../../src/pdf/mathGlyphs';
import { itemsToRuns } from '../../src/pdf/textRuns';

/** A Keynote-style subset font: codes from 33, a garbled ToUnicode, the real names in /Differences. */
const font = (name: string, glyphs: [string, string][]) => {
  const differences: string[] = [], _map: string[] = [];
  glyphs.forEach(([g, u], i) => { differences[33 + i] = g; _map[33 + i] = u; });
  return { name, differences, toUnicode: { _map } };
};

describe('math-font text repair', () => {
  it('maps TeX glyph names, CMEX sizes included', () => {
    expect(['multiply', 'similar', 'approxequal', 'asteriskmath', 'minus', 'epsilon1', 'sigma', 'lambda', 'theta', 'parenleftbigg', 'summationdisplay', 'x'].map(glyphUnicode))
      .toEqual(['×', '∼', '≈', '∗', '−', 'ε', 'σ', 'λ', 'θ', '(', '∑', 'x']);
    expect(glyphUnicode('g33')).toBeUndefined();
  });
  it('implausible: arrows, dingbats, controls, private use; not letters, ASCII or ← →', () => {
    expect(['⇥', '⇠', '⇤', '✓', '✏', '◆', '\u0000', ''].every(implausible)).toBe(true);
    expect(['x', '/', '×', 'σ', '→', '←'].some(implausible)).toBe(false);
  });
  it('lec05: ⇥ → ×, ⇠ → ∼, ⇤ → ∗, ✏ → ε, U+0000 → σ / − / λ, ✓◆ → ( )', () => {
    const fix = (f: ReturnType<typeof font>, s: string) => repairText(s, fontRepair(f));
    expect(fix(font('AAAACN+CMSY7', [['multiply', '⇥']]), '⇥')).toBe('×');
    expect(fix(font('AAAACP+CMSY10', [['similar', '⇠']]), '⇠ ')).toBe('∼ ');
    expect(fix(font('AAAABT+CMSY7', [['asteriskmath', '⇤']]), '⇤')).toBe('∗');
    expect(fix(font('AAAABA+CMMI10', [['epsilon1', '✏'], ['sigma', '\u0000']]), '✏\u0000')).toBe('εσ');
    expect(fix(font('AAAABM+CMEX10', [['parenleftbigg', '✓'], ['parenrightbigg', '◆']]), '✓◆')).toBe('()');
    // TeX math fonts: the name wins even over a plausible value (CMSY "proportional" written as "/").
    expect(fix(font('AAAABK+CMSY10', [['proportional', '/']]), '/')).toBe('∝');
  });
  it('leaves a sensible map alone, and an ambiguous garble (two glyphs on one value) unchanged', () => {
    expect(fontRepair(font('Helvetica', [['slash', '/']]))).toBeNull();
    expect(fontRepair(font('AAAA+CMSY10', [['minus', '−']]))).toBeNull();
    expect(repairText('\u0000', fontRepair(font('X+CMMI10', [['sigma', '\u0000'], ['lambda', '\u0000']])))).toBe('\u0000');
    expect(fontRepair({ name: 'X' })).toBeNull();
  });
  it('fontLookup reads resolved commonObjs only, caches, never throws', () => {
    let gets = 0;
    const objs = { has: (id: string) => id === 'f1', get: (id: string) => { gets++; if (id !== 'f1') throw new Error('unresolved'); return font('A+CMSY7', [['multiply', '⇥']]); } };
    const look = fontLookup(objs);
    expect(look('f1')?.get('⇥')).toBe('×');
    look('f1');
    expect(gets).toBe(1);
    expect(look('f2')).toBeNull();
    expect(fontLookup(undefined)('f1')).toBeNull();
  });
  it('itemsToRuns repairs each item with its font and drops leftover control characters', () => {
    const fonts = fontLookup({ get: () => font('A+CMSY7', [['multiply', '⇥']]) });
    const runs = itemsToRuns([
      { str: '⇥', transform: [10, 0, 0, 10, 100, 500], width: 8, height: 10, fontName: 'f5' },
      { str: '\u0000', transform: [10, 0, 0, 10, 120, 500], width: 8, height: 10, fontName: 'f9' },
    ], [1, 0, 0, -1, 0, 560], 800, 560, undefined, (n) => (n === 'f5' ? fonts(n) : null));
    expect(runs.map((r) => r.text)).toEqual(['×']);
  });
  it('drops LaTeXiT hidden source blocks, in one item or across several, and private-use glyphs', () => {
    const it = (str: string, x: number) => ({ str, transform: [10, 0, 0, 10, x, 500], width: 8, height: 10 });
    const vt = [1, 0, 0, -1, 0, 560];
    expect(itemsToRuns([it('<latexit sha1_base64="AA=">BBB</latexit>', 10), it('L(p)', 30)], vt, 800, 560).map((r) => r.text)).toEqual(['L(p)']);
    expect(itemsToRuns([it('∑', 5), it('<latexit ', 10), it('sha1_base64="0sx">AAAC', 20), it('Wq</latexit>', 30), it('(I', 40), it('\uf8ef', 50)], vt, 800, 560).map((r) => r.text)).toEqual(['∑', '(I']);
  });
});
