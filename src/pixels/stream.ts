// src/pixels/stream.ts — puts a page image's pixels into the answer, ahead of the window that reads them.
/**
 * The model writes an engine window over a picture on the page by its mark:
 *
 *   {{svg <g id="eye" data-slide="#i1" data-kernel="k.box" data-step="k"/>}}       (data-px="24", data-page="16")
 *
 * Before the svg tag, this pass adds the picture's gray levels as a computed table,
 * `{{computed id=px_i1_24 f=…}}`, read from the PDF's own image (src/pixels/page.ts). From there it is
 * ordinary calc data: the board, the gate's shadow board and a replay of the recorded answer all read the
 * same integers, with no PDF needed after this point. A picture that cannot be read gets a failed tag.
 */
import { computedTag } from '../calc/stream';
import { MAX_RASTER_COLS, RASTER_COLS } from './gray';

/** Reads page `page`'s (the answer's page when absent) figure mark `mark` as `cols` columns of gray. */
export type PixelSource = (mark: string, cols: number, page?: number) => Promise<number[][]>;

/** One page-image read a window asks for. */
export type PixelAsk = { mark: string; cols: number; page?: number };

/** The computed table's id for a page-image read: `px_i1_24`, `px_p16_i1_24` with a page. */
export const pxId = (a: PixelAsk): string => `px_${a.page ? `p${a.page}_` : ''}${a.mark.replace(/^#/, '')}_${a.cols}`;

const attr = (tag: string, name: string): string | null => {
  const m = new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`).exec(tag);
  return m ? (m[1] ?? m[2]).trim() : null;
};

/** The page-image reads an element's attributes ask for (data-slide="#i1", data-px, data-page), or null. */
export function pixelAsk(attrs: { get(name: string): string | null }): PixelAsk | null {
  const src = attrs.get('data-slide')?.trim() ?? '';
  if (!/^#i\d+$/.test(src)) return null;
  const px = Number(attrs.get('data-px'));
  const pg = Number(attrs.get('data-page'));
  return {
    mark: src,
    cols: Number.isInteger(px) && px >= 3 ? Math.min(px, MAX_RASTER_COLS) : RASTER_COLS,
    ...(Number.isInteger(pg) && pg > 0 ? { page: pg } : {}),
  };
}

/** Every page-image read in an svg tag's markup. */
export function pixelAsks(svg: string): PixelAsk[] {
  const out: PixelAsk[] = [];
  for (const m of svg.matchAll(/<[A-Za-z][^<>]*\sdata-slide\s*=\s*["']\s*#i\d+\s*["'][^<>]*>/g)) {
    const a = pixelAsk({ get: (n) => attr(m[0], n) });
    if (a && !out.some((x) => pxId(x) === pxId(a))) out.push(a);
  }
  return out;
}

/**
 * The stream with each page-image read's table put just before the svg tag that asks for it (once per
 * answer). An svg tag is held until it closes; everything else passes through at once.
 */
export async function* withPixels(src: AsyncIterable<string>, read: PixelSource): AsyncIterable<string> {
  const done = new Set<string>();
  let buf = '';
  const tables = async (svg: string): Promise<string> => {
    let out = '';
    for (const a of pixelAsks(svg)) {
      const id = pxId(a);
      if (done.has(id)) continue;
      done.add(id);
      try { out += `${computedTag({ id, values: { f: await read(a.mark, a.cols, a.page) } })} `; }
      catch (e) {
        const why = String(e instanceof Error ? e.message : e).replace(/["\n]/g, ' ').slice(0, 160);
        console.warn('[pixels]', why);
        out += `{{computed id=${id} failed="${why}"}} `;
      }
    }
    return out;
  };
  const step = async function* (final: boolean): AsyncGenerator<string> {
    for (;;) {
      const at = buf.indexOf('{{svg');
      if (at < 0) {
        let keep = 0;
        if (!final) for (let n = Math.min(5, buf.length); n > 0; n--) if ('{{svg'.startsWith(buf.slice(-n))) { keep = n; break; }
        const out = buf.slice(0, buf.length - keep);
        buf = buf.slice(buf.length - keep);
        if (out) yield out;
        return;
      }
      if (at > 0) { yield buf.slice(0, at); buf = buf.slice(at); }
      const end = buf.indexOf('}}');
      if (end < 0) { if (final) { yield buf; buf = ''; } return; }
      const svg = buf.slice(0, end + 2);
      buf = buf.slice(end + 2);
      yield (/data-slide\s*=\s*["']\s*#i/.test(svg) ? await tables(svg) : '') + svg;
    }
  };
  for await (const chunk of src) { buf += chunk; yield* step(false); }
  yield* step(true);
}

/** One finished text with its page-image tables in (a repair's replacement beat). */
export async function runPixelsIn(text: string, read: PixelSource): Promise<string> {
  let out = '';
  for await (const s of withPixels((async function* () { yield text; })(), read)) out += s;
  return out;
}
