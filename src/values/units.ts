// src/values/units.ts — the one unit vocabulary: what counts as a unit beside a number, its canonical
// code, and how it is said. Read the same way off a readout's text template (src/values/quantity.ts),
// off the narration (the number check, src/gate/check.ts) and when a value is said (src/values/say.ts),
// so a number said in seconds is never a readout in metres, and "100 units" is said as the board writes it.
// Pure.

/** Canonical code → its written forms (lower-case) and how it is said (one, many). */
const VOCAB: [code: string, forms: string, one: string, many: string][] = [
  ['s', 's sec secs second seconds', 'second', 'seconds'],
  ['min', 'min mins minute minutes', 'minute', 'minutes'],
  ['h', 'h hr hrs hour hours', 'hour', 'hours'],
  ['m', 'm metre metres meter meters', 'metre', 'metres'],
  ['km', 'km kilometre kilometres kilometer kilometers', 'kilometre', 'kilometres'],
  ['cm', 'cm centimetre centimetres centimeter centimeters', 'centimetre', 'centimetres'],
  ['mm', 'mm millimetre millimetres millimeter millimeters', 'millimetre', 'millimetres'],
  ['kg', 'kg kilogram kilograms kilo kilos', 'kilogram', 'kilograms'],
  // Physics boards (OpenStax University Physics: "52.5 N" was said only by the old last-word rule).
  ['N', 'n newton newtons', 'newton', 'newtons'],
  ['J', 'j joule joules', 'joule', 'joules'],
  ['W', 'w watt watts', 'watt', 'watts'],
  ['Hz', 'hz hertz', 'hertz', 'hertz'],
  ['%', '% percent', 'percent', 'percent'],
  ['°', '° deg degree degrees', 'degree', 'degrees'],
  ['$', '$ dollar dollars', 'dollar', 'dollars'],
  ['£', '£', 'pound', 'pounds'],
  ['€', '€ euro euros', 'euro', 'euros'],
  ['m/s', 'm/s', 'metre per second', 'metres per second'],
  ['km/h', 'km/h kph', 'kilometre per hour', 'kilometres per hour'],
  // A count of goods (an economics board's quantity axis: "100 units").
  ['units', 'unit units', 'unit', 'units'],
];
const FORM: Record<string, string> = Object.fromEntries(VOCAB.flatMap(([u, ws]) => ws.split(' ').map((w) => [w, u])));
const SAID: Record<string, [string, string]> = Object.fromEntries(VOCAB.map(([u, , one, many]) => [u, [one, many]]));

const clean = (w: string) => w.toLowerCase().replace(/^[("“]+|[)"”,;:.!?]+$/g, '');

/**
 * A unit, from the words right after a number ("175 metres downstream" → m, "2.1 metres a second" → m/s,
 * "12%" → %), with how many words it took: undefined when the next word is not one.
 */
export function readUnit(after: readonly string[]): { unit: string; n: number } | undefined {
  const t = after.slice(0, 3).map(clean);
  if (/^%/.test(t[0] ?? '')) return { unit: '%', n: 1 };
  if (t[0] === 'per' && t[1] === 'cent') return { unit: '%', n: 2 };
  const u = FORM[t[0] ?? ''];
  if (!u) return undefined;
  // "metres a second", "km per hour": a speed.
  const per = (t[1] === 'a' || t[1] === 'per' || t[1] === 'an') ? FORM[t[2] ?? ''] : undefined;
  return (u === 'm' || u === 'km') && (per === 's' || per === 'h') ? { unit: `${u}/${per}`, n: 3 } : { unit: u, n: 1 };
}
/** The unit the words right after a number name (readUnit's code). */
export const unitOf = (after: readonly string[]): string | undefined => readUnit(after)?.unit;

/** A written unit form (any of a unit's forms). */
export const isUnitWord = (w: string): boolean => clean(w) in FORM;

/** Units written before the number ("$10", "€5"): currency. Said after it ("ten dollars"). */
const BEFORE = new Set(['$', '£', '€']);
export const unitBefore = (glyph: string): string | undefined => (BEFORE.has(glyph) ? glyph : undefined);

/** How unit `code` is said after a number: "dollars", "one metre per second". Undefined: not a known unit. */
export const unitWords = (code: string, one: boolean): string | undefined => SAID[code]?.[one ? 0 : 1];
