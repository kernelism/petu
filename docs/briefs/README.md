# petu briefs: start here

Short, code-checked maps of each subsystem. Read this page, then the brief for the area you are
changing. Where a brief and `AGENTS.md` disagree, the code wins; when you notice a brief has drifted,
fix the brief.

| Brief | Covers |
|---|---|
| [board-engine.md](board-engine.md) | `src/script` (grammar, parser) → `src/playback` (clock, scheduler, director) → `src/desk` (board, kit, layout, connectors) → ink. Add a tag, block or verb. |
| [agent-pipeline.md](agent-pipeline.md) | Scout + stage 2: `src/agent/*`, `server/*` (routes, request layout, caching, ledger, env, prices, prompts). Change the prompt safely. |
| [layout-ui.md](layout-ui.md) | `App.tsx`, `src/pdf/PdfViewer`, `src/ui/*`: reading / split / stacked states, dock, follow mode, settings, dev URLs. |
| [eval.md](eval.md) | `scripts/eval/*`: question sets, splits, r3 rubric, frames, calibration, report, configs, phases, costs. |

One-line system: the student asks → `/api/scout` streams an opener + page plan → stage 2 (`/api/ask`)
streams a script (narration with `{{tags}}`) → parser → scheduler (word times) → director → board / page ink.

## House rules (every agent, every task)

- **Never touch `.env`.** Do not read, print, cat, grep or edit any `.env*` file. The key lives
  there; only `server/env.ts` reads it. Knobs (`PETU_*`) go on the command line
  (`PETU_PHASE=iterate npm run eval …`), never into `.env`.
- **Never commit** `.env*`, `.petu/`, `public/dev/`, `node_modules/`, `docs/superpowers/`, or any
  course PDF (the founder's lecture files, wherever they sit). The only committed PDFs are the
  generated fixtures in `public/fixtures/`.
- **Explicit `git add <path>`** only. No `git add -A` / `git add .` / `commit -a`.
- **Commit attribution:** end every commit message with a blank line and
  `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`. Use the repo-local author.
- **No recordings** (screen videos) unless the founder asks. Agent answer quality is reviewed in the
  eval's `report.html`.
- **Ports 5180 and 5181 belong to the founder.** Don't start, kill or probe servers on them. Your own
  dev server: `npx vite --port 5182 --strictPort` (or any free port outside 5180–5181); the eval runner
  uses 5186–5195 by itself.
- **Budget caps.** Every OpenAI call goes through the ledger (`.petu/spend.json`). $40 hard stop
  (`HARD_STOP_USD`), per-phase budgets (`server/env.ts` `PHASE_CAPS`), $3/day in the founder phase.
  Never write a script that calls the API directly; never raise a cap without being told to (and then
  only per run, on the command line).
- **The prompt is a brief, not a rulebook.** No modes, no per-question-type recipes, no length or
  element caps in `server/prompt/*` (the prompt test fails on them). Every sentence must hold for any
  question about any PDF.
- **Generalise beyond CS.** Examples, tests and prompt wording must work for economics, physics,
  biology… not just the founder's vision course. No eval-deck wording in the prompt (`EVAL_VOCAB`).
- **North star: intuition.** The answer shows the *mechanism* happening on the board (a concrete
  case that builds while the tutor talks), points at the student's own pages, and never copies the
  page or the narration onto the board.
- Every change ends green on `npx tsc --noEmit && npx vitest run && npm run build`.
- Build only what was asked. UX first, then latency, then timing.
