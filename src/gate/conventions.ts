// src/gate/conventions.ts — check (f), conventions (teaching-engine proposal §3.6): what the board computes
// must follow the conventions of the slides it teaches from. Two deterministic rules over what the gate
// already has (the answer's page texts, the beat's words, the engine views it draws). Notes until measured
// (verdict.ts SEVERITY), as (c) was: an unmeasured check must not withhold beats.
//
//  - The operation: words that call a window's operation convolution while the window does not turn its
//    kernel (data-flip), or correlation while it does. The deck defines them (lec06 p5: convolution is
//    filtering with a flipped g); the board must do what the voice names.
//  - The numbers: a kernel or table the slide prints ("5 x 5, σ = 1" under 25 numbers on lec06 p22) and an
//    engine view of the same shape (a window's kernel, a grid's cells) must agree at the slide's rounding:
//    the "Gaussian kernel" on the board is the slide's, not another one.

/** A grid of numbers a page prints, with the decimals it is printed to. */
export type PageTable = { page: number; rows: number; cols: number; vals: number[]; dp: number };

const NUM = /^[-−]?\d*\.?\d+$/;

/**
 * The tables a page's text prints: a size "R x C" (2 to 9 each) and a run of R·C numbers (see below for
 * what may sit around it). Only runs that are not all whole numbers under 10,
 * or that have at least 9 values, count: "1 2 3" on a slide is more often a list than a kernel.
 */
export function pageTables(page: number, text: string): PageTable[] {
  const toks = text.replace(/[×✕]/g, ' x ').split(/[\s,;]+/).filter(Boolean);
  const sizes = new Set<string>();
  for (let i = 0; i + 2 < toks.length; i++) if (/^[2-9]$/.test(toks[i]) && /^x$/i.test(toks[i + 1]) && /^[2-9]$/.test(toks[i + 2])) sizes.add(`${toks[i]}x${toks[i + 2]}`);
  for (const t of toks) { const m = /^([2-9])x([2-9])$/i.exec(t); if (m) sizes.add(`${m[1]}x${m[2]}`); }
  if (!sizes.size) return [];
  const runs: string[][] = [];
  let cur: string[] = [];
  for (const t of toks) { if (NUM.test(t)) cur.push(t); else { if (cur.length) runs.push(cur); cur = []; } }
  if (cur.length) runs.push(cur);
  const out: PageTable[] = [];
  for (const s of sizes) {
    const [rows, cols] = s.split('x').map(Number), n = rows * cols;
    for (const run of runs) {
      // A size digit right after the table ("… 0.003 5 x 5") is the size; a page or slide number may come
      // before it (at most two): the table is the last R·C numbers of what is left.
      const body = run.length > n && run[run.length - 1] === String(rows) ? run.slice(0, -1) : run;
      const vs = body.length >= n && body.length <= n + 2 ? body.slice(body.length - n) : null;
      if (!vs) continue;
      const vals = vs.map((v) => Number(v.replace('−', '-')));
      if (n < 9 && vals.every((v) => Number.isInteger(v) && Math.abs(v) < 10)) continue;
      const dp = Math.max(...vs.map((v) => (v.includes('.') ? v.split('.')[1].length : 0)));
      out.push({ page, rows, cols, vals, dp });
    }
  }
  return out;
}

/** An engine view the beat draws: a window (its kernel, whether it turns it) or a grid (its cells). */
export type ViewData = { id: string; kind: 'window' | 'grid'; m: number[][]; flip?: boolean };

/** The notes check (f) gives a beat: its words and the engine views it draws, against the answer's pages. */
export function conventionNotes(words: string, views: ViewData[], pages: Map<number, string>): string[] {
  const notes: string[] = [];
  const w = words.toLowerCase();
  const conv = /\bconvol/.test(w), corr = /\bcorrelat/.test(w);
  const wins = views.filter((v) => v.kind === 'window');
  if (wins.length && conv !== corr) {
    const bad = wins.filter((v) => (conv ? !v.flip : v.flip));
    // Every window disagreeing with the one word used: a comparison that draws both is not flagged.
    if (bad.length === wins.length) notes.push(conv
      ? `the words say convolution but window ${bad[0].id} does not turn its kernel (add data-flip="")`
      : `the words say correlation but window ${bad[0].id} turns its kernel (drop data-flip)`);
  }
  const tables = [...pages].flatMap(([p, t]) => pageTables(p, t));
  for (const v of views) {
    const R = v.m.length, C = v.m[0]?.length ?? 0;
    for (const t of tables) {
      if (t.rows !== R || t.cols !== C) continue;
      const got = v.m.flat();
      const off = got.findIndex((x, i) => Number(x.toFixed(t.dp)) !== Number(t.vals[i].toFixed(t.dp)));
      if (off >= 0) notes.push(`${v.kind} ${v.id} is ${R}x${C} like the table on p${t.page}, but its value ${off + 1} is ${+got[off].toFixed(t.dp + 2)} where the slide prints ${t.vals[off]}: use the slide's numbers, or say why they differ`);
    }
  }
  return notes;
}

const attr = (tag: string, name: string): string | null => {
  const m = new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`).exec(tag);
  return m ? (m[1] ?? m[2]).trim() : null;
};

/**
 * The engine views in a beat's svg groups, with their numbers as the shadow board computed them (`scope`:
 * the checked groups' data scope: a grid registered its cells there; a kernel resolves from it).
 */
export function viewsIn(srcs: string[], read: (src: string) => number[][] | null, cells: (id: string) => number[][] | null): ViewData[] {
  const out: ViewData[] = [];
  for (const src of srcs) for (const m of src.matchAll(/<[A-Za-z][^<>]*\sdata-(?:slide|grid)\s*=[^<>]*>/g)) {
    const t = m[0];
    const id = (attr(t, 'data-name') ?? attr(t, 'id') ?? '').toLowerCase();
    if (attr(t, 'data-grid') != null) {
      const c = id ? cells(id) : null;
      if (c?.length) out.push({ id, kind: 'grid', m: c });
    } else {
      const k = attr(t, 'data-kernel');
      const km = k ? read(k) : null;
      if (km?.length) out.push({ id: id || 'window', kind: 'window', m: km, flip: attr(t, 'data-flip') != null });
    }
  }
  return out;
}
