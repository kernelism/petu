import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { stressScript, normReason, summarise, formatSummary, collectEval, collectSmoke, collectScratch, dedupe, type ReplayEnv } from '../../scripts/eval/replayStress';
import type { PageGround } from '../../src/agent/context/types';
import type { TextRun } from '../../src/locate/locateQuote';

const run = (text: string, x: number, y: number, w: number, h = 20): TextRun => ({ text, rect: { x, y, w, h } });
const runs = [run('The residual block adds the input back', 50, 100, 600), run('to the output of two layers.', 50, 130, 420)];
const page4: PageGround = {
  page: 4, aspect: 1.3, noText: false,
  lines: [{ id: 't1', text: 'The residual block adds the input back', rect: { x: 50, y: 100, w: 600, h: 20 }, runs: [runs[0]], math: false }],
  marks: [{ id: '#d1', kind: 'dot', at: { x: 300, y: 500 } }, { id: '#s1', kind: 'line', from: { x: 100, y: 600 }, to: { x: 400, y: 600 } }],
};
const env: ReplayEnv = { numPages: 10, grounds: new Map([[4, page4]]), runs: (p) => (p === 4 ? runs : p === 5 ? [] : undefined) };
const statuses = (s: string, e: ReplayEnv = env) => stressScript(s, e).outcomes.map((o) => (o.status === 'skip' ? `${o.tag}:${o.reason}` : `${o.tag}:${o.status}`));

describe('replay stress: the offline engine', () => {
  it('resolves marks, quotes and names; skips what the engine would skip, with its reason', () => {
    expect(statuses('See {{circle p=4 mark=#d1}} this, {{highlight p=4 "adds the input back"}} and {{line p=4 mark=#s1}} here.'))
      .toEqual(['circle:ok', 'highlight:ok', 'line:ok']);
    expect(statuses('{{circle p=4 mark=#d9}} {{highlight p=4 "not on the page"}} {{line p=4 mark=#d1}} {{scroll p=40}}'))
      .toEqual(['circle:unknown mark', 'highlight:quote not found', 'line:mark is not a line', 'scroll:page out of range']);
    // A page the answer sent without a listing: its marks never resolve (the director's grounding has only listed pages).
    expect(statuses('{{circle p=5 mark=#d1}}')).toEqual(['circle:unknown mark']);
  });
  it('board sections, names and references', () => {
    const s = '{{sketch id=s near=p4}} {{let on=s A=0,0 B=200,0 M=mid(A,B)}} {{line on=s from=A to=M}} {{point on=s at=M "M" id=m}} {{arrow on=s from=A to=Z}} {{line on=t from=A to=B}} {{label id=m "mid"}} {{emph id=q}}';
    expect(statuses(s)).toEqual(['sketch:ok', 'line:ok', 'point:ok', 'arrow:unknown point', 'line:unknown region', 'label:ok', 'emph:unknown id']);
  });
  it('the kit: computed sources, window outputs, duplicates', () => {
    const s = '{{sketch id=s}} {{grid on=s id=img vals="1 2 3;4 5 6;7 8 9"}} {{grid on=s id=k vals="1 0;0 1" right=img}} {{grid on=s id=out over=img slide=k right=k}} {{step id=out[1,1]}} {{step id=out[3,3]}} {{sweep id=img}} {{bars on=s id=v map=nope fn="x*2"}} {{grid on=s id=k vals="1"}}';
    expect(statuses(s)).toEqual(['sketch:ok', 'grid:ok', 'grid:ok', 'grid:ok', 'step:ok', 'step:step outside the output', "sweep:not a window's output", 'bars:unknown block', 'grid:duplicate id']);
  });
  it('counts malformed and unclosed tags, and let names the parser drops', () => {
    const r = stressScript('Hi {{circle p=4 x=1 y=2}} there {{sketch id=s}} {{let on=s A=0,0 A=1,1 B=2,2}} and {{line p=4 from=1,2');
    expect(r.malformed).toEqual(['circle']);
    expect(r.unclosed).toBe(1);
    expect(r.letDropped).toEqual(['name defined twice']);
  });
  it('without the PDF, page marks and quotes are unverified, never skips', () => {
    expect(statuses('{{circle p=4 mark=#d1}} {{highlight p=4 "x y z"}} {{sketch id=s}} {{line on=s from=1,2 to=3,4}}', {}))
      .toEqual(['circle:unverified', 'highlight:unverified', 'sketch:ok', 'line:ok']);
  });
  it('normalises reasons', () => {
    expect(normReason('unknown point Z')).toBe('unknown point');
    expect(normReason("out is not a window's output")).toBe("not a window's output");
    expect(normReason('quote not found')).toBe('quote not found');
  });
});

