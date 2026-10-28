# Agent pipeline brief

One answer = two OpenAI calls joined into one script stream: the **scout** (stage 1) streams an
opener that plays at once plus the pages/plan; **stage 2** (perform) continues from the opener's last
word. All calls go through a Vite-middleware server on localhost, gated by a persistent spend ledger.

## File map

| Path | What it is |
|---|---|
| `server/plugin.ts` | Routes (`/api/ask`, `/api/scout`, `/api/prewarm`, `/api/spend`, `/api/judge`, `/api/dev-pdf/`), `guard` (loopback Host, same Origin, JSON content-type), body validation (`validateAsk/Scout/Context`, `LIMITS`), prewarm dedupe (25 min). |
| `server/openai.ts` | Request builders `buildRequest` (stage 2), `buildScoutRequest`, `buildSystemPrewarm`; `ask`, `scoutStream`, `prewarm*`, `judge`, `callJson`; `openerNote`; token estimate; timeouts `TIMEOUTS` (15s headers / 20s idle / 60s call), `SCOUT_TIMEOUT_MS` 8000. |
| `server/scoutStream.ts` | `ScoutJson` (incremental JSON reader) + `OpenerGate` (whole sentences only; tags limited to `OPENER_TAGS` on the visible page; narration cleaned). |
| `server/env.ts` | The ONLY reader of the key and `PETU_*`. Defaults: `gpt-6.1-terra`, effort none, `DEFAULT_MAX_OUTPUT` 3200, scout max 600. `PHASE_CAPS`, `MAX_TOTAL_USD`. Throws on bad knobs. |
| `server/ledger.ts` | `Ledger`: `reserve` (worst case) → `settle` (real or estimated) / `release`; lockfile; dead-process reservations booked as `recovered`. File `.petu/spend.json`. |
| `server/prices.ts` | `PRICES` per model (in/cached/out/write30m/write12h), `costUsd`, `worstCaseUsd`. A wrong price = a wrong ledger. |
| `server/cacheStats.ts` | What the cache likely holds (`.petu/cache.json`): estimates for aborted calls, `systemFresh` (11.5h). |
| `server/sse.ts`, `scriptFilter.ts`, `lint.ts` | SSE → `ResponseEvents`; strips `<plan>…</plan>` (kept for debug/eval) and markdown/TeX from narration; grammar notes (`TAG_NAMES`). |
| `server/prompt/system.ts` | Stage-2 developer prompt, `PROMPT_VERSION` (p4.6). Sections: identity → teach → no-dup → timing → context → pointing → board → tags → situations → examples. |
| `server/prompt/scout.ts` | `SCOUT_SYSTEM`, `SCOUT_VERSION` (s2.1): opener, ≤ 6 pages, ≤ 80-word plan, JSON order opener→pages→plan. |
| `server/prompt/examples.ts` | Few-shot `EXAMPLES` on invented documents (music notation, shadows, levers…), each executable. |
| `src/agent/protocol.ts` | `AskRequest`, `AskContext`, `AskEvent` (NDJSON), `SpendSummary`, `HARD_STOP_USD` 40. |
| `src/agent/scout.ts` | `ScoutRequest/Result/Event`, `SCOUT_SCHEMA`, `parseScout`, `fallbackScout`, `answerPages`, `imagePages` (≤ 4 images incl. visible). |
| `src/agent/twoStage.ts` | Joins opener stream + stage-2 stream; emits `scout` / `handoff` events; failure after the opener = cut-off, not error. |
| `src/agent/useAgent.ts` | Per-document state: `ContextBuilder`, `History` (≤ 3 turns, narration only), `Prewarm`, spend; `source()` builds the two-stage generator. |
| `src/agent/client.ts` | `askStream` (NDJSON), `scoutLive`, `getSpend`, cap/error lines (`capLine`, `askErrorLine`). |
| `src/agent/prewarm.ts` | Prewarm on ask-bar intent (focus or 3rd char), dedupe 25 min; system block on document open. |
| `src/agent/context/build.ts` | `ContextBuilder`: `digest()`, `visible()`, `build()` (stage 2), `pagePrefix()` (prewarm), `groundPage()` (pdf.js → `PageGround`). |
| `src/agent/context/*` | `textLines` (`t7 436 415–470: …`), `marks` (`#d #s #a #b #i #g #e`, ≤ 60/page), `operatorList`, `format` (listings), `digest` (≤ 48k chars), `search`, `outline`, `image` (JPEG, `MAX_PATCHES`), `ink` (student ink summary + crop). |
| `src/agent/evalHooks.ts` | `?eval` only: `window.__petu` for the runner. |
| `scripts/ground.ts` | `npm run ground -- <pdf> <page…>`: prints exactly what the model sees. No API call. |

## Data flow (one question)

```
Enter → useAgent.source
  ├ ContextBuilder.digest(page,q) + visible(page)      (digest waits ≤ 2.5s for the text index)
  ├ POST /api/scout  → NDJSON: opener… → scout{pages,plan} → end{usd}
  │      opener sentences yield to the player immediately (tags on the visible page only)
  └ on verdict: ContextBuilder.build(page,q,ink,{pages,plan}) → POST /api/ask {context+opener}
         → NDJSON: meta → text… → done{usd,plan,lint} | error   → yielded after the opener
```
Failed/slow scout (8s) → `fallbackScout`: visible page only, no opener, stage 2 alone.

