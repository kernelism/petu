# AGENTS.md — petu (PDF tutor)

> **New here?** Read [docs/briefs/README.md](docs/briefs/README.md), then the brief for the area you're changing.
> Briefs: [board-engine](docs/briefs/board-engine.md) · [agent-pipeline](docs/briefs/agent-pipeline.md) ·
> [layout-ui](docs/briefs/layout-ui.md) · [eval](docs/briefs/eval.md). Code wins over any doc.

Core context for anyone (human or agent) working in this repo. Read this first.

## What it is

A web app where a student opens a PDF and asks questions about it. The tutor answers by
*performing* on the document: it scrolls to the right page, highlights text in sync with its
narration, and draws to explain — on the page itself, or on a board that opens beside the slides
(slides pinned left, board right; stacked in a narrow window). The student can draw too.

Narration is shown as paced captions today. The same word timeline will later be driven by TTS.

**Priorities, in order:** UX above everything, then latency, then timing. Keep scope small and do
each piece well. Build only what is asked.

## Stack and commands

React 18 + Vite 6 + TypeScript, pdf.js (`pdfjs-dist`), KaTeX (pinned, lazy-loaded), Vitest + jsdom.

```bash
npm install
npm run dev          # vite dev server
npm test             # vitest run
npm run typecheck    # tsc --noEmit
npm run build        # typecheck + vite build
npm run fixture      # regenerate public/fixtures/epipolar.pdf
npm run decks        # regenerate the synthetic eval decks public/fixtures/{econ,mechanics}.pdf
```

Every change ends green on `npx tsc --noEmit && npx vitest run && npm run build`.

**Before merging, run `npm run gate`** (instead of hand-written screenshot scripts): typecheck,
tests and build in parallel, then the gallery diff, then `replay-stress` when that script exists
(its skip rate must not rise vs the last value recorded by a passing gate). Pass/fail summary, non-zero
exit on failure, no API calls. Declare intended visual changes: `npm run gate -- --expect side,kit@end`
(a scene, `scene@moment`, `scene@moment.browser`, or `*` wildcards); review them in the contact sheet.

```bash
npm run gallery                      # stills of every demo/script, Chromium + WebKit, 1440×900 + 2560×1440, diffed vs the baseline
npm run gallery -- --baseline        # make this run the baseline (do it on main)
npm run gallery -- --only side,kit --browsers webkit --sizes 1440x900
```

The gallery (`scripts/gallery/`) starts its own dev server on a free port and drives Playwright
(`playwright-core` looked up as the eval does; `PLAYWRIGHT_DIR` overrides, Chromium = system Chrome)
on a fake clock: time advances in 200ms steps and stands still while real-time work runs (fetches,
the pdf.js worker, CSS transitions, smooth scrolls), so a moment (`scenes.ts`: ms after the answer
starts, or after it ends) is the same frame every run. Runs land in `<main checkout>/.petu/gallery/<run>/`
(shared by all worktrees; `PETU_GALLERY_DIR` overrides) with `index.html`: changed shots first,
baseline | current | diff side by side. A shot changes when > 0.05% of its pixels (and > 100) differ
after antialiasing tolerance. Mid-answer moments can jitter by a few hundred pixels; end states are exact.

Agent and eval tools:

```bash
npm run ground -- <pdf> <page…>   # prints exactly what the model sees for those pages (lines + marks)
npm run eval -- --split dev --config terra-none [--n 2] [--only D4,D11] [--replay <runId>] [--no-judge] [--webkit] [--prewarm]
npm run eval -- --split dev --finish <runId>    # re-do a run's missing judgements/summary, no generation
npm run eval -- --ask "<deck>:<page>:<question>" --no-judge   # one ad-hoc question (reproduce a founder report)
node --experimental-strip-types scripts/eval/compare.ts <runIdA> <runIdB>   # judge deltas + verdict
npm run eval -- … --qset q1 --rubric r2       # checkpoint-2 set / rubric (defaults: q2, r3)
npm run eval -- … --replay <runId> --fake-judge   # offline: full judge path with a placeholder judgement, $0
node --experimental-strip-types scripts/eval/calibrate.ts dump|compare <runId> [--n 8]   # hand-vs-judge
```

