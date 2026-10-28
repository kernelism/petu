// @vitest-environment node
import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Ledger } from '../../server/ledger';
import { type AnswerRecord, ask, buildStoryboardRequest, storyboard, storyCacheKey, type Deps, type ModelConfig } from '../../server/openai';
import { STORYBOARD_SYSTEM, STORYBOARD_VERSION } from '../../server/prompt/storyboard';
import { parseStoryboard, storyboardText, STORYBOARD_LIMITS, type Storyboard } from '../../src/agent/storyboard';
import type { AskContext, AskEvent, AskRequest } from '../../src/agent/protocol';
import { EVAL_VOCAB } from './prompt.test';

const KEY = 'sk-test-SECRET-abc123';
const cfg: ModelConfig = { model: 'gpt-6.1-terra', effort: 'none', maxOutput: 1400, fast: false, explicitCache: true };
const story: ModelConfig = { model: 'gpt-6.1-terra', effort: 'low', maxOutput: 4000, fast: false, explicitCache: true };
const context: AskContext = {
  docName: 'd.pdf', docHash: 'abc', numPages: 9, page: 2,
  docText: 'DOC digest', pageText: 'PAGE 2 lines', image: { b64: 'A'.repeat(400), w: 1024, h: 768 },
  pagesText: 'PAGE 5 lines', images: [{ page: 5, b64: 'B'.repeat(400), w: 1024, h: 768 }],
  scout: { pages: [2, 5], plan: 'walk 2 then 5' }, opener: 'Prices rise because buyers compete. {{highlight p=2 mark=#t3}}',
};
const req = (over: Partial<AskRequest> = {}): AskRequest => ({ question: 'Why does the price rise?', history: [], context, ...over });

const BOARD: Storyboard = {
  confusion: 'why a small shift moves the price so much',
  example: 'ten buyers with values 10, 9, … 1 and five units for sale',
  scene: { things: 'buyers as labelled chips in value order', relations: 'a line marks who buys', changes: 'the line moves when a unit is removed' },
  beats: [
    { say: 'line the buyers up by value', board: 'ten chips appear, highest first', slide: 'p2: the table', ties: 'connect the table row to the chips' },
    { say: 'five units: the five highest buy', board: 'a cut line after the fifth chip', slide: '', ties: '' },
    { say: 'remove one unit', board: 'the cut moves left; the price label follows', slide: 'p5: the sentence on scarcity', ties: 'connect it to the cut' },
  ],
  aha: 3,
  check: 'What happens to the price if two more buyers arrive with value 8?',
};

const sse = (o: object) => `event: x\ndata: ${JSON.stringify(o)}\n\n`;
const usage = { input_tokens: 9000, output_tokens: 900, input_tokens_details: { cached_tokens: 4000, cache_write_tokens: 0 }, output_tokens_details: { reasoning_tokens: 400 } };
const reply = (text: string, done = 'response.completed') => [
  sse({ type: 'response.output_item.added', item: { id: 'm1', type: 'message' } }),
  ...[text.slice(0, 20), text.slice(20)].map((d) => sse({ type: 'response.output_text.delta', item_id: 'm1', delta: d })),
  sse({ type: done, response: { status: 'completed', usage } }),
];

type Call = { url: string; body: any };
/** Scripted upstream: each call takes the next reply; `hang` never sends and errors on abort. */
function fakeFetch(replies: ({ chunks: string[] } | { status: number; text?: string } | 'hang')[]) {
  const calls: Call[] = [];
  const f = (async (url: string, init: RequestInit) => {
    calls.push({ url, body: JSON.parse(String(init.body)) });
    const r = replies.shift();
    if (!r) throw new Error('unexpected fetch');
    if (r === 'hang') {
      return new Promise<Response>((_, no) => {
        const s = init.signal!;
        const fail = () => no(new DOMException('aborted', 'AbortError'));
        if (s.aborted) fail(); else s.addEventListener('abort', fail);
      });
    }
    if ('status' in r) return new Response(r.text ?? '', { status: r.status });
    const enc = new TextEncoder();
    let i = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(c) {
        if (init.signal!.aborted) { c.error(new DOMException('aborted', 'AbortError')); return; }
        if (i < r.chunks.length) c.enqueue(enc.encode(r.chunks[i++])); else c.close();
      },
    }, { highWaterMark: 0 });
    return new Response(body, { status: 200 });
  }) as unknown as typeof fetch;
  return { f, calls };
}

