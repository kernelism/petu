// src/pdf/mathGlyphs.ts — repairs math text whose ToUnicode map is wrong.
//
// Some exporters (Keynote with LaTeX equations is the common one) subset each TeX font into its own
// tiny font, number the glyphs from 33 and write a ToUnicode map that sends those codes to unrelated
// characters: CMSY "multiply" comes out as ⇥, "similar" as ⇠, "asteriskmath" as ⇤, CMMI "epsilon1"
// as ✏, CMEX "parenleftbigg" as ✓, and "minus", "sigma", "lambda" as U+0000. The font's /Differences
// still name the real glyphs, so for such fonts the glyph name wins. Only implausible ToUnicode
// values are replaced (arrows, dingbats, technical and geometric symbols, control and private-use
// characters): a sensible map is never second-guessed.
//
// Font data comes from pdf.js's `page.commonObjs` (needs `fontExtraProperties: true` on the document).

/** What pdf.js exports for a font with `fontExtraProperties` (only the fields used here). */
export type FontData = { name?: string; differences?: (string | undefined)[]; toUnicode?: { _map?: (string | number | undefined)[] } | null };

const GREEK: Record<string, string> = {
  alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', epsilon: 'ϵ', epsilon1: 'ε', zeta: 'ζ', eta: 'η', theta: 'θ', theta1: 'ϑ',
  iota: 'ι', kappa: 'κ', lambda: 'λ', mu: 'μ', nu: 'ν', xi: 'ξ', pi: 'π', pi1: 'ϖ', rho: 'ρ', rho1: 'ϱ', sigma: 'σ', sigma1: 'ς',
  tau: 'τ', upsilon: 'υ', phi: 'ϕ', phi1: 'φ', chi: 'χ', psi: 'ψ', omega: 'ω',
  Gamma: 'Γ', Delta: 'Δ', Theta: 'Θ', Lambda: 'Λ', Xi: 'Ξ', Pi: 'Π', Sigma: 'Σ', Upsilon: 'Υ', Phi: 'Φ', Psi: 'Ψ', Omega: 'Ω',
};
const SYMBOLS: Record<string, string> = {
  // CMSY
  minus: '−', periodcentered: '·', multiply: '×', asteriskmath: '∗', divide: '÷', diamondmath: '⋄', plusminus: '±', minusplus: '∓',
  circleplus: '⊕', circleminus: '⊖', circlemultiply: '⊗', circledivide: '⊘', circledot: '⊙', circlecopyrt: '◯', openbullet: '∘', bullet: '•',
  equivasymptotic: '≍', equivalence: '≡', reflexsubset: '⊆', reflexsuperset: '⊇', lessequal: '≤', greaterequal: '≥',
  precedesequal: '⪯', followsequal: '⪰', similar: '∼', approxequal: '≈', propersubset: '⊂', propersuperset: '⊃',
  lessmuch: '≪', greatermuch: '≫', precedes: '≺', follows: '≻', arrowleft: '←', arrowright: '→', arrowup: '↑', arrowdown: '↓',
  arrowboth: '↔', arrownortheast: '↗', arrowsoutheast: '↘', similarequal: '≃', arrowdblleft: '⇐', arrowdblright: '⇒',
  arrowdblup: '⇑', arrowdbldown: '⇓', arrowdblboth: '⇔', arrownorthwest: '↖', arrowsouthwest: '↙', proportional: '∝',
  prime: '′', infinity: '∞', element: '∈', owner: '∋', triangle: '△', triangleinv: '▽', negationslash: '/', universal: '∀',
  existential: '∃', logicalnot: '¬', emptyset: '∅', Rfractur: 'ℜ', Ifractur: 'ℑ', latticetop: '⊤', perpendicular: '⊥', aleph: 'ℵ',
  union: '∪', intersection: '∩', unionmulti: '⊎', logicaland: '∧', logicalor: '∨', turnstileleft: '⊢', turnstileright: '⊣',
  floorleft: '⌊', floorright: '⌋', ceilingleft: '⌈', ceilingright: '⌉', braceleft: '{', braceright: '}', angbracketleft: '⟨',
  angbracketright: '⟩', bar: '|', bardbl: '∥', arrowbothv: '↕', arrowdblbothv: '⇕', backslash: '\\', wreathproduct: '≀', radical: '√',
  coproduct: '⨿', nabla: '∇', integral: '∫', unionsq: '⊔', intersectionsq: '⊓', subsetsqequal: '⊑', supersetsqequal: '⊒',
  section: '§', dagger: '†', daggerdbl: '‡', paragraph: '¶', club: '♣', diamond: '♢', heart: '♡', spade: '♠', mapsto: '↦',
  // CMMI
  partialdiff: '∂', lscript: 'ℓ', weierstrass: '℘', dotlessi: 'ı', dotlessj: 'ȷ', star: '⋆', triangleright: '▷', triangleleft: '◁',
  less: '<', greater: '>', slash: '/', flat: '♭', natural: '♮', sharp: '♯', period: '.', comma: ',', vector: '→',
  // CMEX bases (sizes stripped below)
  parenleft: '(', parenright: ')', bracketleft: '[', bracketright: ']', summation: '∑', product: '∏', contintegral: '∮',
  uniontext: '⋃', intersectiontext: '⋂', hat: '^', tilde: '~',
  // CMR and friends
  equal: '=', plus: '+', colon: ':', semicolon: ';', exclam: '!', question: '?', quoteright: '’', quoteleft: '‘', hyphen: '-',
  endash: '–', emdash: '—', zero: '0', one: '1', two: '2', three: '3', four: '4', five: '5', six: '6', seven: '7', eight: '8', nine: '9',
};