**Bug reports**: the founder presses Report (top bar flag, Shift+R; dev server only). Each one is
`.petu/reports/<stamp>-<slug>/{report.json,screenshot.png}` (`src/report/`, `server/report.ts`,
`POST /api/report` behind `guard`); read them with `npm run reports` (list) and `npm run reports -- <id>|last`
(digest: scout, stage-2 script, every action with timing and skip reason, board sections).

**Eval v3** (`scripts/eval/`): question set **q2** (`q2.ts`, 40 questions written by an agent that
saw only the PDFs: 34 course + 6 on the synthetic decks, 20 dev / 20 test stratified by deck) and
rubric **r3** (`judge.ts`: understanding, illustration, deck, craft, economy, plus defect flags such
as `board_copies_page`, `board_repeats_narration`, `single_slide`). r3 judges a timeline of frames
(`frames.ts`: a sentence-end still every ~35 spoken words, ≤ 6, plus the settled final state and the
whole board, stitched from the element marked `data-petu-board`), a deck digest and the transcript.
r3 is not trusted until `calibrate.ts` shows ≥ 80% ±1 agreement and |bias| ≤ 0.5 on 8 hand-scored
answers. **Calibrated 2026-10-28** (8 dev answers of terra-none p4.7, scored blind by an independent
agent): the first r3 ran +0.75 lenient on craft and economy (±1 93%); with concrete craft/economy
anchors and an `Engine:` line listing skipped actions (defect `skipped_actions`) it is trusted:
±1 95%, exact 65%, bias understanding +0.00, illustration +0.38, deck +0.13, craft +0.25, economy
+0.50. Fatal flags did not agree (judge 1, hand 1, overlap 0): read fatals by hand.
Skips are a first-class metric: per answer `skipped`, `malformed`, `skippedDeps` (a skipped action
later tags name) and `skipDefect` (> 2, or any dependency); the run prints them with first-word
p50/p90. The budget preflight counts the scout too (`server/limits.ts` holds the shared output caps).

Eval runs start their own dev server on ports 5186–5195 (never 5180, the default `npm run dev`
port) and write everything to `.petu/eval/runs/<date>-<config>-<prompt>-<qset>/` (gitignored):
`result.json` recordings (replayable for free), metrics, judge notes and `report.html`, the review
artefact (frame timeline, transcript, metrics, per-criterion scores, calibration). The test split is
held out: only `PETU_PHASE=validate`/`lessonval` may run it (plus one baseline in `bakeoff`/`lessonbake`,
counted per question set).