let dir = '';
let ledger: Ledger;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'story-'));
  ledger = new Ledger(join(dir, 'spend.json'), { totalUsd: 40 });
});
const deps = (f: typeof fetch, over: Partial<Deps> = {}): Deps => ({ key: KEY, ledger, phase: 'dev', fetch: f, sleep: async () => {}, ...over });
const entries = () => JSON.parse(readFileSync(join(dir, 'spend.json'), 'utf8')) as { entries: { kind: string; usd: number; estimated?: boolean }[]; open?: Record<string, unknown> };
async function run(r: AskRequest, d: Deps, signal = new AbortController().signal, onEmit?: (e: AskEvent) => void) {
  const out: AskEvent[] = [];
  await ask(r, cfg, d, (e) => { out.push(e); onEmit?.(e); }, signal, story);
  return out;
}

describe('parseStoryboard', () => {
  it('accepts the schema, and tolerates fences and prose around the object', () => {
    expect(parseStoryboard(JSON.stringify(BOARD))).toEqual({ board: BOARD });
    expect(parseStoryboard('Here:\n```json\n' + JSON.stringify(BOARD) + '\n```')).toEqual({ board: BOARD });
  });

  it('falls back on empty, non-JSON, broken JSON, no beats, no example', () => {
    expect(parseStoryboard('')).toEqual({ fallback: 'storyboard was empty' });
    expect(parseStoryboard('no json here')).toEqual({ fallback: 'storyboard returned no JSON' });
    expect(parseStoryboard('{"example": "x", "beats": [}')).toEqual({ fallback: 'storyboard returned bad JSON' });
    expect(parseStoryboard('[1,2]')).toMatchObject({ fallback: expect.any(String) });
    expect(parseStoryboard(JSON.stringify({ ...BOARD, beats: [] }))).toEqual({ fallback: 'storyboard has no beats' });
    expect(parseStoryboard(JSON.stringify({ ...BOARD, beats: [{ say: '', board: '', slide: 'p2', ties: '' }] }))).toEqual({ fallback: 'storyboard has no beats' });
    expect(parseStoryboard(JSON.stringify({ ...BOARD, example: '  ' }))).toEqual({ fallback: 'storyboard has no example' });
  });

  it('repairs what it can: aha out of range → the middle beat, long fields cut at a word, extra beats cut, missing scene → empty', () => {
    const many = Array.from({ length: 20 }, (_, i) => ({ say: `beat ${i}`, board: 'b', slide: '', ties: '' }));
    const r = parseStoryboard(JSON.stringify({ ...BOARD, aha: 99, beats: many, confusion: 'word '.repeat(400), scene: undefined }));
    expect('board' in r).toBe(true);
    const b = (r as { board: Storyboard }).board;
    expect(b.beats).toHaveLength(STORYBOARD_LIMITS.beats);
    expect(b.aha).toBe(STORYBOARD_LIMITS.beats / 2);
    expect(b.confusion.length).toBeLessThanOrEqual(STORYBOARD_LIMITS.field + 1);
    expect(b.confusion.endsWith('…')).toBe(true);
    expect(b.scene).toEqual({ things: '', relations: '', changes: '' });
    expect((parseStoryboard(JSON.stringify({ ...BOARD, aha: '2' })) as { board: Storyboard }).board.aha).toBe(2);
  });

  it('reads for stage 2 as numbered beats with the aha marked and the check question last', () => {
    const t = storyboardText(BOARD);
    expect(t).toMatch(/^STORYBOARD \(/);
    expect(t).toContain('Carrying example: ten buyers');
    expect(t).toContain('1. say: line the buyers up by value | board: ten chips appear, highest first | slide: p2: the table | ties: connect the table row to the chips');
    expect(t).toContain('2. say: five units: the five highest buy | board: a cut line after the fifth chip\n');
    expect(t).toContain('3. (the aha) say: remove one unit');
    expect(t.trim().split('\n').pop()).toMatch(/^Check question .*two more buyers/);
  });
});

describe('storyboard prompt', () => {
  it('is a brief: principles only, no subject recipes, no counts or caps, no eval vocabulary', () => {
    for (const banned of EVAL_VOCAB) expect(STORYBOARD_SYSTEM).not.toMatch(banned);
    expect(STORYBOARD_SYSTEM).not.toMatch(/\bat most \d|\bat least \d|\d+\s*[–-]\s*\d+ (words|beats|elements)|\bexactly \w+ beats|\bmax(imum)? \d/i);
    expect(STORYBOARD_SYSTEM).not.toMatch(/\bmode\b|\{\{/);
    for (const p of [/One carrying example/, /One central scene that evolves/, /Tie it to the document/, /The aha/, /A check question/, /pages' own/, /Never invent page content/]) expect(STORYBOARD_SYSTEM).toMatch(p);
    expect(STORYBOARD_VERSION).toMatch(/^b\d+\.\d+$/);
  });
});

describe('buildStoryboardRequest', () => {
  it('reads what stage 2 reads (digest, visible page + image, the scout pages, images and plan), then the question and the opener; strict JSON out, its own cache key', () => {
    const b = buildStoryboardRequest(req({ history: [{ q: 'q0', a: 'a0', page: 1 }] }), story) as any;
    expect(b.model).toBe('gpt-6.1-terra');
    expect(b.reasoning).toEqual({ effort: 'low' });
    expect(b.prompt_cache_key).toBe(storyCacheKey());
    expect(b.stream).toBe(true);
    expect(b.text.format).toMatchObject({ type: 'json_schema', name: 'storyboard', strict: true });
    expect(b.input[0]).toMatchObject({ role: 'developer', content: [{ text: STORYBOARD_SYSTEM, prompt_cache_breakpoint: { mode: 'explicit', ttl: '12h' } }] });
    expect(b.input[1].content.map((c: any) => c.text ?? c.type)).toEqual(['DOC digest', 'PAGE 2 lines', 'input_image']);
    expect(b.input[2].content[0].text).toBe('QUESTION (page 1): q0');
    const tail = b.input[4].content.map((c: any) => c.text ?? c.type);
    expect(tail).toEqual([
      'PAGE 5 lines', 'IMAGE of page 5:', 'input_image', 'PLAN (a first read of the whole document; pages in teaching order: 2, 5): walk 2 then 5',
      'QUESTION (the student is looking at page 2): Why does the price rise?', expect.stringMatching(/^OPENING ALREADY SPOKEN .*Prices rise because buyers compete/),
    ]);
  });
});

describe('ask with a storyboard: opener → storyboard → stage 2', () => {
  it('designs first, then stage 2 performs it; events storyboard → meta → text → done; both calls booked; the record keeps the storyboard', async () => {
    const { f, calls } = fakeFetch([{ chunks: reply(JSON.stringify(BOARD)) }, { chunks: reply('Line them up.') }]);
    const recs: AnswerRecord[] = [];
    const out = await run(req(), deps(f, { log: (r) => recs.push(r) }));
    expect(calls).toHaveLength(2);
    expect(calls[0].body.text.format.name).toBe('storyboard');
    const tail2 = calls[1].body.input.at(-1).content.map((c: any) => c.text ?? c.type) as string[];
    const at = (re: RegExp) => tail2.findIndex((t) => re.test(t));
    // Stage 2 keeps the plan, then reads the storyboard, then the question and the opener note.
    expect(at(/^PLAN/)).toBeGreaterThan(-1);
    expect(at(/^STORYBOARD/)).toBeGreaterThan(at(/^PLAN/));
    expect(at(/^QUESTION/)).toBeGreaterThan(at(/^STORYBOARD/));
    expect(at(/^ALREADY SPOKEN/)).toBe(tail2.length - 1);
    expect(order(out)).toEqual(['storyboard', 'meta', 'text', 'done']);
    const sb = out[0] as Extract<AskEvent, { t: 'storyboard' }>;
    expect(sb).toMatchObject({ model: 'gpt-6.1-terra', effort: 'low', version: STORYBOARD_VERSION, board: BOARD, input: 9000, cached: 4000, output: 900, reasoning: 400 });
    expect(sb.fallback).toBeUndefined();
    expect(sb.usd).toBeGreaterThan(0);
    const e = entries();
    expect(e.entries.map((x) => x.kind)).toEqual(['storyboard', 'answer']);
    expect(e.entries[0].usd).toBeCloseTo(sb.usd, 10);
    expect(Object.keys(e.open ?? {})).toHaveLength(0);
    expect(recs[0].storyboard).toMatchObject({ board: BOARD, model: 'gpt-6.1-terra', usd: sb.usd });
  });

  it('bad JSON → fallback: stage 2 runs on the scout plan alone (no STORYBOARD block)', async () => {
    const { f, calls } = fakeFetch([{ chunks: reply('{"beats": [oops]}') }, { chunks: reply('Line them up.') }]);
    const out = await run(req(), deps(f));
    expect(out[0]).toMatchObject({ t: 'storyboard', fallback: 'storyboard returned bad JSON' });
    const tail2 = calls[1].body.input.at(-1).content.map((c: any) => c.text ?? '') as string[];
    expect(tail2.some((t) => t.startsWith('STORYBOARD'))).toBe(false);
    expect(tail2.some((t) => t.startsWith('PLAN'))).toBe(true);
    expect(order(out)).toEqual(['storyboard', 'meta', 'text', 'done']);
  });

  it('an upstream error, or a reply cut short, also falls back; an HTTP error frees its reservation', async () => {
    const a = fakeFetch([{ status: 500, text: `boom ${KEY}` }, { chunks: reply('Go.') }]);
    const out = await run(req(), deps(a.f));
    expect(out[0]).toMatchObject({ t: 'storyboard', usd: 0, fallback: expect.stringMatching(/^storyboard failed: OpenAI 500/) });
    expect(JSON.stringify(out)).not.toContain(KEY);
    expect(entries().entries.map((x) => x.kind)).toEqual(['answer']);
    const b = fakeFetch([{ chunks: reply(JSON.stringify(BOARD), 'response.incomplete') }, { chunks: reply('Go.') }]);
    const out2 = await run(req(), deps(b.f));
    expect(out2[0]).toMatchObject({ t: 'storyboard', fallback: 'storyboard cut short upstream' });
  });

  it('a storyboard past its deadline → fallback "timed out", booked as an estimate; stage 2 still answers', async () => {
    const { f } = fakeFetch(['hang', { chunks: reply('Go.') }]);
    const out = await run(req(), deps(f, { timeouts: { callMs: 30 } }));
    expect(out[0]).toMatchObject({ t: 'storyboard', fallback: 'storyboard timed out', estimated: true });
    expect(texts(out)).toBe('Go.');
    const e = entries();
    expect(e.entries[0]).toMatchObject({ kind: 'storyboard', estimated: true });
    expect(e.entries[0].usd).toBeGreaterThan(0);
  });

  it('no opener (the scout fell back) → no storyboard: nothing would cover the wait', async () => {
    const { f, calls } = fakeFetch([{ chunks: reply('Go.') }]);
    const out = await run(req({ context: { ...context, opener: undefined } }), deps(f));
    expect(calls).toHaveLength(1);
    expect(out.map((e) => e.t)).toEqual(['meta', 'text', 'done']);
  });

  it('Esc while the storyboard is being designed: no stage 2 call, no events, the storyboard booked, nothing left open', async () => {
    const { f, calls } = fakeFetch(['hang']);
    const ctl = new AbortController();
    const recs: AnswerRecord[] = [];
    const p = run(req(), deps(f, { log: (r) => recs.push(r) }), ctl.signal);
    await new Promise((r) => setTimeout(r, 10));
    ctl.abort();
    const out = await p;
    expect(out).toEqual([]);
    expect(calls).toHaveLength(1);
    const e = entries();
    expect(e.entries.map((x) => x.kind)).toEqual(['storyboard']);
    expect(Object.keys(e.open ?? {})).toHaveLength(0);
    expect(recs[0]).toMatchObject({ error: 'aborted', storyboard: { fallback: 'aborted' } });
  });

  it('a storyboard the cap refuses falls back without calling upstream', async () => {
    const tight = new Ledger(join(dir, 'tight.json'), { totalUsd: 0.0001 });
    const { f, calls } = fakeFetch([]);
    const out: AskEvent[] = [];
    await ask(req(), cfg, deps(f, { ledger: tight }), (e) => out.push(e), new AbortController().signal, story);
    expect(out[0]).toMatchObject({ t: 'storyboard', fallback: 'cap', usd: 0 });
    expect(calls).toHaveLength(0);
  });

  it('storyboard() alone never throws without a key', async () => {
    const { f } = fakeFetch([]);
    expect(await storyboard(req(), story, deps(f, { key: '' }))).toMatchObject({ t: 'storyboard', fallback: 'no key', usd: 0 });
  });
});

const texts = (out: AskEvent[]) => out.filter((e) => e.t === 'text').map((e) => (e as { d: string }).d).join('');
/** Event kinds in order, consecutive repeats merged. */
const order = (out: AskEvent[]) => out.map((e) => e.t).filter((t, i, a) => t !== a[i - 1]);
