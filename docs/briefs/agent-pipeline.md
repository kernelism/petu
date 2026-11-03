# Agent pipeline brief

One answer = two OpenAI calls joined into one script stream: the **scout** (stage 1) streams its
pages, an opener that plays at once, and the plan; **stage 2** (perform) continues from the opener's last
word. The answer is spoken on its **home page** from the first word (`moment.ts homePage`): the page in
view when the scout's pages include it (or the student pinned the question to it: pointed, drew, a check
reply, an aside), else the first of the scout's pages, which the stream opens by moving to. All calls go through a Vite-middleware server on localhost, gated by a persistent spend ledger.

## File map

| Path | What it is |
|---|---|
| `server/plugin.ts` | Routes (`/api/ask` (`quality: standard/best` → `server/quality.ts`: Best = claude-opus-5-5 at low, 400 for any other token), `/api/scout`, `/api/prewarm`, `/api/spend`, `/api/judge`, `/api/dev-pdf/`), `guard` (loopback Host, same Origin, JSON content-type), body validation (`validateAsk/Scout/Context`, `LIMITS`), prewarm dedupe (25 min). |
| `server/openai.ts` | Request builders `buildRequest` (stage 2), `buildScoutRequest`, `buildSystemPrewarm`; `ask`, `scoutStream`, `prewarm*`, `judge`, `callJson`; `openerNote`; token estimate; timeouts `TIMEOUTS` (15s headers / 20s idle / 60s call), `SCOUT_TIMEOUT_MS` 8000. |
| `server/repair.ts`, `server/prompt/repair.ts` | Live-gate repairs (`POST /api/repair`, design 2026-10-29 §6): `RepairCache` keeps stage 2's OpenAI-format body per `reqId` (10 min, ≤ 16; filled by `ask` via `Deps.onBody`); a repair resends it unchanged (same cache key and breakpoints) + the released text (assistant) + `repairNote(report)` (user, `REPAIR_VERSION` r1), 450 output tokens, the answer's provider (Anthropic converted by `toAnthropicRequest`). Ledger kind `repair`; `MAX_REPAIRS` 2 per answer (429); 404 unknown reqId, 400 bad body/phase, 402 cap, 503 `PETU_REPAIR=off`; the deadline aborts and books an estimate. `PETU_REPAIR_EFFORT` (default: stage 2's). answers.jsonl gets `{kind:'repair', …}`. Shares `readUpstream` (SSE → filter → lint) with `ask`. |
| `src/agent/repair.ts` | The gate's `RepairFn`s: `makeRepair({reqId, phase})` (NDJSON), `fakeRepair({delayMs, faults, text})` (no network), `recordedRepair(events)` (replays). |
| `server/scoutStream.ts` | `ScoutJson` (incremental JSON reader) + `OpenerGate` (whole sentences only; tags limited to `OPENER_TAGS` on the visible page, none once `anchor(home)` says the answer is spoken elsewhere; a sentence that uses a dropped quote tag as a word is not spoken, like a numeric one (`quoteWords.ts`: a tag is silent); narration cleaned). |
| `server/env.ts` | The ONLY reader of the key and `PETU_*`. Defaults: `gpt-6.1-terra`, effort none, `DEFAULT_MAX_OUTPUT` 3200, scout max 600. `PHASE_CAPS`, `MAX_TOTAL_USD`. Throws on bad knobs. |
| `server/ledger.ts` | `Ledger`: `reserve` (worst case) → `settle` (real or estimated) / `release`; lockfile; dead-process reservations booked as `recovered`. File `.petu/spend.json`. |
| `server/prices.ts` | `PRICES` per model (in/cached/out/write30m/write12h), `costUsd`, `worstCaseUsd`. A wrong price = a wrong ledger. |
| `server/cacheStats.ts` | What the cache likely holds (`.petu/cache.json`): estimates for aborted calls, `systemFresh` (11.5h). |
| `server/anthropic.ts` | Stage 2 on a `claude-*` model (`PETU_MODEL`): the Responses body from `buildRequest` converted block for block to the Messages API (system 12h → `cache_control` 1h; digest, page image, MEMORY 30m → 5m), thinking/effort mapping (`none` = thinking off on Sonnet/Haiku 5.5; Opus 5.5 refuses `none`), SSE → `Upstream` (`AnthropicEvents`), usage → petu `Usage` (`normalizeUsage`), `max_tokens: 0` prewarm. Wired via `endpointOf` / `buildAnswerRequest` in `openai.ts`. Key: `PETU_ANTHROPIC_KEY`, else `ANTHROPIC_API_KEY`, from the `.env` file only (never process.env). Scout, storyboard and judge stay on OpenAI. |
| `server/sse.ts`, `scriptFilter.ts`, `lint.ts` | SSE → `ResponseEvents`; strips `<plan>…</plan>` (kept for debug/eval) and markdown/TeX from narration; grammar notes (`TAG_NAMES`). |
| `server/svgBeats.ts` | The svg answer mode's stream filter (in front of ScriptFilter): plan → `{{svgboard h=}}`, each SVG group → one `{{svg …}}` tag as it closes (board-engine.md "The svg board"). Used by `ask` and repairs when `isSvgMode(promptVariant)`. |
| `server/prompt/system.ts` | Stage-2 developer prompt, `PROMPT_VERSION` p6.2 (p6.2: the narration ends on the takeaway; an optional hidden `<check>…</check>` after the last beat, lifted by `svgBeats.ts` into `done.check`): the svg board format (`SVG_PARTS`, examples `svgExamples.ts`); the p5.7 tag prompt and its variants (`PETU_PROMPT_VARIANT`) were deleted 2026-11-01. |
| `server/prompt/scout.ts` | `SCOUT_SYSTEM`, `SCOUT_VERSION` (s2.10): opener, ≤ 6 pages, ≤ 100-word plan ending with numbered beats and "Scope: narrow|standard|broad" (founder 2026-10-29: length by scope; ~35 spoken words a beat, narrow = two or three beats and the check), JSON order relation→pages→opener→find→plan (s2.10: the pages decide where the opener is spoken). `parseScout` clips a long plan in its prose, never its beats/scope (`clipPlan`). |
| `src/agent/pacing.ts` | The length budget from the plan: `scopeOf`, `planBeats`, `budgetOf(plan, opener)` (2.4 spoken words/s measured; narrow 50 s target / 60 s cap, standard 75/95, broad 120/150, opener words taken off), `budgetNote` (the `BUDGET` line under stage 2's PLAN, `groundingTail`). The live gate gets it via `LiveGate.setBudget` (App `onScout`; `&budget=off` disables): past `capWords − CHECK_WORDS` it closes the answer at the next beat boundary, holds the rest and plays only the last beat that asks a question (gate events `action: 'cut'`). |
| `server/prompt/examples.ts` | Few-shot `EXAMPLES` on invented documents (music notation, a village's coins, a lighthouse beam made to move, a service counter), each executable; every val bound by the engine. |
| `src/agent/protocol.ts` | `AskRequest`, `AskContext`, `AskEvent` (NDJSON), `SpendSummary`, `HARD_STOP_USD` 60. |
| `src/agent/scout.ts` | `ScoutRequest/Result/Event`, `SCOUT_SCHEMA`, `parseScout`, `fallbackScout`, `answerPages`, `imagePages` (≤ 4 images incl. visible). |
| `src/agent/twoStage.ts` | Joins opener stream + stage-2 stream; decides the home (early `pages` event, else the verdict's) and opens with `{{scroll p=home}}` at word 0 when it is not the page asked on; builds stage 2 on the home page; emits `scout` (with `home` when it moved) / `handoff` events; failure after the opener = cut-off, not error. |
| `src/agent/useAgent.ts` | Per-document state: `ContextBuilder`, `History` (≤ 3 turns, narration only), `SessionMemory` (MEMORY block), `Prewarm`, spend; `source()` builds the two-stage generator and records each finished or stopped answer. App passes each conversation's own `history`/`memory` (`AgentAsk`; the ask bar's + starts a conversation with empty ones, a restored one brings its own back). |
| `server/title.ts` | `POST /api/title` (saved questions, layout-ui brief): `{ questions, sections }` → a ≤ 6-word title (`cleanTitle`, src/session/title.ts) from one non-streamed `callJson` on `TITLE_MODEL` gpt-6-luna, effort none, 40 output tokens; ledger kind `title`; `TitleCache` by content (200 cached); 400 bad body/phase, 402 cap, 502 nothing usable, 503 no key. |
| `src/agent/context/memory.ts` | Session record + MEMORY: per answer the question, pages, `relation`, plan, board as data (sections; things with kind/id/label/data/the words drawn on; constants; changes), claims, check question. Append-only; past 8 entries the oldest half rolls to one line each. `RELATIONS`, `REVISIONS`. |
| `src/agent/client.ts` | `askStream` (NDJSON), `scoutLive`, `getSpend`, cap/error lines (`capLine`, `askErrorLine`). |
| `src/agent/prewarm.ts` | Prewarm on ask-bar intent (focus or 3rd char), dedupe 25 min; system block on document open. |
| `src/agent/context/build.ts` | `ContextBuilder`: `digest()`, `visible()`, `build()` (stage 2), `pagePrefix()` (prewarm), `groundPage()` (pdf.js → `PageGround`). |
| `src/agent/context/*` | `textLines` (`t7 436 415–470: …`), `marks` (`#d #s #a #b #i #g #e`, ≤ 60/page), `operatorList`, `format` (listings), `digest` (≤ 48k chars), `search`, `outline`, `image` (JPEG, `MAX_PATCHES`), `ink` (student ink summary + crop). |
| `src/agent/context/charts.ts` | Figure calibration: `chartMarks(paths, lines, aspect)` finds axes (long strokes, ticks, numeric tick labels below/left, least-squares fit, log when the labels are powers/geometric) → `#cN` charts (`PageGround.charts`, listed after the marks as `#c1 chart x,y w×h x "Q" 0–60, y "P" 0–14`); `chartToPage` maps data → page. Skips anything ambiguous. `scripts/corpus/charts.ts` validates (fixtures + corpus sample, `--render` dots on ticks). |
| `src/agent/context/{tiers,docmap,labels,candidates,printed,memory}.ts` | The tiered scout context: the default for documents over 60 pages (`NEW_CTX_MIN_PAGES` in `build.ts`), the old digest at ≤ 60; `?ctx=old|new` (`PETU_CTX=old|new` for evals) forces one for every document. `tiers`: small ≤ 60 pages = digest; medium ≤ 400 = card + map + digest; huge = card + map + the visible section card. `docmap`: every bookmark with page ranges (6k-token cap, deepest level dropped from the back) or detected headings; `printed`: printed-vs-PDF page offset (page labels or running headers on a fixed sample); `labels`: Figure/Table/Example/Appendix/eq. (3.4)/section → page; `candidates`: per question ≤ 8 pages (named labels and printed pages, ±2 neighbours, BM25 top 5) and the scout's `find` resolver; `memory`: the session record and MEMORY block (owned by useAgent, both modes). `ContextBuilder.scout()` returns all of it; the cached blocks never depend on index progress. `npm run ctx-bench` measures it offline. |
| `src/agent/evalHooks.ts` | `?eval` only: `window.__petu` for the runner. |
| `scripts/ground.ts` | `npm run ground -- <pdf> <page…>`: prints exactly what the model sees. No API call. |

## Data flow (one question)

```
Enter → useAgent.source
  ├ ContextBuilder.digest(page,q) + visible(page)      (digest waits ≤ 2.5s for the text index)
  ├ POST /api/scout  → NDJSON: pages → opener… → scout{pages,plan} → end{usd}
  │      home = homePage(page, pages, pinned); if home ≠ page the stream opens with {{scroll p=home}}
  │      opener sentences yield to the player immediately (tags on the visible page only, and only when it is home)
  └ on verdict: ContextBuilder.build(home,q,ink,{pages,plan}) → POST /api/ask {context+opener}
         → NDJSON: meta → text… → done{usd,plan,lint} | error   → yielded after the opener
```
Failed/slow scout (8s) → `fallbackScout`: visible page only, no opener, stage 2 alone.

## Request layout and caching (stage 2, `buildRequest`)

1. `developer`: system prompt — breakpoint **12h**.
2. `user`: `docText` (deck digest) — **30m**; `pageText` (visible listing); visible JPEG (detail high) — **30m**.
3. MEMORY (follow-ups; append-only, 30m breakpoint), then history (≤ 3 Q/A, narration only).
4. volatile tail: `pagesText` (scout pages' listings), `IMAGE of page N` × ≤ 3,
   `PLAN (…teaching order…)`, `RELATION to your previous answer` (follow-ups: `relationNote`; a revision asks for a fresh section and a different representation or level), `STUDENT INK`, `QUESTION (…page N)`, then `openerNote(opener)` last.

`prompt_cache_key` = `petu-<PROMPT_VERSION>` shared by **all documents** (scout: `petu-scout-<SCOUT_VERSION>`).
Scout prefix = `SCOUT_SYSTEM`, digest (30m), visible listing with "listing only, no image" (30m) — byte-identical
to what prewarm sends. New mode: digest-or-map (30m) → section card (30m, huge) → visible listing (30m; a scan or
outlined-math page: its image at detail low instead) → SESSION memory (30m) → tail: CANDIDATES + printed-page note,
previous exchange, question. The scout may name any page and an optional `find` list (s2.3), resolved locally
(labels, then BM25) into extra stage-2 pages before stage 2 is built. Stage 2's `docText` is the map on the huge tier.

## Spend: ledger, phases, caps

- Every call: `reserve(worstCaseUsd)` (all input at the 12h write rate + full max output) → refused
  before sending if a cap would be crossed → `settle` with `costUsd(usage)`; abort/crash → estimate.
- Caps: total ≤ $60 (`PETU_TOTAL_CAP_USD` can only lower it); phase (`PETU_PHASE`, default `founder`):
  dev 1, bakeoff 6, iterate 7, validate 2, founder 21.99, lessondev 1.5, lessonbake 3, lessoniter 3.5,
  lessonval 2, bench 15 (override one run: `PETU_CAP_<PHASE>=…`); daily $3 in founder phase only (`PETU_DAILY_CAP_USD`).
- Kinds booked: `answer`, `scout`, `prewarm`, `judge`, `repair`. `GET /api/spend` shows totals, `blocked` and `best` (whether Best can run).
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
4. Size: `length/3.6` must stay < 8300 (raised from 8100 for the slide-as-canvas grammar, p5.4) and > 1100 tokens (cache minimum).
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
- Follow-ups: the scout's JSON starts with `relation` (continue / revise-representation / simplify / new-example / deeper / new-topic, s2.4); the desk continues a scene by its id (`Desk.addRegion`): a follow-up that reuses the scene's id draws on into it, a revision's new id starts a fresh section below (the old scene stays, untouched).
- History (follow-ups) is live:
  ≤ 3 turns to stage 2, the last one (first 600 chars) to the scout as `prior`.
- `?debug` panel shows cost, cache share, scout verdict, handoff gap and skipped actions — use it.
