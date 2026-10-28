# AGENTS.md — petu (PDF tutor)

Core context for anyone (human or agent) working in this repo. Read this first.

## What it is

A web app where a student opens a PDF and asks questions about it. The tutor answers by
*performing* on the document: it scrolls to the right page, highlights text in sync with its
narration, and draws to explain — on the page itself, on the desk beside the page, or on a
full-screen canvas for big diagrams. The student can draw too.

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
```

Every change ends green on `npx tsc --noEmit && npx vitest run && npm run build`.

Dev URLs (append to the dev server URL):
- `?demo=1` — PDF-only demo on the fixture
- `?demo=side` — tutor sketches beside the page ("C")
- `?demo=plane` — full-screen takeover ("B")
- `?script=lec09`, `?script=toolkit` — dev scripts (lec09 needs a local, gitignored PDF)
- `&debug` timing panel · `&noplay` no autoplay · `&style=hand|clean` · `?src=<pdf url>`

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
3. `src/desk/` — the canvas model: sketch regions anchored to pages, lanes that slide the page
   column aside (C), the full-screen stage (B), connectors, follow mode, element registry
   (`id=`, `emph`, `move`, `fade`), toolkit elements (`expr` safe parser — no eval, `plot`,
   `math`, `nudge`).
4. `src/ink/agent/` — stroke geometry and human-like pen motion (live / hand / clean styles).
   `src/ink/student/` — freehand student ink.
5. `src/pdf/` — viewer, virtualized page slots, text runs, scroll ownership, content mask.
   `src/locate/` — quote → rects on the text layer.
6. `src/ui/` — ask bar, caption (sentence-windowed), toolbar, follow pill, top bar.

Action kinds: `scroll highlight underline circle box line arrow curve point label write math
shade angle brace axes plot sketch connect emph move fade clear`.

### Contracts not to break

- **Timing.** Every action carries `at` (its word's start time). Scroll/sketch/ink lead by 450ms.
  Layout runs serially; ink waits only for the layout queued before it and only until its target
  is visible, then starts on its word. Target: word visible → ink visible p90 ≤ 150ms, no drift.
- **Coordinates.** Page targets use 0–1000 on x and y (`p=N`). Region targets use x 0–1000,
  y 0–700 (`on=<id>`). Text is sized in screen px at draw time.
- **Drawing accuracy.** Prefer text anchors (`"quote" near=x,y`), then figure marks, then raw
  coordinates. A misplaced drawing is worse than none: unresolved anchors are skipped.
- **Continuity.** Reveal a whole box before drawing in it; pan back before drawing off-screen;
  frame both ends of a connector (else take over the screen); ids unique; clamp to bounds;
  nothing drawn under the caption dock; if the student scrolls, show "Back to answer";
  re-layout on resize; at most 2 regions per answer.

## Explanation quality (applies to demo scripts and the agent prompt)

One idea per answer. Takeaway first. At most one new element per sentence, labelled as it is
drawn. Reuse the slide's own notation and figures. About 6 elements max. Accent colour only for
the takeaway. End on a payoff. Diagrams build up with the narration — never appear finished.

UI bar: calm and precise; no blinking or pulsing indicators, no gradient text, no visible
scrollbars; every control has hover, focus-visible and active states; text ≥ 11px.

## Plan and status

| Checkpoint | Scope | Status |
|---|---|---|
| 1 | Viewer, student canvas, parser, paced clock, director, agent strokes, captions, demos (no AI) | done |
| Canvas v2 + Toolkit v2 | Desk canvas (C beside page, B takeover), free movement, connectors, follow mode, full drawing toolkit, visual language | in review |
| 2 | Agent: local server `POST /api/ask` streaming the script from OpenAI; explanation-quality prompt; context assembly; latency overlay; eval on ~10 fixed questions | next |
| 3 | Polish: settings panel, history, text selection, anchored-bubble captions setting, error states | later |
| Voice | Own design pass (TTS clock drives the same timeline) | after 3 |

Non-goals for v1: scanned PDFs/OCR, accounts, multiple documents, persistence across reloads,
mobile layouts.

## Rules

- **Secrets.** `OPENAI_API_KEY` lives in `.env` (gitignored). Never read, print or commit it; the
  key must never reach the browser (the checkpoint-2 server reads it).
- **Private material.** `public/dev/` holds the user's course PDFs: gitignored, never commit or
  copy them. The committed fixture is `public/fixtures/epipolar.pdf` (generated).
- **OpenAI spend.** Send the visible page ±2 pages of text plus one low/medium-detail image; keep
  a stable cacheable prompt prefix; default to a small model; server-enforced daily cap (default
  $2/day, set in `.env`); `?debug` shows per-request cost; dev tests use a fixed ~10-question set.
- **Workflow.** Until v0 alpha, commit and push directly to `main` after each verified round;
  after that, branches and PRs. Design/plan working docs live locally under `docs/superpowers/`
  and are not pushed.
- **Verification.** Review UX through real-time recordings, not stills. Headless Chrome's
  `--virtual-time-budget` does not work for this app (the pdf.js worker stalls).