describe('replay stress: recordings and report', () => {
  it('collects eval turns, smoke runs and scratch files; dedupes by script; summarises by tag and against live skips', () => {
    const d = mkdtempSync(join(tmpdir(), 'rs-'));
    mkdirSync(join(d, 'runs/r1/D1'), { recursive: true });
    const timings = [{ action: { kind: 'circle' }, skipped: 'unknown mark #d9' }, { action: { kind: 'highlight' } }];
    writeFileSync(join(d, 'runs/r1/D1/result.json'), JSON.stringify({ open: { src: '/x.pdf', page: 4 }, turns: [{ chunks: [{ d: 'A {{circle p=4 mark=#d9}} b ' }, { d: '{{highlight p=4 "adds the input back"}}' }], events: [{ t: 'scout', pages: [4, 6] }], timings }] }));
    mkdirSync(join(d, 'runs/r2/D1'), { recursive: true }); // a replay run: same chunks
    writeFileSync(join(d, 'runs/r2/D1/result.json'), JSON.stringify({ open: { src: '/x.pdf', page: 4 }, turns: [{ chunks: [{ d: 'A {{circle p=4 mark=#d9}} b ' }, { d: '{{highlight p=4 "adds the input back"}}' }] }] }));
    mkdirSync(join(d, 'smoke/r1'), { recursive: true });
    writeFileSync(join(d, 'smoke/r1/corner.json'), JSON.stringify({ id: 'corner', page: 4, scout: { pages: [4] }, script: 'x {{scroll p=4}}' }));
    mkdirSync(join(d, 'scratch/a'), { recursive: true });
    writeFileSync(join(d, 'scratch/a/q1.json'), JSON.stringify({ q: 'q', script: '{{emph id=nope}}', skipped: [['emph', 'unknown id']] }));
    writeFileSync(join(d, 'scratch/a/rows.json'), '[]');
    const ev = collectEval(join(d, 'runs'), () => 'deck');
    expect(ev).toHaveLength(2);
    expect(ev[0]).toMatchObject({ source: 'eval', pdf: 'deck', page: 4, scoutPages: [4, 6], liveActions: 2, live: [{ tag: 'circle', reason: 'unknown mark' }] });
    const recs = dedupe([...ev, ...collectSmoke(join(d, 'smoke'), () => 'lec07'), ...collectScratch(join(d, 'scratch'))]);
    expect(recs.map((r) => r.source)).toEqual(['eval', 'smoke', 'scratch']);
    const items = recs.map((rec) => ({ rec, rep: stressScript(rec.script, rec.source === 'eval' ? env : {}), grounded: rec.source === 'eval' }));
    const s = summarise(items);
    expect(s).toMatchObject({ recordings: 3, withPdf: 1, actions: 4, skipped: 2, unverified: 0, skipRate: 0.5 });
    expect(s.byTag.find((t) => t.tag === 'circle')).toMatchObject({ n: 1, skipped: 1, reasons: { 'unknown mark': 1 } });
    // Live comparison needs the live action count (eval and smoke recordings carry it; scratch files don't).
    expect(s.live).toMatchObject({ recordings: 1, liveSkipped: 1, agreeing: 1 });
    expect(formatSummary(s)).toMatch(/3 distinct scripts/);
  });
});
