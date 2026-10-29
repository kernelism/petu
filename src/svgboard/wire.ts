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

/** Whether the text right after `{{` opens an svg group tag (`{{svg <…`). */
export const isSvgTagBody = (s: string): boolean => /^svg\s*</.test(s);

/** A tag's length limit given the text after its `{{` (svg group tags are long). */
export const tagLimit = (afterOpen: string, normal: number): number => (isSvgTagBody(afterOpen) ? SVG_TAG_MAX : normal);

/** Raw SVG → the body of its wire tag. */
export function escapeSvg(svg: string): string {
  return svg.replace(/\{/g, '&#123;').replace(/\}/g, '&#125;').replace(/[\r\n\t]+/g, ' ').replace(/ {2,}/g, ' ').trim();
}

/** The wire body back to raw SVG (for the repair note and logs; XML parsers decode the references themselves). */
export const unescapeSvg = (s: string): string => s.replace(/&#123;/g, '{').replace(/&#125;/g, '}');

/** A script's wire svg tags shown as the model wrote them (`{{svg <g…>}}` → `<g…>`). */
export const rawSvgScript = (script: string): string => script.replace(/\{\{svg\s*(<[\s\S]*?>)\}\}/g, (_m, g: string) => `\n${unescapeSvg(g)}\n`);