/** The Unicode for a TeX glyph name, or undefined. CMEX sizes ("parenleftbigg", "summationdisplay") map to their base. */
export function glyphUnicode(name: string): string | undefined {
  if (GREEK[name]) return GREEK[name];
  if (SYMBOLS[name]) return SYMBOLS[name];
  if (/^[A-Za-z]$/.test(name)) return name;
  const base = name.replace(/(big|Big|bigg|Bigg|text|display|wide|wider|widest)$/, '');
  if (base !== name) return SYMBOLS[base] ?? GREEK[base];
  const u = /^uni([0-9A-F]{4})$/.exec(name);
  return u ? String.fromCodePoint(parseInt(u[1], 16)) : undefined;
}

/** TeX math fonts (subset prefix allowed): Computer Modern symbols/italics/extensions, AMS symbols. */
const TEX_MATH = /(^|\+)(CMSY|CMMI|CMEX|CMBSY|CMMIB|MSAM|MSBM)\d*$/;

/** A ToUnicode value no math font means: arrows, technical, geometric shapes, dingbats, controls, private use. */
export function implausible(s: string): boolean {
  if (!s) return true;
  for (const ch of s) {
    const c = ch.codePointAt(0)!;
    if (c < 0x20 || (c >= 0x7f && c < 0xa0)) return true;
    if (c >= 0x2190 && c <= 0x21ff && c !== 0x2190 && c !== 0x2192) return true; // ← → are real arrows people write
    if ((c >= 0x2300 && c <= 0x23ff) || (c >= 0x25a0 && c <= 0x25ff) || (c >= 0x2700 && c <= 0x27bf)) return true;
    if ((c >= 0xe000 && c <= 0xf8ff) || c === 0xfffd) return true;
  }
  return false;
}

/**
 * A per-font character fix: garbled string → the glyph it draws. Only codes whose name is known and
 * whose ToUnicode value is implausible are fixed; a garbled value shared by several codes is left alone.
 */
export function fontRepair(f: FontData | null | undefined): Map<string, string> | null {
  const diffs = f?.differences, map = f?.toUnicode?._map;
  if (!diffs || !map) return null;
  const by = new Map<string, Set<string>>();
  const texMath = TEX_MATH.test(f?.name ?? '');
  for (let code = 0; code < diffs.length; code++) {
    const name = diffs[code];
    if (!name) continue;
    const raw = map[code];
    const u = typeof raw === 'string' ? raw : typeof raw === 'number' ? String.fromCodePoint(raw) : '';
    const want = glyphUnicode(name);
    // TeX math fonts name their glyphs reliably; elsewhere only an implausible value is replaced.
    if (!want || u === want || !u || !(implausible(u) || (texMath && code >= 33))) continue;
    let s = by.get(u);
    if (!s) by.set(u, (s = new Set()));
    s.add(want);
  }
  const out = new Map<string, string>();
  for (const [u, wants] of by) if (wants.size === 1) out.set(u, [...wants][0]);
  return out.size ? out : null;
}

/** Repairs one text item's string with its font's fix (see fontRepair). */
export function repairText(s: string, fix: Map<string, string> | null): string {
  if (!fix || !s) return s;
  let out = '';
  for (const ch of s) out += fix.get(ch) ?? ch;
  return out;
}

/** Font lookups for a page: `commonObjs` entries that are already resolved (never waits, never throws). */
export function fontLookup(objs: { has?(id: string): boolean; get(id: string): unknown } | undefined): (fontName: string) => Map<string, string> | null {
  const cache = new Map<string, Map<string, string> | null>();
  return (name) => {
    if (!objs || !name) return null;
    if (cache.has(name)) return cache.get(name)!;
    let fix: Map<string, string> | null = null;
    try { if (!objs.has || objs.has(name)) fix = fontRepair(objs.get(name) as FontData); } catch { fix = null; }
    cache.set(name, fix);
    return fix;
  };
}
