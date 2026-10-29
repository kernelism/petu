# Eval brief

Runs the real app in headless Chrome against fixed questions on real PDFs, records every answer
(replayable for free), computes metrics from the engine (not pixels) and has a vision judge score
it. The review artefact is `report.html`, not recordings.

## File map

| Path | What it is |
|---|---|
| `scripts/eval/run.ts` | Runner (`npm run eval -- …`): starts its own Vite on 5186–5195 (`PETU_EVAL_PORTS`), drives Chrome over CDP, records, judges, writes the run dir. Notes test-split uses in `.petu/eval/test-uses.json`. |
| `scripts/eval/plan.ts` | `parseArgs` (flags below), `selectQuestions`, `checkBudget` (preflight vs `/api/spend`), `remainingUsd`. |
| `scripts/eval/configs.ts` | Named model configs (`terra-none` default, `luna-none`, `terra-low`, `terra-medium`, `sol-low`, `sol-medium`, `astra-low`, `terra-none-fast`, `terra-none-verbosity-low`, and the Anthropic authors `claude-opus-low`, `claude-sonnet-none`, `claude-sonnet-low`, `claude-haiku-none`) → server env (`maxOutput` → `PETU_MAX_OUTPUT` for thinking configs); preflight cost assumptions; `expectedAnswerUsd` / `worstAnswerUsd` for the bench. |
| `scripts/eval/draw.ts` | Set `draw` (11 questions, 13 answers: D1/D2 have follow-ups): the board must carry the explanation (inhibitor plots, tax wedge, DWL scaling, confidence intervals, pendulum period, free-body diagrams, residual gradients, two golden-lesson questions). bio p4 and econ p12 are shared on purpose (`SHARED_PAGES_OK`). |
| `scripts/eval/bench.ts`, `benchReport.ts` | `npm run bench -- --qset draw --configs a,b,c [--judge] [--dry] [--replay] [--runs cfg=runId]`: budget preflight (expected and worst case per config from the ledger file, refuses over the phase), then one eval run per config (or reuse), then `.petu/eval/bench/<id>/index.html`: a summary per config (judge, first word p50/p90, spoken mean/p50, cost, gate-beats defect counts) and one row per question turn × one column per config (whole board, 3 key frames, metrics, judge, gate counts, transcript). `--dry` is $0 (recorded runs or fake answers). Phase `bench` ($15) by default. |
| `scripts/eval/questions.ts` | Sets `q1` (checkpoint 2, 24 q) and `q2` (default, 40 q); hashed (`qsetId`, pinned in `tests/eval/questions.test.ts`); `assertSplitAllowed` (held-out test split). |
| `scripts/eval/questions.ts` `FU` | Set `fu` (4 dev follow-up cases: bio p4 + improve the drawing, econ p12 + ELI5, mechanics p6 + a different example, ost-econ p128 + I still don't get it). A follow-up turn's r3 judge sees the previous answer (frames low detail, board, transcript) and `FOLLOW_UP_RUBRIC` (defect `followup_repeats`). `PETU_PHASE=lessondev npm run eval -- --qset fu --split dev`. |
| `scripts/eval/q2.ts` | q2 rows (34 course + 6 on synthetic `econ`/`mechanics` decks), written by an agent that saw only the PDFs; split computed. |
| `scripts/eval/split.ts` | `stratifiedSplit` by deck then scope, seed 670 → 20 dev / 20 test. |
| `scripts/eval/decks.ts` | Deck id → file; course PDFs read in place from `PETU_PDF_DIRS` (default `~/Documents/670/contents`, `public/dev`), never copied; fixtures from `public/fixtures/`. |
| `scripts/eval/judge.ts` | Rubrics: **r3** (default) criteria `understanding, illustration, deck, craft, economy` (1–5), `DEFECTS_R3` (e.g. `board_copies_page`, `board_repeats_narration`, `single_slide`, `drawing_appears_at_once`), `FATALS`; r2 kept for comparison. Builds requests; POSTs to `/api/judge` (never calls OpenAI itself). Judge = `gpt-6.1-sol`, effort low. |
| `scripts/eval/frames.ts` | r3 timeline: a sentence-end still every ~35 spoken words, ≤ 6, plus final state and the whole board (stitched from `[data-petu-board]`); deck digest for the judge. |
| `scripts/eval/scriptTags.ts` | The app parser's view of a recorded answer (`parseAnswer`): per tag the kind it became (`{{scene}}` → sketch, `{{contrast}}` → its copy), a val's `said` text, a find's sources, or rejected; `malformed` = parser rejections + unclosed. Feeds `renderTranscript` (only real failures read `✗ not parsed`) and `computeMetrics` (malformed, skip dependents). Imports `src/`, so `npm run eval` runs with the tsResolve loader. |
| `scripts/eval/metrics.ts` | Pure metrics from `__petu.result()`: first word/mark ms, `spokenMs` (first word → end of the last sentence, apart from the wait and from `totalMs`), cost (`usd` stage 2, `answerUsd` with the scout), cache share, tags, malformed (from the parser, via scriptTags.ts), skipped, elements, leaks, takeaway-first… |
| `scripts/eval/compare.ts` | A vs B verdict: ACCEPT if mean judge Δ ≥ +0.15 and no fatal/skip/malformed/first-word regressions (`THRESHOLDS`); `RERUN n=2` when mixed within ±0.25. Refuses mixed rubrics. |
| `scripts/eval/calibrate.ts` | `dump <runId>` → blind `calibration/hand.html` + `hand.json`; `compare <runId>` → agreement. Trusted at ≥ 80% ±1 agreement and |bias| ≤ 0.5 per criterion on ≥ 8 answers. |
| `scripts/eval/report.ts`, `summary.ts`, `sheet.ts`, `esc.ts` | `report.html`; `summary.json`; r2 contact sheet; escaping. |
| `scripts/eval/cdp.ts` | Raw CDP Chrome (`CHROME` env overrides the macOS path). |
| `scripts/eval/fakeRun.ts`, `sample.ts` | A $0 recorded run from the demo scripts (`npx vite-node …`); seeded page sampler. |
| `src/agent/evalHooks.ts` | In-app side: `window.__petu` (`?eval`), records chunks, events, timings, registry. |
| `tests/eval/*` | Pure tests for all of the above (no browser, no spend). |

## Commands

```bash
PETU_PHASE=iterate npm run eval -- --split dev --config terra-none [--n 2] [--only D4,D11] [--parallel 4]
npm run eval -- --split dev --replay <runId> [--no-judge]       # re-play a recording: $0 generation
npm run eval -- --split dev --replay <runId> --fake-judge       # full judge path, placeholder judgement, $0
npm run eval -- --split dev --finish <runId>                    # redo missing judgements/summary, no generation
npm run eval -- … --webkit                                      # also WebKit stills (playwright-core)
npm run eval -- … --prewarm                                     # focus ask bar, wait 4s, then ask (latency)
npm run eval -- … --qset q1 --rubric r2                         # checkpoint-2 set/rubric
node --experimental-strip-types scripts/eval/compare.ts <runIdA> <runIdB>
node --experimental-strip-types scripts/eval/calibrate.ts dump|compare <runId> [--n 8]
npx vitest run tests/eval
```

Run dir: `.petu/eval/runs/<date>-<config>-<promptVersion>-<qset>[-N]/` (gitignored): per question
`result.json` (recording), `metrics.json`, stills, `judge-request.json`, `judge.json`; run-level
`summary.json`, `run.json`, `report.html`, `calibration/`.

## Phases and the held-out test split

- The runner's phase is `PETU_PHASE` (default `dev`); it starts its server with that phase, so spend
  books against that phase's budget (see `agent-pipeline.md`: dev 1, bakeoff 6, iterate 7, validate 2,
  lessondev 1.5, lessonbake 3, lessoniter 3.5, lessonval 2, bench 15; $60 total).
