// src/gate/numbers.ts — numbers stated in narration ("0.012", "twelve", "zero point nine nine",
// "fifty-eight percent", "2/3", "one-third") and matching them against known values with the
// tolerance their written precision implies. Pure.

export type Mention = {
  value: number;
  /** As written. */
  text: string;
  /** Index of its first and last word in the word list it came from. */
  w0: number; w1: number;
  /** Written as a percentage ("percent", "%"): value is the number before it (58, not 0.58). */
  percent: boolean;
  /** Hedged: about, roughly, approximately, nearly, around, almost, ~. */
  approx: boolean;
  /** Decimal places as written (0 for integers and words without "point"). */
  dp: number;
  /** A fraction as written (2/3, two-thirds). */
  frac: boolean;
  /** Words, not digits. */
  spelled: boolean;
  /** A reference, not a quantity: page 4, Figure 2, equation 3, step 2, lecture 9, x1 … */
  ref: boolean;
};

const UNITS: Record<string, number> = { zero: 0, oh: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19 };
const TENS: Record<string, number> = { twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };
const SCALES: Record<string, number> = { hundred: 100, thousand: 1000, million: 1e6, billion: 1e9 };
const DENOMS: Record<string, number> = { half: 2, halves: 2, third: 3, thirds: 3, quarter: 4, quarters: 4, fourth: 4, fourths: 4, fifth: 5, fifths: 5, sixth: 6, sixths: 6, eighth: 8, eighths: 8, tenth: 10, tenths: 10, sixteenth: 16, sixteenths: 16, hundredth: 100, hundredths: 100 };
const HEDGES = new Set(['about', 'roughly', 'approximately', 'around', 'nearly', 'almost', 'approx', 'approx.', '~', 'some', 'circa']);
const REF_WORDS = new Set(['page', 'pages', 'p', 'slide', 'slides', 'figure', 'fig', 'fig.', 'section', 'equation', 'eq', 'eq.', 'chapter', 'lecture', 'step', 'steps', 'exercise', 'problem', 'question', 'table', 'example', 'part', 'option', 'case', 'version', 'image', 'images', 'level', 'row', 'column', 'class', 'week', 'day', 'year', 'line', 'lines', 'item', 'sample', 'samples', 'system', 'trial', 'stage', 'layer', 'block', 'appendix', 'theorem', 'lemma', 'definition', 'algorithm', 'homework', 'hw']);

