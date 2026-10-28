// scripts/eval/report.ts — report.html: the review artefact (instead of recordings).
// Per question: the frame timeline the r3 judge saw (or r2's contact sheet), the transcript, metrics,
// per-criterion scores, defects and judge notes. Then a calibration section (hand vs judge).
// Local file, relative image paths, plain HTML/CSS: no scripts, no foreignObject.
import { criteriaOf, meanScore } from './judge.ts';
import { esc } from './esc.ts';
import { TRUST, type Calibration } from './calibrate.ts';
import type { Summary, QuestionSummary } from './summary.ts';
import type { Question } from './questions.ts';

export { esc };

export type ReportItem = {
  q: Question;
  summary: QuestionSummary;
  /** The question actually asked on this turn. */
  asked: string;
  transcript: string;
  /** Paths relative to report.html. */
  stills: string[];
  webkit?: string[];
  sheet?: string;
  page?: string;
  /** r3: the frames the judge saw (full-size stills), the final state and the whole board. */
  timeline?: { frames: { src: string; caption: string; sentence: number }[]; final?: string; board?: string };
};

const ms = (x: number | null) => (x == null ? '-' : `${Math.round(x)} ms`);
const pct = (x: number) => `${Math.round(x * 100)}%`;

const CSS = `
:root{--bg:#f6f6f8;--card:#fff;--ink:#1d1d1f;--mute:#6b6b73;--line:#dcdce2;--warn:#b3261e;--ok:#1a7f4b;--bar:#2f5d9b}
@media (prefers-color-scheme:dark){:root{--bg:#141416;--card:#1d1d20;--ink:#ececf0;--mute:#9a9aa4;--line:#34343a;--warn:#ff8a80;--ok:#6fd39a;--bar:#8fb3e8}}
*{box-sizing:border-box}body{margin:0;padding:24px;background:var(--bg);color:var(--ink);font:14px/1.5 -apple-system,system-ui,sans-serif}
h1{font-size:20px;margin:0 0 4px}h2{font-size:15px;margin:0}h3{font-size:13px;margin:12px 0 6px;color:var(--mute);font-weight:600}p{margin:0}.mute{color:var(--mute)}
.top{display:flex;flex-wrap:wrap;gap:8px 24px;margin:12px 0 24px}.top div{min-width:120px}.top b{display:block;font-size:18px}
.banner{border:1px solid var(--warn);color:var(--warn);border-radius:8px;padding:8px 12px;margin:12px 0}
article,section{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:16px;margin:0 0 20px}
header{display:flex;flex-wrap:wrap;gap:6px 12px;align-items:baseline;margin-bottom:8px}
.tag{font-size:12px;color:var(--mute);border:1px solid var(--line);border-radius:999px;padding:0 8px}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:8px;margin:10px 0}
.grid a{display:block}.grid img{width:100%;height:auto;display:block;border:1px solid var(--line);border-radius:6px}
.tl{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:12px;margin:10px 0}
.tl figure{margin:0}.tl img{width:100%;height:auto;display:block;border:1px solid var(--line);border-radius:6px}
.tl figcaption{font-size:12px;color:var(--mute);margin-top:4px}.tl figcaption b{color:var(--ink);font-weight:600}
.cols{display:grid;grid-template-columns:minmax(0,3fr) minmax(0,2fr);gap:16px}@media (max-width:800px){.cols{grid-template-columns:1fr}}
.tr{white-space:pre-wrap;font-size:13px}.tr .bad{color:var(--warn)}
table{border-collapse:collapse;font-size:12px;width:100%}td,th{padding:2px 8px 2px 0;text-align:left;border-bottom:1px solid var(--line)}
.score td.v{width:2.5em;font-variant-numeric:tabular-nums}.meter{display:inline-block;height:6px;border-radius:3px;background:var(--bar);vertical-align:middle}
.fatal{color:var(--warn);font-weight:600}.ok{color:var(--ok)}.defect{color:var(--warn)}
a{color:inherit}a:focus-visible{outline:2px solid currentColor;outline-offset:2px}
`;

/** Marks tag brackets in the transcript: failed ones in the warning colour. */
function transcriptHtml(t: string): string {
  return esc(t).replace(/\[[^\]]*\]/g, (m) => (m.includes('✗') ? `<span class="bad">${m}</span>` : `<span class="mute">${m}</span>`));
}

/** One timeline figure: a frame, its time and what was said since the previous one. */
function figure(src: string, title: string, said?: string): string {
  return `<figure><a href="${esc(src)}"><img loading="lazy" src="${esc(src)}" alt="${esc(title)}"></a><figcaption><b>${esc(title)}</b>${said ? ` ${esc(said)}` : ''}</figcaption></figure>`;
}

