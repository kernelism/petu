// src/values/format.ts — the one reader of a number format (a readout's data-fmt, {{val fmt=}}). The model
// writes it in whichever notation it knows: a decimal count ("2"), a picture ("0.00", "#,##0.0"), printf
// (".2f", "%.1f") or a percent picture ("0%", "0.0%"). Read as a count only, the rest fell through to
// three significant figures on the board ("0.667" under data-fmt="0.00") and to a dropped beat in the
// narration (".2f"): about one format in six in recorded runs. Pure.

/** A format read: the decimals it fixes, and whether it shows the value as a percent (× 100, "%"). */
export type NumFormat = { dp: number; percent: boolean };

const MAX_DP = 10;

/** `fmt` as decimals (and percent), or null when it is none of the notations above. */
export function readFormat(fmt: string | number | null | undefined): NumFormat | null {
  if (fmt == null) return null;
  const s = String(fmt).trim();
  const percent = /%$/.test(s) && !/^%/.test(s);
  const body = percent ? s.slice(0, -1) : s;
  let dp: number | null = null;
  let m: RegExpMatchArray | null;
  if (/^\d+$/.test(body)) dp = Number(body);
  else if ((m = body.match(/^[0#,]*\.([0#]+)$/))) dp = m[1].length;
  else if (/^[0#,]+$/.test(body)) dp = 0;
  else if ((m = body.match(/^%?\.(\d+)f$/))) dp = Number(m[1]);
  if (dp == null || dp > MAX_DP) return null;
  return { dp, percent };
}
