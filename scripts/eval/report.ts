// scripts/eval/report.ts — report.html: the review artefact (instead of recordings).
// A grid per question: sentence-end stills, the transcript, metrics and judge notes.
// Local file, relative image paths, plain HTML/CSS: no scripts, no foreignObject.
import { CRITERIA, meanScore } from './judge.ts';
import type { Summary, QuestionSummary } from './summary.ts';
import type { Question } from './questions.ts';

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
};

export const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const ms = (x: number | null) => (x == null ? '-' : `${Math.round(x)} ms`);

const CSS = `
:root{--bg:#f6f6f8;--card:#fff;--ink:#1d1d1f;--mute:#6b6b73;--line:#dcdce2;--warn:#b3261e;--ok:#1a7f4b}
@media (prefers-color-scheme:dark){:root{--bg:#141416;--card:#1d1d20;--ink:#ececf0;--mute:#9a9aa4;--line:#34343a;--warn:#ff8a80;--ok:#6fd39a}}
*{box-sizing:border-box}body{margin:0;padding:24px;background:var(--bg);color:var(--ink);font:14px/1.5 -apple-system,system-ui,sans-serif}
h1{font-size:20px;margin:0 0 4px}h2{font-size:15px;margin:0}p{margin:0}.mute{color:var(--mute)}
.top{display:flex;flex-wrap:wrap;gap:8px 24px;margin:12px 0 24px}.top div{min-width:120px}.top b{display:block;font-size:18px}
article{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:16px;margin:0 0 20px}
header{display:flex;flex-wrap:wrap;gap:6px 12px;align-items:baseline;margin-bottom:8px}
.tag{font-size:12px;color:var(--mute);border:1px solid var(--line);border-radius:999px;padding:0 8px}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:8px;margin:10px 0}
.grid a{display:block}.grid img{width:100%;height:auto;display:block;border:1px solid var(--line);border-radius:6px}
.cols{display:grid;grid-template-columns:minmax(0,3fr) minmax(0,2fr);gap:16px}@media (max-width:800px){.cols{grid-template-columns:1fr}}
.tr{white-space:pre-wrap;font-size:13px}.tr .bad{color:var(--warn)}
table{border-collapse:collapse;font-size:12px;width:100%}td,th{padding:2px 8px 2px 0;text-align:left;border-bottom:1px solid var(--line)}
.fatal{color:var(--warn);font-weight:600}.ok{color:var(--ok)}
a{color:inherit}a:focus-visible{outline:2px solid currentColor;outline-offset:2px}
`;

/** Marks tag brackets in the transcript: failed ones in the warning colour. */
function transcriptHtml(t: string): string {
  return esc(t).replace(/\[[^\]]*\]/g, (m) => (m.includes('✗') ? `<span class="bad">${m}</span>` : `<span class="mute">${m}</span>`));
}

function item(it: ReportItem): string {
  const { q, summary: s } = it;
  const m = s.metrics, j = s.judge;
  const imgs = (list: string[], label: string) => list.length
    ? `<div class="grid" aria-label="${esc(label)}">${list.map((p, i) => `<a href="${esc(p)}"><img loading="lazy" src="${esc(p)}" alt="${esc(`${q.id} ${label} ${i + 1}`)}"></a>`).join('')}</div>` : '';
  const row = (k: string, v: string | number) => `<tr><th>${esc(k)}</th><td>${esc(String(v))}</td></tr>`;
  const sk = Object.entries(m.skipped).map(([k, v]) => `${k} x${v}`).join(', ') || 'none';
  const judgeHtml = j
    ? `<table>${CRITERIA.map((c) => row(c, j.scores[c])).join('')}${row('mean', meanScore(j).toFixed(2))}</table>
       ${j.fatal.length ? `<p class="fatal">fatal: ${esc(j.fatal.join(', '))}</p>` : '<p class="ok">no fatal flags</p>'}
       <p>${esc(j.notes)}</p>`
    : '<p class="mute">not judged</p>';
  return `<article id="${esc(q.id)}${s.turn ? `-t${s.turn}` : ''}">
<header><h2>${esc(q.id)}${s.turn ? ` (turn ${s.turn + 1})` : ''}</h2><span class="tag">${esc(q.split)}</span><span class="tag">${esc(q.type)}</span><span class="tag">${esc(q.deck)} p${q.page}</span></header>
<p><b>${esc(it.asked)}</b></p>
${it.sheet ? `<div class="grid"><a href="${esc(it.sheet)}"><img loading="lazy" src="${esc(it.sheet)}" alt="${esc(q.id)} contact sheet"></a></div>` : imgs(it.stills, 'sentence-end still')}
${it.webkit ? imgs(it.webkit, 'WebKit still') : ''}
<div class="cols"><div><div class="tr">${transcriptHtml(it.transcript)}</div></div>
<div><table>${row('first word', ms(m.firstWordMs))}${row('first mark', ms(m.firstMarkMs))}${row('total', ms(m.totalMs))}
${row('cost', `$${m.usd.toFixed(4)}${m.estimated ? ' (est.)' : ''}`)}${row('cached', `${Math.round(m.cachedShare * 100)}%`)}
${row('elements', m.elements)}${row('max new / sentence', m.maxNewPerSentence)}${row('skipped', sk)}${row('malformed', m.malformed)}${row('linted', m.linted)}
${row('floating points', m.floatingPoints)}${row('label hits / clipped', `${m.labelHits} / ${m.labelsClipped}`)}${row('out of frame', m.outOfFrame)}
${row('words', m.words)}${row('takeaway first', m.takeawayFirst ? 'yes' : 'no')}${row('leaks', m.leaks)}</table>
${judgeHtml}</div></div></article>`;
}

export function renderReport(sum: Summary, items: ReportItem[]): string {
  const r = sum.run;
  const stat = (label: string, v: string) => `<div><span class="mute">${esc(label)}</span><b>${esc(v)}</b></div>`;
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Eval ${esc(sum.runId)}</title><style>${CSS}</style></head><body>
<h1>${esc(sum.runId)}</h1>
<p class="mute">config ${esc(sum.config)} · prompt ${esc(sum.promptVersion)} · set ${esc(sum.qset)} · phase ${esc(sum.phase)} · ${esc(sum.createdAt)}</p>
<div class="top">
${stat('answers', String(r.n))}${stat('judge mean', sum.judge.mean == null ? '-' : sum.judge.mean.toFixed(2))}${stat('fatal', String(sum.judge.fatal))}
${stat('first word p50 / p90', `${ms(r.firstWordMs.p50)} / ${ms(r.firstWordMs.p90)}`)}${stat('first mark p50', ms(r.firstMarkMs.p50))}
${stat('takeaway first', `${Math.round(r.takeawayFirstRate * 100)}%`)}${stat('floating points', String(r.sum.floatingPoints))}${stat('label hits', String(r.sum.labelHits))}
${stat('generation $', sum.genUsd.toFixed(3))}${stat('judge $', sum.judge.usd.toFixed(3))}
</div>
${items.map(item).join('\n')}
</body></html>
`;
}