Dev URLs (append to the dev server URL):
- `?demo=1` — PDF-only demo on the fixture
- `?demo=side` — a sketch on the board (normal split, 1:1), connected to the slide
- `?demo=plane` — a `size=l` sketch: the wide split (slides 0.4, board 0.6)
- `?script=kit` — the visual kit: six board sections (a sliding window, vectors as bars, a scatter
  with a band, a demand table, a thrown ball's table, dice), half outside CS, all numbers engine-computed
- `?script=canvas` — the slide as canvas (`public/fixtures/canvas.pdf`): drawing on a slide's calibrated
  chart in its data units (`p=N on=#c1`), lifting its figure onto the board (`{{lift}}`), notes in place
  (`{{note p=N … annotate=}}`); see docs/briefs/board-engine.md
- `?script=learner` — the v1 learner UX as one simulated session (ask, aside, resume, follow-up,
  circle + "about:" chip, check reply judged on the board, trail + zoom + shortcuts); src/demo/learner.ts
- `?script=lec09`, `?script=toolkit`, `?script=relational` — dev scripts, no API call (lec09 needs a
  local, gitignored PDF; relational shows the `let`/construction grammar on the fixture)
- `?src=<pdf url>` — open a PDF by URL (e.g. `/api/dev-pdf/<name>.pdf` from `PETU_PDF_DIRS`)
- `&page=N` (with `&eval`) · `&debug` latency/cost/plan panel · `&noplay` no autoplay · `&style=hand|clean`
- `&eval` installs `window.__petu` (eval hooks) · `&nogen` replay only · `&fail=N` cut the stream after N chunks

## How it works

The tutor emits **one streamed script**: plain narration with inline action tags.

```
Take this point x {{circle p=3 "x" near=316,454}} in the left image.
{{sketch id=side near=p3 size=m}} From the side, {{point on=side at=300,570 "C"}} camera C ...
```

Pipeline:

1. `src/script/` — incremental tokenizer + parser (tags may split across chunks; malformed tags
   are skipped). `types.ts` holds the `Action` union.
2. `src/playback/` — `clock` (paced narration, TTS-ready interface), `scheduler` (fires each
   action at its word, with per-kind lead), `director` (one serial layout lane + concurrent ink
   lanes, backlog compression, timeouts), `session`.
3. `src/desk/` — the split layout (spec "Lessons v3" L): `layout.ts` derives the reading / split /
   stacked frame from the window (margin = gutter = clamp(16px, 2.5vw, 40px)); `Desk.ts` owns the
   board (sections appended top to bottom, uniformly scaled, text at the slide's measured body size,
   persisting across answers until × / Esc), connectors in an overlay above slides and board,
   follow mode, element registry
   (`id=`, `emph`, `move`, `fade`), toolkit elements (`expr` safe parser — no eval, `plot`,
   `math`, `nudge`).
4. `src/ink/agent/` — stroke geometry and human-like pen motion (live / hand / clean styles).
   `src/ink/student/` — freehand student ink.
5. `src/pdf/` — viewer, virtualized page slots, text runs, scroll ownership, content mask.
   `src/locate/` — quote → rects on the text layer.
6. `src/ui/` — ask bar, caption (sentence-windowed), toolbar, follow pill, top bar.
7. `src/geometry/` — `resolve.ts` turns names, marks and constructions into plain actions just
   before the toolkit builds them; `figure.ts` fits a `fit` sketch's world coords to its region.

### The agent (checkpoint 2)

**The model names meaning; the engine computes geometry.** One streamed pass, no tool calls.

```
browser (src/agent/)                         dev server (server/, Vite plugin, localhost only)
context/build ─ page lines + marks + JPEG ─► POST /api/ask ─► OpenAI Responses API (SSE)
useAgent / client ◄──── NDJSON AskEvents ─── first message only → <plan> strip → narration clean → lint
   └► parser → resolver → director → ink      ledger: reserve worst case, book usage (.petu/spend.json)
```

- `src/agent/context/` — **grounding**. pdf.js text runs become text lines (`t7 436 415–470: …`,
  equations tagged `math`); the operator list becomes figure marks (`#d` dots, `#s` segments with
  dot topology `#s3 line #d1→#d3`, `#a` arrows, `#b` boxes, `#i` images, `#g` figures, `#e`
  equations; ≤ 60 per page). The scout gets the deck digest (every page, trimmed; `digest.ts`) and
  the visible page's listing. Stage 2 gets the same digest, the visible page (listing + JPEG), the
  scout's pages (listings, up to 4 images in all with the visible page) and plan, student ink and
  earlier narration (p±2 are only warmed ahead; `searchText` is a v2 leftover). **What the model sees is
  what the locator searches**: quotes resolve against the same line index. `npm run ground` prints
  it.
- `src/agent/{client,useAgent,prewarm,history}.ts` — NDJSON client, cut-off handling (plays what
  arrived), prewarm on ask-bar intent, follow-up history (narration only). `evalHooks.ts` is
  dev-only (`?eval`).
- **Two stages, one stream** (`src/agent/twoStage.ts`, `server/scoutStream.ts`): `/api/scout` streams
  the scout's JSON `{opener, pages, plan}` as NDJSON. The opener (the answer's first sentence or two,
  tags on the visible page only, released clause by clause) plays at once; the moment pages and plan
  are parsed, stage 2 is built and asked with the opener verbatim (`context.opener`, ALREADY SPOKEN)
  and its script follows the opener's last word; the note tells it never to restate the opener's claim and to open on something new (the mechanism, the first drawn step). A failed scout, or no verdict within 8s (`SCOUT_TIMEOUT_MS`), = stage 2 alone on the visible page.
  The dock shows a faint static "…" while thinking and after the last word if the stream pauses.
  `?debug` shows scout verdict, opener, stage-2 first text and the handoff gap.
- Every answer leaves a local record in `.petu/answers.jsonl` (question, page, the script as sent,
  lint notes). Server lint runs the client parser over each completed tag: a malformed tag is noted
  with its raw text; a hand-placed curve (≥ 4 points) and a drawing made twice are noted too
  (`done.lint`, shown in `?debug`).
