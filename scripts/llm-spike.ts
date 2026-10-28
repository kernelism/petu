/**
 * Feasibility spike (not checkpoint 2): can a small OpenAI model write a playable tutor script in
 * one streamed pass? Sends the grammar + rules + two hand-written scripts (stable, cacheable
 * prefix), then pages 38–42 of lec09 as text runs with positions and one image of page 40, then
 * the question. Streams each answer, records TTFT / first-tag time / usage / cost, and writes
 * public/dev/llm/q<N>.txt (first line: the question) for `?scriptfile=q<N>`.
 *
 *   node --env-file=.env scripts/llm-spike.ts [questionNumbers, e.g. 1,3]
 *   env: SPIKE_PROMPT (v1|v2), SPIKE_MODEL, SPIKE_EFFORT (default none), SPIKE_SUFFIX (output name suffix), SPIKE_DRY=1
 *
 * The key is read from the environment at runtime only. Hard spend cap below; stops before it.
 * public/dev/ is gitignored (the user's course PDF and everything derived from it stays local).
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { itemsToRuns } from '../src/pdf/textRuns.ts';
import { SCRIPTS } from '../src/demo/scripts.ts';
import { DEMO_SIDE_QUESTION, DEMO_SIDE_SCRIPT } from '../src/demo/demoScript.ts';

const MODEL = process.env.SPIKE_MODEL ?? 'gpt-6-luna';
const EFFORT = process.env.SPIKE_EFFORT ?? 'none';
// USD per 1M tokens, standard tier (developers.openai.com/api/docs/pricing, checked 2026-10-28).
const PRICES: Record<string, { in: number; cached: number; out: number }> = {
  'gpt-6-luna': { in: 0.10, cached: 0.01, out: 0.50 },
  'gpt-5.4-mini': { in: 0.75, cached: 0.075, out: 4.50 },
};
const CAP_USD = 0.50;
const SUFFIX = process.env.SPIKE_SUFFIX ?? ''; // e.g. -low: keeps variant runs side by side
const MAX_OUT = 900;
const PDF = 'public/dev/lec09_optical_flow.pdf';
const PAGE = 40, FROM = 38, TO = 42;
const OUT = 'public/dev/llm';
const LEDGER = `${OUT}/spend.json`; // running total across runs

const QUESTIONS = [
  'Why does disparity get smaller when the point is farther away?',
  'What is the baseline B in this picture?',
  'Point me to x − x′ in the figure.',
  'Show me what happens if the object moves twice as far.',
  'How does this connect to the "Optical flow!" box?',
  // Round 2 (harder; 6–10)
  'If I double the baseline B, what happens to the disparity of the same point? Show me.',
  "Why can't we get depth from a single camera here?",
  'Where would a point at infinite depth land in both images?',
  'Derive x − x′ = B·f/z from the similar triangles in this figure.',
  "What goes wrong if the two image planes aren't parallel?",
];

const RULES_V1 = `DRAWING ACCURACY. Prefer text anchors ("quote" near=x,y), then marks you can see in the figure, then raw coordinates. A misplaced drawing is worse than none. Use the slide's own figure when it already shows the thing; sketch beside the page only for something the slide doesn't show.

EXPLANATION QUALITY. One idea per answer. Takeaway first. At most one new element per sentence, labelled as it is drawn. Reuse the slide's own notation and figures. About 6 drawn elements max. Accent (em) only for the takeaway. End on a payoff. Diagrams build up with the narration — never appear finished.

`;
const RULES_V2 = `RULES (hard).
1. The first sentence is the takeaway. Short spoken sentences (≤ 15 words). Say math aloud ("x minus x-prime"); never write TeX or symbols in narration.
2. Every idea gets at least one drawn element; at most one NEW element per sentence, labelled as it is drawn. About 6 elements max. Accent (em) only on the takeaway element. End on a payoff sentence.
3. On the page, prefer text anchors ("quote" near=x,y) over raw coordinates. Quotes must match one text run or adjacent runs on one line. Equation glyphs are listed one per run and do not read in order: never quote an equation; box or circle it with at= built from its glyph centres (pad ~10 units).
4. To trace something the slide already draws (a segment, a ray), use a line between the two marks measured from the image, weight=secondary, or circle the marks' labels.
5. Geometry or what-if questions: open a sketch region and build the diagram there, step by step. At most 2 regions.

SKETCH GEOMETRY.
- Never leave floating points: every point is joined to what it relates to (a ray from the camera through the image point to the scene point; the image plane as a line through the image points).
- Keep it consistent with the narration and with this layout: cameras on a baseline near y=620; image planes a line at y=520; depth goes UP the region, so a farther point has a SMALLER y.
- Compute image points, don't guess: the image point is where the ray camera→scene point crosses the image line. Worked check: camera O (300,620), X (500,220), image line y=520: t = (620−520)/(620−220) = 0.25, x = 300 + 0.25·(500−300) = 350 → (350,520). For 2× the depth from y=620, X moves to y = 620 − 2·400 = −180 (off-region): scale everything so both fit.
- Visual language: main geometry primary (default); rays weight=secondary; sight lines and construction dash (faint); image planes as lines or {{shade … outline}}; a {{connect}} from the slide's mark to the sketch's matching element when the sketch redraws the slide.

`;
const PROMPT = process.env.SPIKE_PROMPT ?? 'v1';
const RULES = PROMPT === 'v2' ? RULES_V2 : RULES_V1;
const SYSTEM = `You are a tutor that answers a student's question about a PDF by performing on it: you narrate, and inline action tags scroll the page, highlight its text and draw, on the page or on a sketch region beside it. Output ONE script: plain spoken narration with {{tags}} inline. No markdown, no lists, no headings, no code fences, nothing before or after the script.

TIMING. A tag fires on the first word after it, so put each tag immediately before the word it belongs to. Start with {{scroll p=N}} for the page you talk about. 60–140 words of narration.

COORDINATES.
- On a page (p=N): x 0–1000 left→right across the page width, y 0–1000 top→bottom down its height (both normalised; a 16:9 slide is still 1000×1000 units).
- In a sketch region (on=<id>): x 0–1000, y 0–700, top-left origin.
- Text runs are given as "text" @cx,cy (the run's centre in page units). Measure figure marks from the page image: page x = px / imageWidth × 1000, page y = py / imageHeight × 1000.

TAGS (args are key=value, quoted text is "…", bare words are flags):
{{scroll p=N}}  {{scroll p=N y=Y}}
{{highlight p=N "exact quote" near=x,y}}  {{underline p=N "quote" near=x,y}}  — quote must match the page text exactly (a whole run or words inside one); near disambiguates repeats.
{{circle p=N "quote" near=x,y}} or {{circle p=N at=x,y r=R}} / rx=,ry=   (radii in x units)
{{box p=N "quote"}} or {{box p=N at=x,y size=w,h}}  (at = top-left)
{{line p=N from=x,y to=x,y}}  {{arrow p=N from=x,y to=x,y}}  flags: dash · weight=primary|secondary|faint
{{curve on=R pts=x,y x,y x,y}}  {{shade on=R pts=x,y x,y x,y}} or at=x,y rx=,ry=  flags: outline, em
{{point on=R at=x,y "label" dir=n|ne|e|se|s|sw|w|nw}}  (dot + optional label)
{{label p=N at=x,y "text"}}  or attach to an element: {{label id=ID "text" dir=s}}
{{angle on=R at=vertex from=x,y to=x,y "θ"}}  {{brace on=R from=x,y to=x,y "text"}} (tip points left of from→to)
Region only: {{write on=R at=x,y "text" size=s|m|l}} (at = left edge, vertical middle)  {{math on=R at=x,y "TeX" size=s|m|l}}
  {{axes on=R at=x,y size=w,h x="label" y="label" id=ax}} (at = origin, bottom-left)  {{plot on=R fn="1/x" domain=a,b range=c,d}}
{{sketch id=R near=pN size=s|m|l}}  — opens a region beside page N (l = full-screen stage). At most 2 regions per answer.
{{connect from=pN:"quote" to=R:elementId}} or from=pN:x,y — joins a page spot to a region element.
{{emph id=ID}} {{move id=ID to=x,y}} {{fade id=ID}} — act on an element drawn earlier with id=ID (ids: a letter then letters/digits/-/_; unique).
Any drawn element takes id=ID and the flag em (accent colour). Malformed tags and quotes that don't match the page are skipped.

${RULES}EXAMPLE 1 (page 40 of this deck; question: "${SCRIPTS.lec09.question}")
${SCRIPTS.lec09.script}

EXAMPLE 2 (a different deck, page 3 shows two cameras C, C′ and images 1, 2; question: "${DEMO_SIDE_QUESTION}")
${DEMO_SIDE_SCRIPT}`;

async function pageTexts(): Promise<string> {
  const doc = await pdfjs.getDocument({ data: new Uint8Array(readFileSync(PDF)), verbosity: 0 }).promise;
  const out: string[] = [];
  for (let n = FROM; n <= Math.min(TO, doc.numPages); n++) {
    const page = await doc.getPage(n);
    const vp = page.getViewport({ scale: 1 });
    const tc = await page.getTextContent();
    const runs = itemsToRuns(tc.items as never, vp.transform, vp.width, vp.height);
    out.push(`--- page ${n}${n === PAGE ? ' (visible; image attached)' : ''} ---\n` + runs
      .map((r) => `"${r.text}" @${Math.round(r.rect.x + r.rect.w / 2)},${Math.round(r.rect.y + r.rect.h / 2)}`).join('\n'));
  }
  return out.join('\n');
}

type Usage = { input_tokens: number; output_tokens: number; input_tokens_details?: { cached_tokens?: number }; output_tokens_details?: { reasoning_tokens?: number } };
const cost = (u: Usage) => {
  const p = PRICES[MODEL];
  const cached = u.input_tokens_details?.cached_tokens ?? 0;
  return ((u.input_tokens - cached) * p.in + cached * p.cached + u.output_tokens * p.out) / 1e6;
};

async function ask(n: number, docText: string, image: string, spent: number) {
  const q = QUESTIONS[n - 1];
  const p = PRICES[MODEL];
  // Worst case before sending: ~4 chars/token for text, ~1.6k for the image, full output budget.
  const worst = (((SYSTEM.length + docText.length) / 3 + 1600) * p.in + MAX_OUT * p.out) / 1e6;
  if (spent + worst > CAP_USD) throw new Error(`cap: spent $${spent.toFixed(4)} + worst $${worst.toFixed(4)} > $${CAP_USD}`);
  const body = {
    model: MODEL, stream: true, max_output_tokens: MAX_OUT, reasoning: { effort: EFFORT },
    prompt_cache_key: 'petu-spike-lec09-p40',
    instructions: SYSTEM,
    input: [{
      role: 'user',
      content: [
        { type: 'input_text', text: `DOCUMENT: lec09_optical_flow.pdf. The student is looking at page ${PAGE}. Text runs, pages ${FROM}–${TO}:\n${docText}\n\nImage of page ${PAGE} (1024×576):` },
        { type: 'input_image', image_url: `data:image/jpeg;base64,${image}`, detail: 'high' },
        { type: 'input_text', text: `QUESTION: ${q}` },
      ],
    }],
  };
  const t0 = performance.now();
  let res: Response | undefined;
  for (let attempt = 0; attempt < 2; attempt++) { // one retry, on a network error only
    try {
      res = await fetch('https://api.openai.com/v1/responses', {
        method: 'POST',
        headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      break;
    } catch (e) { if (attempt) throw e; }
  }
  if (!res!.ok) throw new Error(`HTTP ${res!.status}: ${(await res!.text()).slice(0, 400)}`);
  // Newer models may stream a `commentary`-phase message before the `final_answer` one, often with
  // the same script. Only non-commentary text is the script; commentary is kept for the record.
  const phase: Record<string, string> = {}, perItem: Record<string, number> = {};
  let text = '', commentary = '', buf = '', ttftAny = NaN, ttft = NaN, firstTag = NaN, usage: Usage | undefined, status = '';
  const dec = new TextDecoder();
  for await (const chunk of res!.body as unknown as AsyncIterable<Uint8Array>) {
    buf += dec.decode(chunk, { stream: true });
    let i;
    while ((i = buf.indexOf('\n\n')) >= 0) {
      const ev = buf.slice(0, i); buf = buf.slice(i + 2);
      const data = ev.split('\n').find((l) => l.startsWith('data: '))?.slice(6);
      if (!data || data === '[DONE]') continue;
      const j = JSON.parse(data);
      if (j.type === 'response.output_item.added' && j.item?.id) phase[j.item.id] = j.item.phase ?? 'none';
      if (j.type === 'response.output_text.delta') {
        const now = performance.now() - t0;
        perItem[`${phase[j.item_id]}:${j.item_id.slice(-6)}`] = (perItem[`${phase[j.item_id]}:${j.item_id.slice(-6)}`] ?? 0) + j.delta.length;
        if (Number.isNaN(ttftAny)) ttftAny = now;
        if (phase[j.item_id] === 'commentary') { commentary += j.delta; continue; }
        if (Number.isNaN(ttft)) ttft = now;
        text += j.delta;
        if (Number.isNaN(firstTag) && text.includes('{{')) firstTag = now;
      } else if (j.type === 'response.completed' || j.type === 'response.incomplete') {
        usage = j.response.usage; status = j.response.status + (j.response.incomplete_details ? ` (${j.response.incomplete_details.reason})` : '');
      } else if (j.type === 'error' || j.type === 'response.failed') throw new Error(data.slice(0, 400));
    }
  }
  const total = performance.now() - t0;
  const c = usage ? cost(usage) : worst;
  if (!text.trim() && commentary) text = commentary; // no final phase: the commentary is the answer
  writeFileSync(`${OUT}/q${n}${SUFFIX}.txt`, `${q}\n${text.trim()}\n`);
  if (commentary) writeFileSync(`${OUT}/q${n}${SUFFIX}.commentary.txt`, commentary);
  return { n, q, model: MODEL, effort: EFFORT, prompt: PROMPT, status, ttftAnyMs: Math.round(ttftAny), ttftMs: Math.round(ttft), firstTagMs: Math.round(firstTag), totalMs: Math.round(total), usage, costUsd: c, perItem, tags: (text.match(/\{\{/g) ?? []).length };
}

const pick = (process.argv[2] ?? '1,2,3,4,5').split(',').map(Number);
mkdirSync(OUT, { recursive: true });
const ledger = existsSync(LEDGER) ? JSON.parse(readFileSync(LEDGER, 'utf8')) : { totalUsd: 0, runs: [] as unknown[] };
const docText = await pageTexts();
const image = readFileSync(`${OUT}/p${PAGE}.jpg`).toString('base64');
if (process.env.SPIKE_DRY) { console.log(SYSTEM, '\n=====\n', docText, '\nchars', SYSTEM.length, docText.length); process.exit(0); }
for (const n of pick) {
  const r = await ask(n, docText, image, ledger.totalUsd);
  ledger.totalUsd += r.costUsd;
  ledger.runs.push(r);
  writeFileSync(LEDGER, JSON.stringify(ledger, null, 2));
  console.log(`q${n} ${r.status} ttft(any) ${r.ttftAnyMs}ms ttft(final) ${r.ttftMs}ms firstTag ${r.firstTagMs}ms total ${r.totalMs}ms in ${r.usage?.input_tokens} (cached ${r.usage?.input_tokens_details?.cached_tokens ?? 0}) out ${r.usage?.output_tokens} (reasoning ${r.usage?.output_tokens_details?.reasoning_tokens ?? 0}) $${r.costUsd.toFixed(5)} · running $${ledger.totalUsd.toFixed(5)}`);
}
