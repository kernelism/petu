// server/report.ts — POST /api/report: the in-app Report button's save (src/report/capture.ts).
//
//   POST /api/report  { report: ReportBody, png?: "data:image/png;base64,…" } → { ok, id, dir }
//
// Writes .petu/reports/<YYYYMMDD-HHMMSS>-<slug>/report.json (+ screenshot.png). Mounted by
// server/plugin.ts behind its `guard` (loopback host, same origin, JSON). Nothing from the server's
// environment is added; the key, if it ever appears in a body, is masked before writing.
//
// `listReports` / `digest` back `npm run reports` (scripts/reports.ts). No relative imports here (the
// CLI runs this file under node --experimental-strip-types).
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { ReportBody, ReportTiming } from '../src/report/capture';

/** A window PNG at 2× plus the JSON fits well under this. */
export const REPORT_BODY_LIMIT = 24 * 1024 * 1024;

export const reportsDir = (root: string) => join(root, '.petu', 'reports');

/** `What is the fundamental matrix?` → `what-is-the-fundamental-matrix` (≤ 40 chars, ascii). */
export function slugOf(s: string): string {
  const t = s.normalize('NFKD').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40).replace(/-+$/, '');
  return t || 'report';
}

/** 2026-10-28T14:05:09.123Z → 20261028-140509 (local time). */
export function stampOf(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

export function validateReport(b: any): string | null {
  if (b == null || typeof b !== 'object') return 'body must be an object';
  const r = b.report;
  if (r == null || typeof r !== 'object' || Array.isArray(r)) return 'report is required';
  if (typeof r.v !== 'number') return 'report.v is required';
  if (r.doc == null || typeof r.doc.name !== 'string' || typeof r.doc.page !== 'number') return 'report.doc { name, page } is required';
  if (typeof r.note !== 'string' || r.note.length > 2000) return 'report.note must be a string of at most 2,000 characters';
  if (b.png != null && (typeof b.png !== 'string' || !b.png.startsWith('data:image/png;base64,'))) return 'png must be a data:image/png;base64 URL';
  return null;
}

/** Saves one report. Returns its id (the directory name). */
export function saveReport(root: string, body: { report: ReportBody; png?: string }, o: { now?: Date; secret?: string } = {}): string {
  const dir = reportsDir(root);
  mkdirSync(dir, { recursive: true });
  const now = o.now ?? new Date();
  const r = body.report;
  const base = `${stampOf(now)}-${slugOf(r.note || r.answer?.question || r.doc.name)}`;
  let id = base;
  for (let i = 2; existsSync(join(dir, id)); i++) id = `${base}-${i}`;
  const out = join(dir, id);
  mkdirSync(out);
  let text = JSON.stringify({ ...r, id, savedAt: now.toISOString() }, null, 2);
  if (o.secret && o.secret.length >= 8) text = text.split(o.secret).join('***');
  writeFileSync(join(out, 'report.json'), text + '\n');
  if (body.png) {
    const buf = Buffer.from(body.png.slice('data:image/png;base64,'.length), 'base64');
    // PNG signature, or nothing.
    if (buf.length > 8 && buf.readUInt32BE(0) === 0x89504e47) writeFileSync(join(out, 'screenshot.png'), buf);
  }
  return id;
}

/** The route. `plugin.ts` calls it after `guard` has passed. */
export async function routeReport(req: IncomingMessage, res: ServerResponse, root: string, secret?: string): Promise<void> {
  if (req.method !== 'POST') return send(res, 405, { error: 'POST only' });
  const chunks: Buffer[] = [];
  let n = 0;
  for await (const c of req as AsyncIterable<Buffer | string>) {
    const b = typeof c === 'string' ? Buffer.from(c) : c;
    n += b.length;
    if (n > REPORT_BODY_LIMIT) { res.setHeader('connection', 'close'); return send(res, 413, { error: 'report too large' }); }
    chunks.push(b);
  }
  let body: any;
  try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { return send(res, 400, { error: 'Body must be JSON.' }); }
  const bad = validateReport(body);
  if (bad) return send(res, 400, { error: bad });
  const id = saveReport(root, body, { secret });
  console.info(`petu: report saved .petu/reports/${id}`);
  return send(res, 200, { ok: true, id, dir: `.petu/reports/${id}` });
}

function send(res: ServerResponse, status: number, body: unknown) {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('cache-control', 'no-store');
  res.end(JSON.stringify(body));
}

// ---- CLI helpers (npm run reports) --------------------------------------------------------------

type Saved = ReportBody & { id: string };

export function readReport(root: string, id: string): Saved | null {
  const f = join(reportsDir(root), id, 'report.json');
  try { return JSON.parse(readFileSync(f, 'utf8')) as Saved; } catch { return null; }
}

/** Report ids, newest first. */
export function reportIds(root: string): string[] {
  const d = reportsDir(root);
  if (!existsSync(d)) return [];
  return readdirSync(d, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort().reverse();
}

const cut = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const skipsOf = (r: Saved) => (r.answer?.timings ?? []).filter((t) => t.skipped).length;

/** One line per report: time, doc:page, question, skips, note. */
export function listLine(r: Saved): string {
  const t = r.createdAt ? new Date(r.createdAt) : null;
  const when = t && !Number.isNaN(+t) ? `${t.toLocaleDateString('en-CA')} ${t.toTimeString().slice(0, 5)}` : '?';
  const q = r.answer ? `"${cut(r.answer.question, 48)}"` : '(no answer)';
  const sk = skipsOf(r);
  return `${r.id}  ${when}  ${cut(r.doc.name, 28)}:${r.doc.page}  ${q}  ${sk ? `${sk} skip${sk > 1 ? 's' : ''}` : '0 skips'}${r.note ? `  — ${cut(r.note, 60)}` : ''}`;
}

export function listReports(root: string, n = 20): string[] {
  return reportIds(root).slice(0, n).flatMap((id) => { const r = readReport(root, id); return r ? [listLine({ ...r, id })] : []; });
}

const act = (a: Record<string, unknown>): string => {
  const kind = String(a.kind ?? '?');
  const where = a.region != null ? `on=${a.region}` : a.page != null ? `p${a.page}` : '';
  const what = ['id', 'mark', 'quote', 'text', 'tex', 'ref'].flatMap((k) => (a[k] != null && a[k] !== '' ? [`${k}=${cut(typeof a[k] === 'string' ? JSON.stringify(a[k]) : String(a[k]), 40)}`] : []));
  return [kind, where, ...what].filter(Boolean).join(' ');
};
const ms = (n: number | null | undefined) => (n == null ? '—' : `${n}ms`);
function timingLine(t: ReportTiming): string {
  const start = t.startedAt != null && t.firedAt != null ? t.startedAt - t.firedAt : null;
  const run = t.endedAt != null && t.startedAt != null ? t.endedAt - t.startedAt : null;
  return `  ${String(t.firedAt ?? '—').padStart(6)}  ${t.skipped ? 'SKIP ' : `${start == null ? '…' : (start >= 0 ? '+' : '') + start}/${run == null ? '…' : run}`.padEnd(12)} ${act(t.action)}${t.skipped ? `  ← ${t.skipped}` : ''}`;
}

/** A compact, agent-readable digest of one report. */
export function digest(r: Saved, hasShot: boolean, dir: string): string {
  const L: string[] = [];
  L.push(`report ${r.id}  (${r.createdAt})`);
  if (r.note) L.push(`note: ${r.note}`);
  L.push(`doc: ${r.doc.name} p${r.doc.page}/${r.doc.numPages}  hash ${r.doc.hash ?? '—'}`);
  L.push(`viewport ${r.viewport.w}×${r.viewport.h} @${r.viewport.dpr}x · ${r.browser.userAgent}`);
  if (r.url.params) L.push(`url: ${r.url.path}?${r.url.params}`);
  L.push(`files: ${dir}/report.json${hasShot ? `, ${dir}/screenshot.png` : ' (no screenshot)'}`);
  const a = r.answer;
  if (!a) { L.push('', 'no answer in this session'); }
  else {
    L.push('', `Q (${a.source}, p${a.page}, ${a.state}${a.error ? `, error ${a.error}` : ''}): ${a.question}`);
    const d = a.done;
    L.push(`timing: first chunk ${ms(a.firstChunkMs)} · first word ${ms(a.firstWordMs)} · first action ${ms(a.firstActionMs)} · last word ${ms(a.lastWordMs)}${a.handoff ? ` · handoff ${a.handoff.ms}ms${a.handoff.openerEndMs != null ? ` (opener ended ${a.handoff.openerEndMs}ms)` : ''}` : ''}`);
    if (a.meta || d) L.push(`model ${a.meta ? `${a.meta.model}/${a.meta.effort}` : '—'}${d ? ` · ttft ${d.ttftMs}ms · $${d.usd.toFixed(4)}${d.estimated ? ' est.' : ''} · spent $${d.spentUsd.toFixed(2)}/$${d.capUsd}` : ''}${a.scout ? ` · scout $${a.scout.usd.toFixed(4)}` : ''}`);
    if (a.scout) {
      L.push('', `scout: pages ${a.scout.pages.map((p) => `p${p}`).join(' → ')} · verdict ${ms(a.scout.atMs)} · call ${a.scout.ms}ms${a.scout.fallback ? ` · FALLBACK ${a.scout.fallback}` : ''}`);
      if (a.scout.opener) L.push(`opener: ${a.scout.opener}`);
      if (a.scout.plan) L.push(`scout plan: ${a.scout.plan}`);
    }
    if (d?.plan) L.push(`stage-2 plan: ${d.plan}`);
    const notes = [...(d?.lint ?? []), ...a.notes];
    if (notes.length) L.push('', 'notes:', ...notes.map((n) => `  - ${n}`));
    L.push('', a.handoff ? 'stage-2 script:' : 'script:', a.stage2 || '(empty)');
    const sk = a.timings.filter((t) => t.skipped);
    L.push('', `actions (${a.timings.length}, ${sk.length} skipped) — at(ms from Enter)  start-vs-word/run  action:`, ...a.timings.map(timingLine));
  }
  const b = r.board;
  if (b) {
    L.push('', `board: ${b.split}${b.stacked ? ' stacked' : ''}${b.following ? '' : ' (not following)'} · ${b.sections.length} section(s)`);
    for (const s of b.sections) L.push(`  ${s.id} (p${s.page ?? '?'}, ${s.size ?? '?'}): ${s.elements.map((e) => `${e.kind}${e.id && !e.id.startsWith('_') ? `#${e.id}` : ''}`).join(' ')}`);
  }
  return L.join('\n');
}
