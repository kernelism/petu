// src/svgboard/wire.ts — the svg board's wire form, shared by the server filter (server/svgBeats.ts),
// the script parser, the gate's segmenter and lint.
/**
 * The model writes raw SVG groups between its narration (`<g id="arm">…</g>`). The server turns each
 * into ONE single-line tag, `{{svg <g id="arm">…</g>}}`, with `{` `}` escaped as XML character
 * references (`&#123;` `&#125;`, which an XML parser reads back as braces) and line breaks folded to
 * spaces, so the tag can never contain `}}`, `{{` or a newline. Its plan's BOARD line becomes
 * `{{svgboard h=H}}` (`w=` when the canvas is not 1000 wide; `extend`: draw on into the last board).
 * An svg tag is scanned without the quote rule and may run to SVG_TAG_MAX characters.
 */
export const SVG_TAG_MAX = 24000;

/**
 * The canvas width the prompt gives the model (p6.4): about the lane's width in screen pixels at 1440
 * (the 544 px lane), so the model's own text sizes are close to what the student reads. Before p6.4 the
 * canvas was 1000 wide and its 16–20 unit labels rendered at 8–10 px in the lane (docs/superpowers/
 * reference/lane-legibility.md). Any width still works: the board maps its canvas to the section.
 */
export const BOARD_W = 560;

/** The beat boundary (src/svgboard/beat.ts): zero words, no ink; a beat runs from one to the next. */
export const BEAT_TAG = '{{beat}}';
export const isBeatTagBody = (s: string): boolean => /^\s*beat\s*$/.test(s);
/** Whether a text uses beat boundaries (the beat wire, 2026-10-31); without them it is read the legacy way. */
export const hasBeatTags = (text: string): boolean => text.includes(BEAT_TAG);

/** A withheld beat's definitions-only group (src/svgboard/defs.ts). */
export const DEFS_ATTR = 'data-defs';
export const isDefsGroup = (svg: string): boolean => /^\s*(?:svg\s*)?<g\b[^>]*\sdata-defs\b/.test(svg);

/** Whether the text right after `{{` opens an svg group tag (`{{svg <…`). */
export const isSvgTagBody = (s: string): boolean => /^svg\s*</.test(s);

/**
 * A calc program on the wire (src/calc/stream.ts): the server filter turns `<calc id="rod">…</calc>`
 * into `{{calcsrc id=rod …}}`, its code's `&`, braces and line breaks as character references (the
 * code keeps its line breaks: JavaScript reads them), so no filter or parser on the way reads it as
 * narration or as tags. Its numbers come back as `{{computed id=rod …}}`, which may also be long.
 */
export const isCalcTagBody = (s: string): boolean => /^(?:calcsrc|computed)\s/.test(s);
export const escapeCalc = (code: string): string => code.replace(/&/g, '&#38;').replace(/\{/g, '&#123;').replace(/\}/g, '&#125;').replace(/\r?\n/g, '&#10;').replace(/\r/g, '');
export const unescapeCalc = (s: string): string => s.replace(/&#10;/g, '\n').replace(/&#123;/g, '{').replace(/&#125;/g, '}').replace(/&#38;/g, '&');

/** A tag's length limit given the text after its `{{` (svg group and calc tags are long). */
export const tagLimit = (afterOpen: string, normal: number): number => (isSvgTagBody(afterOpen) || isCalcTagBody(afterOpen) ? SVG_TAG_MAX : normal);

/** Raw SVG → the body of its wire tag. */
export function escapeSvg(svg: string): string {
  return svg.replace(/\{/g, '&#123;').replace(/\}/g, '&#125;').replace(/[\r\n\t]+/g, ' ').replace(/ {2,}/g, ' ').trim();
}

/**
 * A group the stream cut off (`<g id="a"><line …/><circle cx="4` …): only its whole children are
 * kept and the root is closed; null when not one child is whole (nothing worth showing) or the text
 * is not a group's start. A complete group comes back as it was. The renderer's sanitizer still
 * parses the result and drops it if it is not valid SVG.
 */
export function completeSvg(svg: string): string | null {
  const s = svg.trimEnd();
  const tag = /<!--[\s\S]*?-->|<(\/?)([A-Za-z][\w:.-]*)((?:[^>"']|"[^"]*"|'[^']*')*?)(\/?)>/g;
  let depth = 0, root = '', safe = -1, m: RegExpExecArray | null;
  while ((m = tag.exec(s))) {
    if (!root) {
      if (m.index !== s.search(/\S/) || m[1] || m[4] || !m[2]) return null;
      root = m[2];
    }
    if (!m[2]) continue; // a comment
    if (m[1]) depth--;
    else if (!m[4]) depth++;
    if (depth <= 0) return s.slice(0, tag.lastIndex); // the root closed: whole
    // Back at the root after a close or a self-closing tag: a child is whole.
    if (depth === 1 && (m[1] || m[4])) safe = tag.lastIndex;
  }
  return safe > 0 ? `${s.slice(0, safe)}</${root}>` : null;
}

/**
 * The stream ended inside a tag (`{{…` with no `}}`): an svg group tag keeps its whole children
 * (completeSvg); anything else is dropped. Never narration: half a tag is not words. `afterOpen` is
 * the text after `{{`; returns the tag body to parse, or null.
 */
export function cutTagBody(afterOpen: string): string | null {
  if (!isSvgTagBody(afterOpen)) return null;
  const g = completeSvg(afterOpen.replace(/^svg\s*/, '').replace(/\}$/, ''));
  return g ? `svg ${g}` : null;
}

/** The wire body back to raw SVG (for the repair note and logs; XML parsers decode the references themselves). */
export const unescapeSvg = (s: string): string => s.replace(/&#123;/g, '{').replace(/&#125;/g, '}');

/** A script's wire svg tags shown as the model wrote them (`{{svg <g…>}}` → `<g…>`; the filter's `{{beat}}` boundaries dropped). */
export const rawSvgScript = (script: string): string => script.replace(/\{\{beat\}\}\s*/g, '').replace(/\{\{svg\s*(<[\s\S]*?>)\}\}/g, (_m, g: string) => `\n${unescapeSvg(g)}\n`);