- `server/` — `plugin.ts` (routes: `/api/ask`, `/api/scout`, `/api/prewarm`, `/api/spend`, `/api/judge` (eval
  token), `/api/report`, `/api/dev-pdf/`), `env.ts` (the only reader of the key and `PETU_*` knobs), `openai.ts`
  (request builder: explicit cache breakpoints after the system prompt (12h) and the page block
  (30m), `prompt_cache_key` = `petu-<PROMPT_VERSION>` shared by every document (scout:
  `petu-scout-<SCOUT_VERSION>`); one retry before the first text), `sse.ts`,
  `scriptFilter.ts` (strips the private `<plan>` and markdown/TeX from narration), `lint.ts`,
  `ledger.ts`, `prices.ts`, `prompt/{system,examples}.ts`. Every `/api/*` request must come from the
  app: a loopback Host, an Origin (if any) equal to it, and `content-type: application/json` on POSTs
  (`guard` in `plugin.ts`; these routes run before Vite's own host check). Upstream calls time out
  (15s to headers, 20s between chunks, 60s for prewarm/judge).
- **Prompt** `server/prompt/system.ts`, `PROMPT_VERSION` **p4.9**: a brief, not a rulebook —
  identity → how to teach (answer first, walk the pages, show the mechanism on one growing figure) →
  the board never duplicates → timing → context → pointing → board (WORKED NUMBERS: one worked case,
  then the picture at scale; FORMULAS: anything that follows from a formula is drawn by the engine
  from named constants on shared axes, every curve labelled, reuse by id; name readouts by their
  quantity) → tags → situations → examples. No modes, no per-question-type recipes, no length or
  element caps (the test fails on them). Few-shot examples (`prompt/examples.ts`) are invented
  documents in other domains (music notation, shadows, levers), each executable
  (`tests/server/examples.test.ts`). Bump `PROMPT_VERSION` on any change. `tests/server/prompt.test.ts`
  keeps every tag parseable, the size bounded and eval-deck vocabulary out. The scout's prompt is
  `prompt/scout.ts` (`SCOUT_VERSION` s2.2: a relationship between quantities is shown across its
  range, computed).
- **Model**: `gpt-6.1-terra`, `reasoning.effort: none`, Standard tier (P1 bake-off, the only config
  under the latency gate). Override per run with `PETU_MODEL` / `PETU_EFFORT`.

**Relational geometry grammar** (parser `src/script/`, resolver `src/geometry/resolve.ts`):
- Page marks as targets and points: `{{circle p=4 mark=#d3}}`, `{{line p=4 mark=#s3}}`,
  `{{arrow p=4 from=#d1 to=#d3}}`, `at=#s3.a` / `#s3.b` (segment ends), `{{shade p=4 pts=#d1 #d3 #s2.b outline}}`.
- Fitted sketches: `{{sketch id=s near=p4 fit}}` takes any world coords (y down); one uniform
  scale freezes at the region's first build.
- Names: `{{let on=s O=0,0 X=200,-300 M=mid(O,X)}}`, then `from=O to=M`. Constructions `mid(A,B)`,
  `along(A,B,t)`, `meet(A,B,C,D)`, `foot(P,A,B)` nest; rays `through=` run to the frame (on a page:
  1.5×|AB|, or `len=`). Names are case-sensitive, `'` → `′`; region ids stay lowercase.
- **Skip, never guess**: an unknown name or mark, parallel `meet`, a cycle or an out-of-range page
  skips that action with a reason (visible in `?debug` and the eval). A bad or doubled `let` name
  drops only that name.

Action kinds: `scroll highlight underline circle box line arrow curve point label write math
shade angle brace axes plot sketch connect emph move fade clear`, plus the visual kit's.

**Visual kit v1** (`src/desk/kit/`, parser `src/script/parseKit.ts`; spec "Visual kit v1"). The model
names data and operations; the engine lays blocks out from the board's type size, computes every
number and animates.
- Blocks (in a sketch, no `fit`/`let`): `grid` (matrix/table of cells, `shade`, `rows=`/`cols=` labels;
  `view=image` — implied past 12×12, up to 48×48 — draws shaded pixels with no numerals),
  `bars` (a vector; `view=line` — implied past 16 values — a curve on ticked axes, `axes=v` overlays
  onto line/plot v's axes), `table` (headers + rows; empty columns filled by `col`), `scatter` (literal points
  or a table's columns), `calc` (a live calculation line: expansion and result), `fit` (least squares
  or `pick=i,j`). Placement `right=`/`below=` another block (bodies aligned, engine spacing; wraps at
  the margin; `below` clears whatever sits under the anchor) with an `op=` glyph (⊛ · × = → − + ÷);
  a computed block `right=` (`below=`) its own source gets → (↓) unless `op=` says otherwise (`op=none`). A grid or
  bars without a caption is captioned with its id (a single letter in math italic). A section's kit
  composition is centred in the board (the whole group shifts; the first placement at once, later
  ones glide).
- Computed sources: `map=`/`zip=` (any block with values, or a table column `t.c` — by letter or by
  header, `t.price`) with `fn=` (expr.ts: variables, comparisons also inside parentheses,
  min/max/mean/sum(a,b,…), trig, rad/deg, round; x, y, mean sum std norm min max n), `size=RxC fn=`
  with seeded `rand()`/`randn()` (per block id: replays are identical), `over=G slide=K` (sum of products; `same`, `flip`, `stride`),
  `win=RxC reduce=…|fn=` (cells a b c…), `size=RxC fn="r+c"`, `vals=t.c` (a table column).
- Verbs: `step id=o[r,c]`, `sweep id=o dur=`, `col id=t.c fn= dur=` (rows fill; a b… this row, pa pb…
  the row above), `set` (an input changes, dependents recompute and tween), `band`, `dist`, `level`
  (a reference line), `emph … where="x==7"`. Parts (`g[2,3]`, `g[1:2,1:3]`, `v[4]`, table `t[3]` = row)
  are points and boxes for emph/fade/box/arrow/connect. `center=` places boxes and text by their centre.
- One state animation per block: a later state change fast-forwards the running one (lands its end
  state) and then starts; overlays (emph, fade) never interrupt. Sweeps never block the narration
  (draw resolves once the first cell is under way). Reduced motion: no glides, discrete steps.
- Sections have no per-answer cap and grow past 700 units for tall kit content (`growRegion`).
- Numbers: computed values are always decimals (133.3, never 400/3); only fractions the model wrote
  (1/9 weights) keep that form. A mean or an (A)/B fn shows the sum before dividing.
- Formulas: `{{const v=20 g=9.8 T=2*v/g}}` (or a `let` of plain numbers) names numbers every kit
  formula can use. `{{plot}}` without hand-drawn `axes` is the engine's: `fn=` over `domain=`, or
  `x=` `y=` over `t=` (ranges may be formulas), on its own ticked axes or another plot's (`axes=`,
  one scale; scatters too), `"label"` at the end or `label=top` at the apex, `xlabel=`/`ylabel=`.
  Charts (scatter, line, plot) default to ~75% of the board; a band's count is a readout above the
  plot ("inside band: N"). Element ids accept hyphens (`row-column` → `row_column`).

