// src/script/tokenize.ts
/** Opening quote → its closing quote. */
export const QUOTES: Record<string, string> = { '"': '"', '“': '”' };

export type Tokens = {
  /** The tag name, lowercased. */
  name: string;
  /** key=value pairs, keys lowercased; a fully quoted value is unquoted (`x="depth z"` → `depth z`). */
  args: Record<string, string>;
  /** Bare quoted strings, in order. */
  quotes: string[];
  /** Bare words after the name, lowercased (`em`, `dash`). */
  flags: Set<string>;
  /** key=value pairs with keys as written (`{{let O=… o=…}}` names are case-sensitive). */
  rawArgs: Record<string, string>;
  /** Keys (as written) given more than once: ambiguous, so the caller never picks one. */
  dupKeys: Set<string>;
};

const POINT = /^-?\d*\.?\d+,-?\d*\.?\d+$/;
/** Bare words that are real flags of some tag: never taken as a value after a key missing its `=`. */
const FLAG_WORDS = new Set(['em', 'dash', 'outline', 'fit', 'same', 'flip', 'shade', 'area', 'slope', 'max', 'min', 'residual']);
/**
 * A slip: a point key written without its `=` (`{{line on=t from=Ps to Pb}}`). Recovered only when
 * the bare word is a point key of that tag, not given already, and the next token is a bare value
 * (no quote, no `=`, not a flag word). Anything else stays as written (a flag, or malformed).
 */
/** Keys whose value is a list of names (labels, headers, states): spaces inside are part of a name. */
const LIST_KEYS = new Set(['labels', 'parts', 'states', 'state', 'cols', 'rows']);
/** Bare words that end such a list: every flag some tag reads. */
const LIST_STOP = new Set([...FLAG_WORDS, 'stack', 'arrows', 'down', 'plain', 'show']);
const POINT_KEYS:Record<string, string[]> = {
  line: ['from', 'to', 'through'], arrow: ['from', 'to', 'through'], brace: ['from', 'to'], angle: ['at', 'from', 'to'],
  point: ['at'], label: ['at'], circle: ['at'], shade: ['at'], write: ['at', 'center'], math: ['at', 'center'], box: ['at', 'center'],
};

/**
 * Splits a tag body into name, args, quotes and flags. Quoted spans ("…" or “…”) may contain
 * spaces anywhere, including inside a value (`from=p3:"image 1"`). Bare points right after
 * `pts=` continue the list (`pts=1,2 3,4 5,6` → args.pts = "1,2 3,4 5,6"). A repeated key is listed in dupKeys.
 */
export function tokenize(body: string): Tokens | null {
  const raw: string[] = [];
  let i = 0;
  while (i < body.length) {
    while (i < body.length && /\s/.test(body[i])) i++;
    if (i >= body.length) break;
    let tok = '';
    while (i < body.length && !/\s/.test(body[i])) {
      const c = body[i];
      if (c in QUOTES) {
        const close = body.indexOf(QUOTES[c], i + 1);
        if (close < 0) return null; // unterminated quote
        tok += body.slice(i, close + 1);
        i = close + 1;
      } else { tok += c; i++; }
    }
    raw.push(tok);
  }
  const out: Tokens = { name: '', args: {}, quotes: [], flags: new Set(), rawArgs: {}, dupKeys: new Set() };
  let lastKey = '';
  for (let i = 0; i < raw.length; i++) {
    const t = raw[i];
    if (t[0] in QUOTES) { out.quotes.push(unquote(t)); lastKey = ''; continue; }
    const eq = t.indexOf('=');
    const q = t.search(/["“]/);
    if (eq > 0 && (q < 0 || eq < q)) {
      // A key given twice (`from=D to=C to=E`) is ambiguous: noted, never guessed (parseTag decides).
      if (Object.prototype.hasOwnProperty.call(out.rawArgs, t.slice(0, eq))) out.dupKeys.add(t.slice(0, eq));
      lastKey = t.slice(0, eq).toLowerCase();
      out.args[lastKey] = unquote(t.slice(eq + 1));
      out.rawArgs[t.slice(0, eq)] = out.args[lastKey];
      continue;
    }
    if (!out.name) { out.name = t.toLowerCase(); continue; }
    const k = t.toLowerCase(), next = raw[i + 1];
    if (POINT_KEYS[out.name]?.includes(k) && !(k in out.args) && next && !raw.slice(i + 2).some((r) => r.toLowerCase().startsWith(`${k}=`))
      && !/["“=]/.test(next) && !FLAG_WORDS.has(next.toLowerCase())) {
      out.args[k] = next;
      out.rawArgs[k] = next;
      lastKey = '';
      i++;
      continue;
    }
    if (lastKey === 'pts' && (POINT.test(t) || /^[A-Za-z#(]/.test(t) && !/^(em|dash|outline|fit)$/i.test(t))) { out.args.pts += ` ${t}`; continue; }
    // A list value written with spaces (`labels=market $600,ceiling $500`, `states=housed,shut out`):
    // bare words that are no flag continue it. Only names take this; numbers and points never do.
    if (LIST_KEYS.has(lastKey) && !LIST_STOP.has(k)) {
      out.args[lastKey] += ` ${t}`;
      const rk = Object.keys(out.rawArgs).find((x) => x.toLowerCase() === lastKey);
      if (rk) out.rawArgs[rk] = out.args[lastKey];
      continue;
    }
    out.flags.add(t.toLowerCase());
    lastKey = '';
  }
  return out.name ? out : null;
}

/** Strips one pair of matching quotes around the whole string; anything else is returned as is. */
export function unquote(s: string): string {
  const c = s[0];
  if (c in QUOTES && s.length >= 2 && s.endsWith(QUOTES[c])) return s.slice(1, -1).trim();
  return s;
}
