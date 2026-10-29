// src/values/say.ts — how a bound number ({{val}}) is said: the caption text, in the board's own
// number format (src/desk/kit/compute.ts fmt), and a spoken form for the TTS clock. Pure.
import { fmt as boardFmt } from '../desk/kit/compute';
import type { ValFormat } from '../script/types';

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

/** Caption text → words: "−133.3%" → "minus one hundred thirty-three point three percent"; "1/9" → "one ninth". */
export function spokenOf(text: string): string {
  const t = text.replace(/−/g, '-').replace(/,/g, '');
  const pct = t.endsWith('%');
  const s = pct ? t.slice(0, -1) : t;
  const neg = s.startsWith('-');
  const body = neg ? s.slice(1) : s;
  let words: string;
  const fr = /^(\d+)\/(\d+)$/.exec(body);
  if (fr) words = `${intWords(Number(fr[1]))} over ${intWords(Number(fr[2]))}`;
  else if (body === '∞') words = 'infinity';
  else {
    const [i, d] = body.split('.');
    words = `${intWords(Number(i || '0'))}${d ? ` point ${[...d].map((c) => ONES[Number(c)]).join(' ')}` : ''}`;
  }
  return `${neg ? 'minus ' : ''}${words}${pct ? ' percent' : ''}`;
}

/**
 * A value as the narration says it. `fmt` fixes the decimals (default: the board's format, so the
 * caption and the board agree to the digit); `as=percent` says v × 100 with % (whole percent at 10%
 * and above, one decimal below); `as=abs` drops the sign ("falls by 12").
 */
export function sayNumber(v: number, f: ValFormat = {}): { said: string; spoken: string } | null {
  if (!Number.isFinite(v)) return null;
  let x = f.as === 'abs' ? Math.abs(v) : v;
  let said: string;
  if (f.as === 'percent') {
    x *= 100;
    said = `${boardFmt(x, f.fmt ?? (Math.abs(x) >= 10 || Number.isInteger(Math.round(x * 1e9) / 1e9) ? 0 : 1))}%`;
  } else said = boardFmt(x, f.fmt);
  return { said, spoken: spokenOf(said) };
}