### Contracts not to break

- **Timing.** Every action carries `at` (its word's start time). Scroll/sketch/ink lead by 450ms.
  Layout runs serially; ink waits only for the layout queued before it and only until its target
  is visible, then starts on its word. Target: word visible → ink visible p90 ≤ 150ms, no drift.
- **Coordinates.** Page targets use 0–1000 on x and y (`p=N`). Region targets use x 0–1000,
  y 0–700 (`on=<id>`). Text is sized in screen px at draw time.
- **Drawing accuracy.** Prefer figure marks and text anchors (`"quote" near=x,y`), then raw
  coordinates. A misplaced drawing is worse than none: unresolved anchors are skipped. The model
  names topology (marks, names, constructions); the engine computes coordinates. Demo scripts use
  literals and stay byte-identical through the resolver.
- **Continuity.** Reveal a whole box before drawing in it; pan back before drawing off-screen;
  bring both ends of a connector on screen (slides and board scroll independently); ids unique;
  nothing drawn under the caption dock (the viewer's visible band ends above it); if the student
  scrolls the slides or the board, show "Back to answer"; re-layout on resize. No cap on sketches
  per answer. Board elements are never shifted individually: a section scales as a whole, text
  wraps at its `at`. The board's scroller carries `data-petu-board` (the eval captures it).

## Explanation quality (applies to demo scripts and the agent prompt)

One idea per answer. Takeaway first. At most one new element per sentence, labelled as it is
drawn. Reuse the slide's own notation and figures. Accent colour only for
the takeaway. End on a payoff. Diagrams build up with the narration — never appear finished.

UI bar: calm and precise; no blinking or pulsing indicators, no gradient text, no visible
scrollbars; every control has hover, focus-visible and active states; text ≥ 11px.

## Plan and status

| Checkpoint | Scope | Status |
|---|---|---|
| 1 | Viewer, student canvas, parser, paced clock, director, agent strokes, captions, demos (no AI) | done |
| Canvas v2 + Toolkit v2 | Desk canvas, free movement, connectors, follow mode, full drawing toolkit, visual language | done (placement replaced by Lessons v3 L) |
| Lessons v3 L | Split layout: slides left, board right, persistent board, dock under the slide column | done |
| 2 | Agent: grounding (lines + marks), relational geometry, `/api/ask` streaming from OpenAI with a spend ledger, prompt p3.2, `?debug` latency/cost, judged eval (24 questions, 12 PDFs, held-out test split) | done; held-out test judge 4.61 (P1 4.45), first word p50 1.28s, ~$0.004/answer; awaiting founder review |
| Lessons v3 A + Visual kit v1 + Eval v3 | Two stages (scout opener + stage 2), deck digest, visual kit, prompt p4.6; eval q2 (40 questions, 20 dev / 20 test), rubric r3 | done; prompt now p4.9, scout s2.2 |
| Lessons v3 tuning | Step 0 (kit forgiveness: header columns, ↓, decimals, image/line views, seeded noise, engine plots from constants, readouts; skips as a metric; answer records) and r3 calibration | done 2026-10-28 (dev replay: 2 skips / 291 tags, 0 malformed, 0 skip defects; first word p50 1.25s / p90 2.3s). Bake-off, iteration and held-out validation paused: the eval set (hard real-world PDFs) and huge-PDF context are being redesigned first |
| 3 | Polish: settings panel, history, text selection, anchored-bubble captions setting, error states | later |
| Voice | Own design pass (TTS clock drives the same timeline) | after 3 |

Non-goals for v1: scanned PDFs/OCR, accounts, multiple documents, persistence across reloads,
mobile layouts.

## Rules

- **Secrets.** `OPENAI_API_KEY` lives in `.env` (gitignored). Never read, print or commit it; the
  key must never reach the browser (the checkpoint-2 server reads it).
- **Private material.** `public/dev/` holds the user's course PDFs: gitignored, never commit or
  copy them. The committed fixture is `public/fixtures/epipolar.pdf` (generated).
- **OpenAI spend.** Every call (answers, prewarm, the eval judge) goes through the persistent
  ledger `.petu/spend.json` (`server/ledger.ts`, every write under a lockfile so several processes
  never lose each other's entries): it reserves a request's worst case (all input at
  the 12h cache-write rate + full `max_output_tokens`) and refuses before sending if any cap would
  be crossed; recorded cost comes from `usage` at the prices pinned in `server/prices.ts`; an abort
  or crash books an estimate. Caps: **$60 hard stop** (`PETU_TOTAL_CAP_USD` may
  only lower it), per-phase budgets selected by `PETU_PHASE` (dev 1, bakeoff 6, iterate 7,
  validate 2, founder 21.99, lessondev 1.5, lessonbake 3, lessoniter 3.5, lessonval 2, bench 15; override one run with `PETU_CAP_<PHASE>=…`), and **$3/day** in the
  founder phase (`PETU_DAILY_CAP_USD`). Knobs go on the command line (`PETU_PHASE=iterate npm run
  eval …`); nobody edits `.env` for them. No ad-hoc scripts call the API; `?debug` shows per-answer
  cost and spent/cap; `GET /api/spend` shows totals by phase.
- **Workflow.** Until v0 alpha, commit and push directly to `main` after each verified round;
  after that, branches and PRs. Design/plan working docs live locally under `docs/superpowers/`
  and are not pushed.
- **Verification.** Review UX through real-time recordings, not stills — except agent answer
  quality, which is reviewed through the eval's `report.html` (per-sentence stills, judged) with no
  recordings unless the founder asks. Every UI or engine check covers Chrome and WebKit (the
  founder likely uses Safari; `--webkit` in the eval). Headless Chrome's `--virtual-time-budget`
  does not work for this app (the pdf.js worker stalls).
- **Eval discipline.** Iterate on the dev split only; the test split is held out (one P1 baseline,
  then P3 validation). Accept a change only on `compare.ts` ACCEPT (mean judge Δ ≥ +0.15, no
  fatal/skip/malformed/first-word regressions) plus a hand review of `report.html`. The judge is
  ~0.5 lenient in absolute terms: trust deltas and fatal flags, not levels. No eval-deck wording in
  the prompt (the prompt test greps for it).