- Test split: only `validate` / `lessonval` may always run it; `bakeoff` / `lessonbake` once per
  question set (the baseline). Everything else is refused by `assertSplitAllowed`. Iterate on dev only.

## Costs

- Preflight (`checkBudget`) reserves per answer `worstCaseUsd(model, 12k in, 1.5k out)` (~$0.04 on
  terra) and per r3 judgement `worstCaseUsd(sol, 16k in, 800 out)` (~$0.09), and refuses a run that
  doesn't fit the remaining cap. Real answers cost about half a cent (scout + stage 2).
- The server ledger is the real guard: each call is reserved again at its own worst case.
- Replays and `--fake-judge` cost $0 for generation; judging a replay still spends unless `--no-judge`.

## Invariants / contracts

- No API key in scripts; every model call goes through the dev server and its ledger.
- Question sets are frozen by hash: editing a row breaks the pin test on purpose.
- PDFs are read in place; never copy course PDFs into the repo or the run dir.
- Accept a change only on `compare.ts` ACCEPT **and** a hand read of `report.html`. The judge is
  ~0.5 lenient in absolute terms: trust deltas, fatal flags and defects, not levels.
- r3 isn't trusted until calibration passes; report.html says so.

## To change X, touch Y

- New config: `CONFIGS` in `configs.ts` (model must be priced in `server/prices.ts`).
- Rubric wording/criteria: `judge.ts` (`RUBRIC_R3`, `CRITERIA_R3`, `DEFECTS_R3`, schema) → re-judge
  with `--finish`, re-calibrate; comparisons across rubrics are refused.
- Frame selection: `FRAME_OPTS` in `frames.ts`. Metrics: `metrics.ts` (+ `tests/eval/metrics.test.ts`).
- New question set: a new rows file + `QSETS` in `questions.ts` + pin its hash in the test.

## Pitfalls

- `configs.ts` `JUDGE_MAX_OUTPUT` is 800 but the server's judge uses 1600 (`server/openai.ts`), and
  preflight ignores scout calls: preflight underestimates; leave headroom.
- Never point the runner at 5180/5181; it picks 5186–5195 itself and passes its own eval token.
- WebKit stills need `playwright-core` installed; Chrome must exist at `CHROME` or the default path.
- A run of the wrong phase against a shared ledger eats that phase's budget — set `PETU_PHASE` explicitly.
- Don't tune on eval-deck wording; add new deck terms to `EVAL_VOCAB` (`tests/server/prompt.test.ts`).
