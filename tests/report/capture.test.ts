import { describe, it, expect } from 'vitest';
import { AnswerLog, boardOf, buildReport, safeParams, REPORT_VERSION } from '../../src/report/capture';
import type { Action } from '../../src/script/types';

function log() {
  let t = 1000;
  const now = () => t;
  const l = new AnswerLog('Why does disparity shrink?', 3, 'agent', 1000, now, new Date('2026-10-28T10:00:00Z'));
  t = 1200; l.event({ t: 'meta', reqId: 'r1', model: 'gpt-6.1-terra', effort: 'none' });
  l.event({ t: 'scout', pages: [3, 4], plan: 'show baseline', ms: 300, usd: 0.001, opener: 'Look {{circle p=3 "Z"}} here.', atMs: 310 });
  t = 1250; l.chunk('Look {{circle p=3 "Z"}} here. ');
  t = 1300; l.words(['Look']);
  t = 1700; l.event({ t: 'handoff', ms: 700, openerEndMs: 650 });
  l.chunk('Then {{arrow p=4 mark=#d2}} far.');
  t = 1800; l.words(['Look', 'here.', 'Then', 'far.']);
  const circle = { kind: 'circle', page: 3, quote: 'Z' } as unknown as Action;
  const arrow = { kind: 'arrow', page: 4, mark: '#d2' } as unknown as Action;
  l.timing({ action: circle, firedAt: 1300, queuedAt: 1300, startedAt: 1310 });
  l.timing({ action: circle, firedAt: 1300, queuedAt: 1300, startedAt: 1310, endedAt: 1700 });
  l.timing({ action: arrow, firedAt: 1800, queuedAt: 1800, startedAt: NaN, endedAt: 1800, skipped: 'unknown mark #d2' });
  l.event({ t: 'note', message: 'dropped markdown' });
  l.event({ t: 'done', usd: 0.004, spentUsd: 1.2, capUsd: 40, ttftMs: 410, plan: 'p' });
  l.state('done');
  l.state('stopped');
  return l;
}

describe('AnswerLog', () => {
  it('records scout, stage-2 script, every action once with its timing, skips with reasons, debug timings and cost', () => {
    const a = log().snapshot();
    expect(a.scout).toMatchObject({ pages: [3, 4], plan: 'show baseline', opener: 'Look {{circle p=3 "Z"}} here.' });
    expect(a.script).toBe('Look {{circle p=3 "Z"}} here. Then {{arrow p=4 mark=#d2}} far.');
    expect(a.stage2).toBe('Then {{arrow p=4 mark=#d2}} far.');
    expect(a.spoken).toBe('Look here. Then far.');
    expect(a.timings).toHaveLength(2);
    expect(a.timings[0]).toEqual({ action: { kind: 'circle', page: 3, quote: 'Z' }, firedAt: 300, queuedAt: 300, startedAt: 310, endedAt: 700 });
    expect(a.timings[1]).toMatchObject({ startedAt: null, skipped: 'unknown mark #d2' });
    expect(a).toMatchObject({ firstChunkMs: 250, firstWordMs: 300, firstActionMs: 300, lastWordMs: 800, state: 'done', notes: ['dropped markdown'] });
    expect(a.done).toMatchObject({ usd: 0.004, ttftMs: 410 });
    expect(a.meta?.model).toBe('gpt-6.1-terra');
    expect(a.handoff).toEqual({ t: 'handoff', ms: 700, openerEndMs: 650 });
    // JSON-safe (no NaN, no class instances).
    expect(JSON.parse(JSON.stringify(a))).toEqual(a);
  });
  it('without a handoff, stage2 is the whole script', () => {
    const l = new AnswerLog('q', 1, 'script', 0, () => 5);
    l.chunk('a '); l.chunk('b');
    expect(l.snapshot().stage2).toBe('a b');
  });
});

describe('buildReport', () => {
  it('has the documented shape: doc name/hash/page only, answer, board, viewport, browser, url', () => {
    const board = boardOf(
      { split: '1:1', stacked: false, following: true, board: { x: 700, y: 60, w: 600, h: 700 } },
      [
        { id: 'C', kind: 'point', target: { region: 'side' }, bbox: { x: 1.4, y: 2.6, w: 3, h: 4 } },
        { id: '_1', kind: 'circle', target: {}, bbox: { x: 0, y: 0, w: 1, h: 1 } },
      ],
      (id) => (id === 'side' ? { page: 3, size: 'm' } : null),
    );
    const r = buildReport({
      note: '  arrow missing  ', doc: { name: 'lec.pdf', hash: 'h1', page: 3, numPages: 9 }, answer: log(), board,
      viewport: { w: 1440, h: 900, dpr: 2 }, userAgent: 'UA', platform: 'MacIntel', language: 'en-US',
      search: '?script=kit&debug', path: '/', settings: { wpm: 170 }, now: new Date('2026-10-28T10:00:05Z'),
    });
    expect(Object.keys(r).sort()).toEqual(['answer', 'board', 'browser', 'createdAt', 'doc', 'note', 'settings', 'url', 'v', 'viewport']);
    expect(r).toMatchObject({ v: REPORT_VERSION, createdAt: '2026-10-28T10:00:05.000Z', note: 'arrow missing', doc: { name: 'lec.pdf', hash: 'h1', page: 3, numPages: 9 } });
    expect(Object.keys(r.doc).sort()).toEqual(['hash', 'name', 'numPages', 'page']);
    expect(r.board).toEqual({ split: '1:1', stacked: false, following: true, rect: { x: 700, y: 60, w: 600, h: 700 }, sections: [{ id: 'side', page: 3, size: 'm', elements: [{ id: 'C', kind: 'point', bbox: { x: 1, y: 3, w: 3, h: 4 } }] }] });
    expect(r.answer?.question).toBe('Why does disparity shrink?');
    expect(r.url).toEqual({ path: '/', params: 'script=kit&debug' });
    expect(r.browser).toEqual({ userAgent: 'UA', platform: 'MacIntel', language: 'en-US' });
  });
  it('no answer yet: answer null; a private ?src= keeps only its file name', () => {
    const r = buildReport({ note: '', doc: { name: 'x.pdf', hash: null, page: 1, numPages: 1 }, answer: null, board: null, viewport: { w: 1, h: 1, dpr: 1 }, userAgent: 'UA', search: '', path: '/' });
    expect(r.answer).toBeNull();
    expect(safeParams('?src=file:///Users/me/secret/lec09.pdf')).toBe('src=%E2%80%A6%2Flec09.pdf');
    expect(safeParams('?src=/api/dev-pdf/lec09.pdf')).toBe('src=/api/dev-pdf/lec09.pdf');
  });
});