/** "After sentence 3 of 9 (4.2s). Said since …: "…"" → ["s3/9 · 4.2s", "…"]. */
export function splitCaption(c: string): [string, string] {
  const m = /^After sentence (\d+) of (\d+) \(([\d.]+)s\)\. Said since the previous frame: "([\s\S]*)"$/.exec(c);
  return m ? [`s${m[1]}/${m[2]} · ${m[3]}s`, m[4]] : [c, ''];
}

function timelineHtml(it: ReportItem): string {
  const tl = it.timeline!;
  const frames = tl.frames.map((f, i) => { const [t, said] = splitCaption(f.caption); return figure(f.src, `${i + 1} · ${t}`, said); });
  if (tl.final) frames.push(figure(tl.final, 'final state'));
  if (tl.board) frames.push(figure(tl.board, 'whole board'));
  return `<h3>Timeline the judge saw</h3><div class="tl" aria-label="frame timeline">${it.page ? figure(it.page, 'page asked on') : ''}${frames.join('')}</div>`;
}

function scoresHtml(s: QuestionSummary): string {
  const j = s.judge;
  if (!j) return '<p class="mute">not judged</p>';
  const rows = criteriaOf(j).map((c) => `<tr><th>${esc(c)}</th><td class="v">${j.scores[c]}</td><td><span class="meter" style="width:${j.scores[c] * 16}px"></span></td></tr>`).join('');
  return `<table class="score">${rows}<tr><th>mean</th><td class="v">${meanScore(j).toFixed(2)}</td><td></td></tr></table>
${j.defects ? (j.defects.length ? `<p class="defect">defects: ${esc(j.defects.join(', '))}</p>` : '<p class="ok">no defects</p>') : ''}
${j.fatal.length ? `<p class="fatal">fatal: ${esc(j.fatal.join(', '))}</p>` : '<p class="ok">no fatal flags</p>'}
<p>${esc(j.notes)}</p>`;
}

function item(it: ReportItem): string {
  const { q, summary: s } = it;
  const m = s.metrics;
  const imgs = (list: string[], label: string) => list.length
    ? `<div class="grid" aria-label="${esc(label)}">${list.map((p, i) => `<a href="${esc(p)}"><img loading="lazy" src="${esc(p)}" alt="${esc(`${q.id} ${label} ${i + 1}`)}"></a>`).join('')}</div>` : '';
  const row = (k: string, v: string | number) => `<tr><th>${esc(k)}</th><td>${esc(String(v))}</td></tr>`;
  const sk = Object.entries(m.skipped).map(([k, v]) => `${k} x${v}`).join(', ') || 'none';
  const visual = it.timeline ? timelineHtml(it)
    : it.sheet ? `<div class="grid"><a href="${esc(it.sheet)}"><img loading="lazy" src="${esc(it.sheet)}" alt="${esc(q.id)} contact sheet"></a></div>` : imgs(it.stills, 'sentence-end still');
  return `<article id="${esc(q.id)}${s.turn ? `-t${s.turn}` : ''}">
<header><h2>${esc(q.id)}${s.turn ? ` (turn ${s.turn + 1})` : ''}</h2><span class="tag">${esc(q.split)}</span><span class="tag">${esc(q.type)}</span><span class="tag">${esc(q.deck)} p${q.page}</span></header>
<p><b>${esc(it.asked)}</b></p>
${visual}
${it.webkit ? imgs(it.webkit, 'WebKit still') : ''}
<div class="cols"><div><h3>Transcript</h3><div class="tr">${transcriptHtml(it.transcript)}</div></div>
<div><h3>Judge</h3>${scoresHtml(s)}
<h3>Metrics</h3><table>${row('first word', ms(m.firstWordMs))}${row('first mark', ms(m.firstMarkMs))}${row('total', ms(m.totalMs))}
${row('cost', `$${m.usd.toFixed(4)}${m.estimated ? ' (est.)' : ''}`)}${row('cached', `${Math.round(m.cachedShare * 100)}%`)}
${row('elements', m.elements)}${row('skipped', sk)}${row('malformed', m.malformed)}${row('linted', m.linted)}
${row('floating points', m.floatingPoints)}${row('label hits / clipped', `${m.labelHits} / ${m.labelsClipped}`)}${row('out of frame', m.outOfFrame)}
${row('words', m.words)}${row('leaks', m.leaks)}</table></div></div></article>`;
}