**Storyboard** (spec "Board v2" 5; `PETU_STORYBOARD=1`, off by default): inside `/api/ask`, when an opener
was spoken, `storyboard()` first asks a reasoning model (`PETU_STORYBOARD_MODEL` gpt-6.1-terra,
`PETU_STORYBOARD_EFFORT` low, deadline `PETU_STORYBOARD_TIMEOUT_MS` 12s) with stage 2's grounding plus
the opener, for strict JSON (`src/agent/storyboard.ts`: confusion, example, scene, beats, aha, check;
prompt `server/prompt/storyboard.ts`, `STORYBOARD_VERSION`, cache key `petu-story-<v>`). It emits a
`storyboard` AskEvent before `meta` (?debug row + expandable JSON; `.petu/answers.jsonl` `storyboard`),
is booked as kind `storyboard`, and stage 2 gets a `STORYBOARD` block after the PLAN. Timeout, bad
JSON, upstream error or cap → stage 2 on the scout plan. Esc aborts it (booked as an estimate).

## Request layout and caching (stage 2, `buildRequest`)

1. `developer`: system prompt — breakpoint **12h**.
2. `user`: `docText` (deck digest) — **30m**; `pageText` (visible listing); visible JPEG (detail high) — **30m**.
3. history (≤ 3 Q/A, narration only).
4. volatile tail: `pagesText` (scout pages' listings), `IMAGE of page N` × ≤ 3, `searchText` (v2 only),
   `PLAN (…teaching order…)`, `STUDENT INK`, `QUESTION (…page N)`, then `openerNote(opener)` last.

`prompt_cache_key` = `petu-<PROMPT_VERSION>` shared by **all documents** (scout: `petu-scout-<SCOUT_VERSION>`).
Scout prefix = `SCOUT_SYSTEM`, digest (30m), visible listing with "listing only, no image" (30m) — byte-identical
to what prewarm sends. `PETU_EXPLICIT_CACHE=0` → implicit caching, prewarm off.

## Spend: ledger, phases, caps

- Every call: `reserve(worstCaseUsd)` (all input at the 12h write rate + full max output) → refused
  before sending if a cap would be crossed → `settle` with `costUsd(usage)`; abort/crash → estimate.
- Caps: total ≤ $40 (`PETU_TOTAL_CAP_USD` can only lower it); phase (`PETU_PHASE`, default `founder`):
  dev 1, bakeoff 6, iterate 7, validate 2, founder 21.99, lessondev 1.5, lessonbake 3, lessoniter 3.5,
  lessonval 2 (override one run: `PETU_CAP_<PHASE>=…`); daily $3 in founder phase only (`PETU_DAILY_CAP_USD`).
- Kinds booked: `answer`, `scout`, `storyboard`, `prewarm`, `judge`. `GET /api/spend` shows totals and `blocked`.
- A request whose `phase` ≠ the server's phase is rejected (400).

## Invariants / contracts

- The key never leaves `server/` (never logged; upstream errors scrubbed). Browser never sees it.
- What the model sees is what the locator searches: listings and grounds come from one `PageGround`.
- The opener is spoken verbatim before stage 2; stage 2 must not restate it (`openerNote`).
- Stage 2 retries once only before the first text; scout never retries (falls back).
- One stable system block: no dates, no document names, no per-question selection.

## To change the prompt safely

1. Edit `server/prompt/system.ts` (or `scout.ts`); **bump `PROMPT_VERSION`** (`SCOUT_VERSION`) —
   it is the cache key and is recorded with every eval run.
2. Principles only: no modes, recipes, counts or caps (`prompt.test.ts` greps for them); keep section order.
3. No eval vocabulary: `EVAL_VOCAB` in `tests/server/prompt.test.ts` (course terms + econ/mechanics
   decks). Extend it when a new deck term shows up.
4. Size: `length/3.6` must stay < 6200 and > 1100 tokens (cache minimum).
5. Every `{{tag}}` in the prompt must parse; every grammar piece must appear.
6. Examples: invented domains only; `tests/server/examples.test.ts` parses, resolves, lints each one
   and checks the board never copies page text or narration.
7. Measure on the dev split (see `eval.md`); accept only on `compare.ts` ACCEPT + hand review.

## Tests / commands

```bash
npx vitest run tests/server tests/agent
npm run ground -- public/fixtures/epipolar.pdf 1      # what the model sees
curl -s localhost:<yourport>/api/spend                # never 5180/5181
```

## Pitfalls

- `.env` is off limits; knobs on the command line. `PETU_MODEL` must have a price in `prices.ts`;
  `gpt-6.1-sol` / `gpt-6-astra` reject effort `none` (env refuses to start).
- Changing anything before the 30m breakpoints (digest format, listing format) invalidates every
  cached prefix; scout and answer must keep the digest byte-identical.
- `LIMITS.images` is 3 (others) + the visible image; raising `imagePages` needs both sides.
- `searchText` is a v2 path still wired; v3 sends the digest instead. History (follow-ups) is live:
  ≤ 3 turns to stage 2, the last one (first 600 chars) to the scout as `prior`.
- `?debug` panel shows cost, cache share, scout verdict, handoff gap and skipped actions — use it.
