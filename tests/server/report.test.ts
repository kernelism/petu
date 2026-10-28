// @vitest-environment node
import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, readFileSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable, Writable } from 'node:stream';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { parseEnv } from '../../server/env';
import { createApi } from '../../server/plugin';
import { digest, listReports, readReport, reportIds, slugOf, stampOf } from '../../server/report';

const KEY = 'sk-test-REPORT-secret-123';
const PNG = 'data:image/png;base64,' + Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]).toString('base64');

function fakeReq(method: string, url: string, body = '', headers: Record<string, string | undefined> = {}): IncomingMessage {
  const r = Readable.from(body.length ? [Buffer.from(body)] : []) as unknown as IncomingMessage;
  const h: Record<string, string | undefined> = { host: 'localhost:5197', ...(method === 'POST' ? { 'content-type': 'application/json' } : {}), ...headers };
  Object.assign(r, { method, url, headers: Object.fromEntries(Object.entries(h).filter(([, v]) => v !== undefined)) });
  return r;
}
function fakeRes() {
  const chunks: Buffer[] = [];
  const w = new Writable({ write(c, _e, cb) { chunks.push(Buffer.from(c)); cb(); } }) as unknown as ServerResponse & { body(): string };
  const hs: Record<string, string | number> = {};
  Object.assign(w, { statusCode: 200, setHeader(k: string, v: string | number) { hs[k.toLowerCase()] = v; return w; }, getHeader: (k: string) => hs[k.toLowerCase()], flushHeaders() {}, body: () => Buffer.concat(chunks).toString('utf8') });
  return w;
}

const report = (over: Record<string, unknown> = {}) => ({
  v: 1, createdAt: '2026-10-28T12:00:00.000Z', note: 'arrow lands off the epipole',
  doc: { name: 'Stereo Vision — sample.pdf', hash: 'abc', page: 3, numPages: 6 },
  answer: {
    question: 'Why do epipolar lines meet?', page: 3, startedAt: '2026-10-28T11:59:50.000Z', source: 'script', state: 'done', notes: ['lint: x'],
    chunks: [{ t: 10, d: 'Take {{circle p=3 "x"}} this.' }], script: 'Take {{circle p=3 "x"}} this.', stage2: 'Take {{circle p=3 "x"}} this.', spoken: 'Take this.',
    timings: [
      { action: { kind: 'circle', page: 3, quote: 'x' }, firedAt: 120, queuedAt: 120, startedAt: 130, endedAt: 600 },
      { action: { kind: 'arrow', page: 3, mark: '#d9' }, firedAt: 400, queuedAt: 400, startedAt: 400, endedAt: 400, skipped: 'unknown mark #d9' },
    ],
    firstChunkMs: 10, firstWordMs: 50, firstActionMs: 120, lastWordMs: 900,
  },
  board: { split: '1:1', stacked: false, following: true, sections: [{ id: 'side', page: 3, size: 'm', elements: [{ id: 'C', kind: 'point', bbox: { x: 1, y: 2, w: 3, h: 4 } }] }] },
  viewport: { w: 1440, h: 900, dpr: 2 }, browser: { userAgent: 'test' }, url: { path: '/', params: 'script=kit' },
  ...over,
});

let root = '';
beforeEach(() => { root = mkdtempSync(join(tmpdir(), 'petu-report-')); });
const env = () => parseEnv((k) => ({ OPENAI_API_KEY: KEY } as Record<string, string>)[k], { root, home: root });
async function post(body: unknown, headers: Record<string, string | undefined> = {}, method = 'POST') {
  const api = createApi({ env: env(), root });
  const res = fakeRes();
  let nexted = false;
  await api.handle(fakeReq(method, '/api/report', typeof body === 'string' ? body : JSON.stringify(body), headers), res, () => { nexted = true; });
  return { status: res.statusCode, json: res.body() ? JSON.parse(res.body()) : null, nexted };
}