/** Hand-vs-judge: the comparison when hand scores exist, else how to make one. */
export function calibrationHtml(cal: { comparison?: Calibration; pending?: number } | null, runId: string): string {
  const how = `<ol>
<li><code>node --experimental-strip-types scripts/eval/calibrate.ts dump ${esc(runId)} --n 8</code> picks 8 judged answers spread over decks and narrow/broad and writes <code>calibration/hand.html</code> (blind: no judge output) and a <code>calibration/hand.json</code> template.</li>
<li>Score each answer in <code>hand.json</code> from <code>hand.html</code> alone, with the rubric text it shows: integers 1-5 per criterion, the defects and fatal flags that apply. Score before reading this report's judge columns.</li>
<li><code>node --experimental-strip-types scripts/eval/calibrate.ts compare ${esc(runId)}</code> prints per-criterion bias and agreement; <code>npm run eval -- --finish ${esc(runId)}</code> re-renders this page with the table (no new spend: unchanged answers keep their judgements).</li>
<li>Trust the judge when ±1 agreement ≥ ${pct(TRUST.within1)} and |bias| ≤ ${TRUST.maxBias} on every criterion. Otherwise tighten the anchors of the criteria that disagree (a rubric change re-judges) and repeat on fresh answers. Even when trusted, read deltas and defect counts, not absolute levels.</li></ol>`;
  if (!cal?.comparison) {
    return `<section id="calibration"><h2>Calibration (hand vs judge)</h2>
<p class="mute">${cal?.pending ? `${cal.pending} answers dumped for hand scoring; no scores filled in yet.` : 'Not calibrated yet. The rubric is not trusted until it agrees with hand scores on 8 answers.'}</p>${how}</section>`;
  }
  const c = cal.comparison;
  const rows = c.criteria.map((s) => `<tr><th>${esc(s.criterion)}</th><td>${s.judgeMean.toFixed(2)}</td><td>${s.handMean.toFixed(2)}</td><td>${s.bias >= 0 ? '+' : ''}${s.bias.toFixed(2)}</td><td>${pct(s.exact)}</td><td>${pct(s.within1)}</td></tr>`).join('');
  const drows = c.defects.map((d) => `<tr><th>${esc(d.defect)}</th><td>${d.judge}</td><td>${d.hand}</td><td>${d.both}</td></tr>`).join('');
  return `<section id="calibration"><h2>Calibration (hand vs judge)</h2>
<p>${c.n} answers · ±1 agreement <b>${pct(c.within1)}</b> · exact ${pct(c.exact)} · <span class="${c.trusted ? 'ok' : 'fatal'}">${c.trusted ? 'trusted' : 'not trusted'}</span></p>
<table><tr><th>criterion</th><th>judge</th><th>hand</th><th>bias</th><th>exact</th><th>±1</th></tr>${rows}</table>
${drows ? `<h3>Defects flagged</h3><table><tr><th>defect</th><th>judge</th><th>hand</th><th>both</th></tr>${drows}</table>` : ''}
<p class="mute">fatal: judge ${c.fatal.judge}, hand ${c.fatal.hand}, both ${c.fatal.both}</p>
<details><summary>How this was made</summary>${how}</details></section>`;
}

export function renderReport(sum: Summary, items: ReportItem[], cal: { comparison?: Calibration; pending?: number } | null = null): string {
  const r = sum.run;
  const stat = (label: string, v: string) => `<div><span class="mute">${esc(label)}</span><b>${esc(v)}</b></div>`;
  const byC = sum.judge.byCriterion ? Object.entries(sum.judge.byCriterion).map(([k, v]) => stat(k, v.toFixed(2))).join('') : '';
  const defects = sum.judge.defectsByKind ? Object.entries(sum.judge.defectsByKind).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ×${v}`).join(', ') : '';
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Eval ${esc(sum.runId)}</title><style>${CSS}</style></head><body>
<h1>${esc(sum.runId)}</h1>
<p class="mute">config ${esc(sum.config)} · prompt ${esc(sum.promptVersion)} · set ${esc(sum.qset)} · rubric ${esc(sum.rubric ?? 'r2')} · phase ${esc(sum.phase)} · ${esc(sum.createdAt)}</p>
${sum.fakeJudge ? '<p class="banner">Fake judge (--fake-judge): every score below is a placeholder, not a model judgement.</p>' : ''}
<div class="top">
${stat('answers', String(r.n))}${stat('judge mean', sum.judge.mean == null ? '-' : sum.judge.mean.toFixed(2))}${byC}${stat('fatal', String(sum.judge.fatal))}
${stat('first word p50 / p90', `${ms(r.firstWordMs.p50)} / ${ms(r.firstWordMs.p90)}`)}${stat('first mark p50', ms(r.firstMarkMs.p50))}
${stat('floating points', String(r.sum.floatingPoints))}${stat('label hits', String(r.sum.labelHits))}
${stat('generation $', sum.genUsd.toFixed(3))}${stat('judge $', sum.judge.usd.toFixed(3))}
</div>
${defects ? `<p><span class="mute">defects</span> ${esc(defects)}</p>` : ''}
${items.map(item).join('\n')}
${calibrationHtml(cal, sum.runId)}
</body></html>
`;
}
