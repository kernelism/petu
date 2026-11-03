// src/values/say.ts — how a bound number ({{val}}) is said: the caption text, in the board's own
// number format (src/desk/kit/compute.ts fmt) with the affixes the board writes around it (a readout's
// "${}", "{} units", "{}%": src/values/quantity.ts), and a spoken form for the TTS clock. Pure.
import { fmt as boardFmt } from '../desk/kit/compute';
import type { ValFormat } from '../script/types';
import { NO_AFFIX, quantity, type Affix } from './quantity';
import { readUnit, unitBefore, unitWords } from './units';

const ONES = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
const SCALES: [number, string][] = [[1e9, 'billion'], [1e6, 'million'], [1e3, 'thousand']];

/** A whole number in words ("one hundred thirty-three"); digits past a trillion stay digits. */
export function intWords(n: number): string {
  if (!Number.isInteger(n) || Math.abs(n) >= 1e12) return String(n);
  if (n < 0) return `minus ${intWords(-n)}`;
  if (n < 20) return ONES[n];
  if (n < 100) return TENS[Math.floor(n / 10)] + (n % 10 ? `-${ONES[n % 10]}` : '');
  if (n < 1000) return `${ONES[Math.floor(n / 100)]} hundred${n % 100 ? ` ${intWords(n % 100)}` : ''}`;
  for (const [s, w] of SCALES) if (n >= s) return `${intWords(Math.floor(n / s))} ${w}${n % s ? ` ${intWords(n % s)}` : ''}`;
  return String(n);
}

/** A number as written → words: "−133.3" → "minus one hundred thirty-three point three"; "1/9" → "one over nine". */
export function numberWords(text: string): string {
  const t = text.replace(/−/g, '-').replace(/,/g, '');
  const neg = t.startsWith('-');
  const body = neg ? t.slice(1) : t;
  let words: string;
  const fr = /^(\d+)\/(\d+)$/.exec(body);
  if (fr) words = `${intWords(Number(fr[1]))} over ${intWords(Number(fr[2]))}`;
  else if (body === '∞') words = 'infinity';
  else {
    const [i, d] = body.split('.');
    words = `${intWords(Number(i || '0'))}${d ? ` point ${[...d].map((c) => ONES[Number(c)]).join(' ')}` : ''}`;
  }
  return `${neg ? 'minus ' : ''}${words}`;
}

/** Glyphs said before the number: "×3" → "times three". Others (unknown) are shown, not said. */
const SAID_BEFORE: Record<string, string> = { '×': 'times', '±': 'plus or minus', '≈': 'about' };

/**
 * A quantity → its spoken form, from its parts (never by re-reading a caption): "$6" → "six dollars",
 * "12%" → "twelve percent", "100 units" → "one hundred units", "1 m/s" → "one metre per second",
 * "1.4 elastic" → "one point four elastic". A currency is said after the number, as it is read aloud.
 */
export function spokenOf(s: Said): string {
  const one = /^1(\.0+)?$/.test(s.num.replace(/,/g, ''));
  const out: string[] = [];
  let unitAfter: string | undefined;
  for (const g of s.pre) {
    const cur = unitBefore(g);
    if (cur) unitAfter = unitWords(cur, one);
    else if (SAID_BEFORE[g]) out.push(SAID_BEFORE[g]);
  }
  out.push(numberWords(s.num));
  if (s.post) {
    const ws = s.post.trim().split(/\s+/);
    const u = readUnit(ws);
    const said = u ? unitWords(u.unit, one) : undefined;
    out.push(said ? [said, ...ws.slice(u!.n)].join(' ') : s.post.trim());
  }
  if (unitAfter) out.push(unitAfter);
  return out.join(' ');
}

/** A value as said: its number as written and the affixes the board writes around it (quantity.ts). */
export type Said = Affix & { num: string };
/** The caption text of a said value. */
export const saidText = (s: Said): string => quantity(s.num, s);

/**
 * A value as the narration says it. `fmt` fixes the decimals (default: the board's format, so the
 * caption and the board agree to the digit); `as=percent` says v × 100 with % (whole percent at 10%
 * and above, one decimal below); `as=abs` drops the sign ("falls by 12"). `affix`: what the board
 * writes around it (a readout's template); as=percent brings its own "%" instead.
 */
export function sayNumber(v: number, f: ValFormat = {}, affix: Affix = NO_AFFIX): Said | null {
  if (!Number.isFinite(v)) return null;
  let x = f.as === 'abs' ? Math.abs(v) : v;
  if (f.as === 'percent') {
    x *= 100;
    return { num: boardFmt(x, f.fmt ?? (Math.abs(x) >= 10 || Number.isInteger(Math.round(x * 1e9) / 1e9) ? 0 : 1)), pre: '', post: '%' };
  }
  return { num: boardFmt(x, f.fmt), ...affix };
}