describe('POST /api/report', () => {
  it('saves report.json and screenshot.png under .petu/reports/<stamp>-<slug>/', async () => {
    const r = await post({ report: report(), png: PNG });
    expect(r.status).toBe(200);
    expect(r.json.id).toMatch(/^\d{8}-\d{6}-arrow-lands-off-the-epipole$/);
    const dir = join(root, '.petu', 'reports', r.json.id);
    const saved = JSON.parse(readFileSync(join(dir, 'report.json'), 'utf8'));
    expect(saved).toMatchObject({ id: r.json.id, doc: { name: 'Stereo Vision — sample.pdf', page: 3 }, answer: { question: 'Why do epipolar lines meet?' } });
    expect(readFileSync(join(dir, 'screenshot.png')).subarray(0, 4).toString('hex')).toBe('89504e47');
  });

  it('never writes the key, even when a body carries it', async () => {
    const r = await post({ report: report({ note: `leak ${KEY} here` }) });
    expect(r.status).toBe(200);
    const text = readFileSync(join(root, '.petu', 'reports', r.json.id, 'report.json'), 'utf8');
    expect(text).not.toContain(KEY);
    expect(text).toContain('***');
    expect(existsSync(join(root, '.petu', 'reports', r.json.id, 'screenshot.png'))).toBe(false);
  });

  it('keeps the request guard: foreign host or origin, no JSON content type, no CORS, GET', async () => {
    expect((await post({ report: report() }, { host: 'evil.example:5197' })).status).toBe(403);
    expect((await post({ report: report() }, { origin: 'http://evil.example' })).status).toBe(403);
    expect((await post({ report: report() }, { 'content-type': 'text/plain' })).status).toBe(415);
    expect((await post('', {}, 'OPTIONS')).status).toBe(405);
    expect((await post('', {}, 'GET')).status).toBe(405);
    expect((await post({ report: report() }, { origin: 'http://localhost:5197' })).status).toBe(200);
    // Nothing refused was written.
    expect(readdirSync(join(root, '.petu', 'reports'))).toHaveLength(1);
  });

  it('rejects malformed bodies', async () => {
    expect((await post('{nope')).status).toBe(400);
    expect((await post({})).status).toBe(400);
    expect((await post({ report: report({ doc: { page: 1 } }) })).status).toBe(400);
    expect((await post({ report: report(), png: 'data:image/jpeg;base64,AAAA' })).status).toBe(400);
    expect(existsSync(join(root, '.petu', 'reports')) ? reportIds(root) : []).toHaveLength(0);
  });

  it('same second, same slug: a suffix, never an overwrite', async () => {
    const a = await post({ report: report() });
    const b = await post({ report: report() });
    expect(b.json.id).not.toBe(a.json.id);
    expect(reportIds(root)).toHaveLength(2);
  });
});

describe('npm run reports helpers', () => {
  it('lists one line per report and prints a digest with skips and the stage-2 script', async () => {
    const { json } = await post({ report: report(), png: PNG });
    const lines = listReports(root);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('Stereo Vision — sample.pdf:3');
    expect(lines[0]).toContain('"Why do epipolar lines meet?"');
    expect(lines[0]).toContain('1 skip');
    expect(lines[0]).toContain('arrow lands off the epipole');
    const r = readReport(root, json.id)!;
    const d = digest({ ...r, id: json.id }, true, 'X');
    expect(d).toContain('unknown mark #d9');
    expect(d).toContain('SKIP');
    expect(d).toContain('Take {{circle p=3 "x"}} this.');
    expect(d).toContain('side (p3, m): point#C');
    expect(d).toContain('X/screenshot.png');
  });
  it('slugs and stamps', () => {
    expect(slugOf('What is the fundamental matrix?')).toBe('what-is-the-fundamental-matrix');
    expect(slugOf('—')).toBe('report');
    expect(stampOf(new Date(2026, 9, 28, 14, 5, 9))).toBe('20261028-140509');
  });
});