/** Lowercase, strip surrounding punctuation (keeps inner - . / % for parsing). */
const clean = (w: string) => w.toLowerCase().replace(/^[("“‘'[]+/, '').replace(/[)"”’'\],;:!?]+$/, '').replace(/\.$/, '').replace(/[’']s$/, '');

type Piece = { kind: 'num'; v: number; dp: number; frac: boolean; spelled: boolean; pct: boolean } | null;

function digits(w: string): Piece {
  let s = w.replace(/[−–]/g, '-');
  let pctSign = false;
  if (s.endsWith('%')) { pctSign = true; s = s.slice(0, -1); }
  s = s.replace(/^\$/, '');
  const fr = /^(-?\d+)\/(\d+)$/.exec(s);
  if (fr && Number(fr[2]) !== 0) return { kind: 'num', v: Number(fr[1]) / Number(fr[2]), dp: 2, frac: true, spelled: false, pct: pctSign };
  if (!/^-?(\d{1,3}(,\d{3})+|\d+)(\.\d+)?$|^-?\.\d+$/.test(s)) return null;
  const dp = s.includes('.') ? s.split('.')[1].length : 0;
  return { kind: 'num', v: Number(s.replace(/,/g, '')), dp, frac: false, spelled: false, pct: pctSign };
}

/**
 * Number mentions in a word list (narration words, tags removed). Spelled numbers combine
 * ("one hundred twenty", "forty-five", "zero point nine nine", "two thirds", "one-third").
 */
export function mentions(words: readonly string[]): Mention[] {
  const out: Mention[] = [];
  const lw = words.map(clean);
  // Split hyphenated spelled numbers into parts (forty-five, one-third, 30-degree keeps 30).
  type W = { s: string; wi: number; stop?: boolean };
  const ws: W[] = [];
  /** A word ending in punctuation ends a number ("ten and twenty. Nine" is 20 then 9). */
  const stops = words.map((w) => /[.,;:!?)"”’]$/.test(w));
  lw.forEach((w, wi) => {
    if (/^[a-z]+(-[a-z]+)+$/.test(w) && w.split('-').some((p) => p in UNITS || p in TENS || p in DENOMS)) w.split('-').forEach((p) => ws.push({ s: p, wi }));
    else if (/^-?\d[\d,.]*-[a-z]+$/.test(w)) ws.push({ s: w.split('-')[0], wi });
    else ws.push({ s: w, wi });
  });
  let i = 0;
  while (i < ws.length) {
    const start = i;
    const d = digits(ws[i].s);
    let value: number | null = null, dp = 0, frac = false, spelled = false, pct = false;
    if (d) { value = d.v; dp = d.dp; frac = d.frac; pct = d.pct; i++; }
    else if (ws[i].s in UNITS || ws[i].s in TENS || (ws[i].s === 'a' && ws[i + 1]?.s in SCALES)) {
      spelled = true;
      let total = 0, cur = 0;
      const take = () => {
        const s = ws[i]?.s;
        if (s == null) return false;
        if (s in UNITS) { cur += UNITS[s]; i++; return true; }
        if (s in TENS) { cur += TENS[s]; i++; return true; }
        if (s === 'a' && ws[i + 1]?.s in SCALES) { cur = 1; i++; return true; }
        if (s in SCALES && (cur > 0 || total > 0)) { const sc = SCALES[s]; if (sc === 100) cur *= 100; else { total += cur * sc; cur = 0; } i++; return true; }
        if (s === 'and' && ws[i + 1] && (ws[i + 1].s in UNITS || ws[i + 1].s in TENS) && (cur >= 100 || total > 0)) { i++; return true; }
        return false;
      };
      // "one hundred twenty": consume while the words keep forming one number; two bare units in a row ("one one") stop.
      let lastUnit = false;
      while (i < ws.length) {
        if (i > start && stops[ws[i - 1].wi] && ws[i - 1].wi !== ws[i].wi) break;
        const s = ws[i].s;
        const isUnit = s in UNITS && UNITS[s] < 10;
        if (lastUnit && (isUnit || s in TENS)) break;
        const before = i;
        if (!take()) break;
        lastUnit = s in UNITS && !(s in SCALES);
        if (i === before) break;
      }
      value = total + cur;
      // Decimals: "point nine nine".
      const stopped = () => i > start && stops[ws[i - 1].wi] && ws[i - 1].wi !== ws[i]?.wi;
      if (!stopped() && ws[i]?.s === 'point' && ws[i + 1] && ws[i + 1].s in UNITS && UNITS[ws[i + 1].s] < 10) {
        i++;
        let ds = '';
        while (ws[i] && ws[i].s in UNITS && UNITS[ws[i].s] < 10) { ds += String(UNITS[ws[i].s]); i++; }
        value = Number(`${value}.${ds}`); dp = ds.length;
      }
      // Fractions: "two thirds", "one-third", "one quarter", "a half".
      if (!stopped() && ws[i] && ws[i].s in DENOMS && ws[i].s !== 'half' || (ws[i]?.s === 'half' && value === 1)) {
        value = value / DENOMS[ws[i].s]; frac = true; dp = 2; i++;
      }
    } else if (ws[i].s === 'half' && i > 0 && ws[i - 1].s === 'a' && !(ws[i + 1]?.s === 'of')) { value = 0.5; frac = true; spelled = true; dp = 1; i++; }
    if (value == null) { i++; continue; }
    if (ws[i]?.s === 'percent' || ws[i]?.s === '%' || ws[i]?.s === 'per' && ws[i + 1]?.s === 'cent') { pct = true; i += ws[i].s === 'per' ? 2 : 1; }
    const w0 = ws[start].wi, w1 = ws[Math.max(start, i - 1)].wi;
    const prev = lw[w0 - 1] ?? '';
    const ref = REF_WORDS.has(prev) || /^[a-z]+\d+$/.test(lw[w0] ?? '') || (!spelled && prev === 'p');
    const approx = HEDGES.has(prev) || HEDGES.has(lw[w0 - 2] ?? '') && prev === 'is' || /^~/.test(words[w0] ?? '');
    out.push({ value, text: words.slice(w0, w1 + 1).join(' '), w0, w1, percent: pct, approx, dp, frac, spelled, ref });
  }
  return out;
}

/** Numbers in free text (page listings, tag literals): digits only, with fractions and percents. */
export function textNumbers(s: string): number[] {
  const out: number[] = [];
  for (const m of s.matchAll(/[−-]?\d+(?:,\d{3})*(?:\.\d+)?(?:\/\d+)?%?|[−-]?\.\d+/g)) {
    const d = digits(m[0]);
    if (d) out.push(d.v);
  }
  return out;
}

/** The tolerance a stated number implies: half a unit in its last written place, plus 0.5% relative. Hedged numbers get 10%. */
export function tolerance(m: Pick<Mention, 'dp' | 'approx' | 'frac' | 'value'>, target: number): number {
  const place = m.frac ? 0.005 : 0.5 * 10 ** -m.dp;
  const rel = (m.approx ? 0.1 : 0.005) * Math.abs(target);
  return Math.max(place, rel) + 1e-9;
}

/** The candidate values a mention may stand for: itself, and for a percentage also value/100. A bare decimal < 1 may also be a percentage (0.58 ~ 58%). */
export function readings(m: Mention): { v: number; scale: number }[] {
  const out = [{ v: m.value, scale: 1 }];
  if (m.percent) out.push({ v: m.value / 100, scale: 100 });
  return out;
}

/** Does a mention match a known value? */
export function matches(m: Mention, known: number): boolean {
  for (const r of readings(m)) {
    if (Math.abs(r.v - known) <= tolerance(m, r.v * r.scale) / r.scale) return true;
    // Sign-agnostic magnitudes: narration says "a fifty percent drop" for −50.
    if (Math.abs(r.v + known) <= tolerance(m, r.v * r.scale) / r.scale && known < 0) return true;
  }
  return false;
}
