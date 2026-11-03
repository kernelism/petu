// src/values/quantity.ts — a number with its affixes, as the board writes it: the one reader of a readout's
// text template. The board draws a readout with it (src/svgboard/data.ts), {{val}} says the same quantity
// (src/gate/engine.ts say → src/values/say.ts), and the number check reads a narration number's unit
// with the same rule (src/gate/check.ts). So the word heard and the text drawn are one quantity: a board
// showing "$10" and "100 units" is never said "10 and 100" (founder, OpenStax rent ceiling, 2026-11-02).
// Pure.
import { readUnit, unitBefore, unitOf } from './units';

/**
 * What belongs to the number in its text. `pre`: symbols glued before it ("$" of "${}", "×" of "×{}");
 * `post`: what is glued after it ("%", "°") or the unit word after it, with its space (" units", " m/s").
 * A sign written before the number is not an affix: "price −${}" is wording about direction (the
 * narration says "falls by"), the value's own sign is in its number.
 */
export type Affix = { pre: string; post: string };
/** A readout's template split around its quantity: drawn = head + pre + number + post + tail. */
export type Template = Affix & { head: string; tail: string; /** The quantity's unit (units.ts code), else undefined. */ unit?: string };

export const NO_AFFIX: Affix = { pre: '', post: '' };

/** Symbols that may stand glued before a number as part of it: not letters, digits, signs or punctuation. */
const PRE = /[^\s\p{L}\p{N}+\-−=:;,.!?()[\]{}'"“”‘’/<>|&*^_~@#\\]+$/u;
const TRAIL_PUNCT = /[)\]"'”’,;:.!?…]+$/;

/**
 * A readout's template ("price ${}", "{} units", "+{}%", "lands {} m downstream", "{} elastic"), or none (a
 * bare data-val: its data-unit), split around its quantity. After the number, the quantity takes what is
 * glued to it, else the next word when it is a unit (units.ts) or the template's last word: the board
 * writes "1.4 elastic", so it is said "1.4 elastic"; "{} both ways" keeps "both ways" as wording.
 */
export function readTemplate(tpl: string | null | undefined, dataUnit?: string | null): Template {
  const du = dataUnit?.trim() || undefined;
  if (!tpl || !tpl.includes('{}')) {
    if (!du) return { head: '', tail: '', ...NO_AFFIX };
    if (unitBefore(du)) return { head: '', tail: '', pre: du, post: '', unit: du };
    return { head: '', tail: '', pre: '', post: /^[%°′″]/.test(du) ? du : ` ${du}`, unit: unitOf(du.split(/\s+/)) };
  }
  const i = tpl.indexOf('{}');
  const before = tpl.slice(0, i), after = tpl.slice(i + 2);
  const pre = PRE.exec(before)?.[0] ?? '';
  let post = '';
  const glued = /^\S+/.exec(after)?.[0];
  if (glued) post = glued.replace(TRAIL_PUNCT, '');
  else {
    const m = /^(\s+)(\S+(?:\s+\S+){0,2})/.exec(after);
    if (m) {
      const ws = m[2].split(/\s+/);
      const u = readUnit(ws);
      const rest = after.slice(m[1].length).split(/\s+/).filter(Boolean);
      const last = rest.length === 1 || rest.slice(1).every((w) => !w.replace(TRAIL_PUNCT, ''));
      const n = u?.n ?? (last ? 1 : 0);
      if (n) post = m[1].replace(/\s+/g, ' ') + ws.slice(0, n).join(' ').replace(TRAIL_PUNCT, '');
    }
  }
  const unit = du ? unitOf(du.split(/\s+/)) : unitOfAffix({ pre, post });
  return { head: before.slice(0, before.length - pre.length), tail: after.slice(post.length), pre, post, ...(unit ? { unit } : {}) };
}

/** The unit an affix states: a currency before, or a unit after (units.ts code). */
export const unitOfAffix = (a: Affix): string | undefined =>
  (a.post ? unitOf(a.post.trim().split(/\s+/)) : undefined) ?? (a.pre ? unitBefore(a.pre.slice(-1)) : undefined);

/** The quantity as written: "$10", "100 units", "12%". */
export const quantity = (num: string, a: Affix): string => a.pre + num + a.post;

/** The readout's whole text as the board draws it. */
export const drawText = (num: string, t: Template): string => t.head + quantity(num, t) + t.tail;

/**
 * The quantity said in its sentence, never doubling what the narration writes itself: a symbol the
 * narration glues on the left ("${{val id=p}}" → "$" is the narration's), and a unit it says right after
 * ("{{val id=t}} seconds", "{{val id=r}}%", "{{val id=p}} dollars": the narration's unit is said, not
 * the readout's too). `left`: the narration text glued on the left; `after`: its next words.
 */
export function inSentence(a: Affix, left: string, after: readonly string[]): Affix {
  let { pre, post } = a;
  if (pre && left.endsWith(pre)) pre = '';
  const said = readUnit(after);
  const word = (after[0] ?? '').toLowerCase().replace(TRAIL_PUNCT, '');
  if (post && (said || word && word === post.trim().toLowerCase())) post = '';
  // A currency is a unit too: "{{val id=p}} dollars" says it once.
  if (pre && said && unitBefore(pre.slice(-1))) pre = pre.slice(0, -1);
  return { pre, post };
}
