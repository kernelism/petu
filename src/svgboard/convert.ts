// src/svgboard/convert.ts — an svgboard experiment answer (one whole SVG, then narration revealing
// groups with {{show a,b}}) → the streamed beat format the model writes now (plan with BOARD layout,
// then narration followed by each beat's groups). Pure strings (node scripts and the gallery use it).
/**
 * The experiment's runs (2026-10-29, `.petu/eval/runs/*svgboard*`) are replayed through the new
 * renderer at $0 by converting their recordings: each `{{show ids}}` sentence becomes a beat whose
 * groups follow its words; a group shown twice is drawn once; elements outside any group (a backing
 * rect, stray marks) ride with the first beat; groups never shown ride with the last.
 */

/** Top-level children of the root <svg> as raw markup, with their ids. */
export function topLevel(svg: string): { id?: string; xml: string }[] {
  // A bare <svg> right before the real one (seen once in the experiment) wraps nothing.
  svg = svg.replace(/^\s*<svg>\s*(?=<svg[\s>])/, '');
  const open = svg.search(/<svg\b/i);
  if (open < 0) return [];
  const start = svg.indexOf('>', open) + 1;
  const out: { id?: string; xml: string }[] = [];
  const re = /<(\/?)([a-zA-Z][\w:-]*)\b[^>]*?(\/?)>/g;
  re.lastIndex = start;
  let depth = 0, from = -1, m: RegExpExecArray | null;
  while ((m = re.exec(svg))) {
    const [tag, close, name, self] = m;
    if (name.toLowerCase() === 'svg' && close && depth === 0) break;
    if (close) { depth--; if (depth === 0 && from >= 0) { const xml = svg.slice(from, re.lastIndex); out.push({ id: /^<g\b[^>]*?\bid="([^"]+)"/.exec(xml)?.[1], xml }); from = -1; } continue; }
    if (depth === 0) from = m.index;
    if (self) { if (depth === 0) { out.push({ xml: tag }); from = -1; } continue; }
    depth++;
  }
  return out;
}

const clean = (s: string) => s.replace(/<\/?(say|canvas|svg)\b[^>]*>/gi, ' ').replace(/\{\{svgboard\}\}/g, ' ').replace(/[ \t]+/g, ' ').replace(/\s*\n\s*/g, ' ').trim();

/** The experiment's SVG + its narration (with {{show}} tags) → a raw beat-format script. */
export function toBeats(svg: string, narration: string): string {
  const vb = /viewBox="\s*[-\d.]+[\s,]+[-\d.]+[\s,]+([\d.]+)[\s,]+([\d.]+)\s*"/.exec(svg);
  const w = vb ? Number(vb[1]) : 1000, h = vb ? Number(vb[2]) : 700;
  const kids = topLevel(svg);
  const byId = new Map(kids.filter((k) => k.id).map((k) => [k.id!, k.xml]));
  const loose = kids.filter((k) => !k.id).map((k) => k.xml);
  const parts = narration.split(/(\{\{show\s+[^}]*\}\})/);
  const beats: { text: string; ids: string[] }[] = [];
  let ids: string[] = [], text = '';
  for (const p of parts) {
    const m = /^\{\{show\s+([^}]*)\}\}$/.exec(p);
    if (m) { if (text.trim() || ids.length) beats.push({ text, ids }); ids = m[1].split(/[\s,]+/).filter(Boolean); text = ''; continue; }
    text += p;
  }
  if (text.trim() || ids.length) beats.push({ text, ids });
  const used = new Set<string>();
  const lines: string[] = [];
  const order = beats.flatMap((b) => b.ids).filter((x, i, a) => byId.has(x) && a.indexOf(x) === i);
  lines.push(`<plan>\nConverted from a whole-board answer.\nBOARD viewBox="0 0 ${w} ${h}"\ngroups: ${order.join('; ')}\n</plan>`);
  beats.forEach((b, k) => {
    const t = clean(b.text);
    const gs: string[] = [];
    if (k === 0 || (k === 1 && !clean(beats[0].text))) gs.push(...loose.splice(0));
    for (const id of b.ids) if (byId.has(id) && !used.has(id)) { used.add(id); gs.push(byId.get(id)!); }
    if (k === beats.length - 1) for (const [id, xml] of byId) if (!used.has(id)) { used.add(id); gs.push(xml); }
    lines.push([t, ...gs].filter(Boolean).join('\n'));
  });
  return lines.join('\n');
}
