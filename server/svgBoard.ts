// server/svgBoard.ts — EXPERIMENT (PETU_PROMPT_VARIANT=svgboard).
/**
 * The model writes one <svg>…</svg> first, then narration with {{show a,b}} tags. This filter sits in
 * front of the ScriptFilter: it lifts the SVG out of the stream (handing it to `onSvg`, which sends it
 * to the client as its own event), and puts `{{svgboard}}` where it was, so the client opens the board
 * section before the first narration word. Text before the SVG (a ``` fence) is dropped; a stream with
 * no SVG in its first 600 characters passes through unchanged.
 */
import { ScriptFilter } from './scriptFilter';

export class SvgScriptFilter extends ScriptFilter {
  private sbuf = '';
  private st: 'pre' | 'svg' | 'post' | 'pass' = 'pre';
  svg = '';
  firstMs = NaN;
  svgMs = NaN;
  private onSvg: (svg: string) => void;
  private now: () => number;
  constructor(onSvg: (svg: string) => void, now: () => number) { super(); this.onSvg = onSvg; this.now = now; }

  override push(chunk: string): string { return super.push(this.lift(chunk, false)); }
  override end(): string { const s = this.lift('', true); return super.push(s) + super.end(); }

  private lift(chunk: string, final: boolean): string {
    if (chunk && Number.isNaN(this.firstMs)) this.firstMs = this.now();
    if (this.st === 'pass') return chunk;
    this.sbuf += chunk;
    if (this.st === 'pre') {
      const i = this.sbuf.indexOf('<svg');
      if (i < 0) {
        if (this.sbuf.length > 600 || final) { this.st = 'pass'; const s = this.sbuf; this.sbuf = ''; return s; }
        return '';
      }
      this.sbuf = this.sbuf.slice(i);
      this.st = 'svg';
    }
    if (this.st === 'svg') {
      // A bare <svg> right before the real one (seen once) is dropped; nested <svg>s close in pairs.
      this.sbuf = this.sbuf.replace(/^<svg>\s*(?=<svg[\s>])/, '');
      if (/^<svg>?\s*$/.test(this.sbuf) && !final) return '';
      let j = -1;
      for (let depth = 0, k = 0; ;) {
        const o = this.sbuf.slice(k).search(/<svg[\s>]/), c = this.sbuf.indexOf('</svg>', k);
        if (c < 0) break;
        if (o >= 0 && k + o < c) { depth++; k = k + o + 4; continue; }
        depth--; k = c + 6;
        if (depth <= 0) { j = c; break; }
      }
      if (j < 0) {
        if (!final) return '';
        this.svg = this.sbuf; this.sbuf = ''; this.st = 'pass'; // unclosed: the client still tries
        this.svgMs = this.now(); this.onSvg(this.svg);
        return '{{svgboard}} ';
      }
      this.svg = this.sbuf.slice(0, j + 6);
      this.sbuf = this.sbuf.slice(j + 6);
      this.svgMs = this.now();
      this.onSvg(this.svg);
      this.st = 'post';
      return '{{svgboard}} ' + this.lift('', final);
    }
    // post: drop a closing fence, a stray </svg> and leading blank space, then pass through.
    if (!final && this.sbuf.trimStart().length < 7) return '';
    const m = /^(\s|```|<\/svg>)*/.exec(this.sbuf)!;
    const s = this.sbuf.slice(m[0].length);
    this.sbuf = '';
    this.st = 'pass';
    return s;
  }
}
