# Layout and UI brief

The shell around the engine: the PDF viewer, the board's place on screen, the caption + ask-bar
dock, follow mode and settings. All geometry derives from the window, never the screen.

## File map

| Path | What it is |
|---|---|
| `src/App.tsx` | Wiring (865 lines): URL params, open PDF (drop / `?src=` / sample), `useAgent`, `Director`, `Desk`, `runAnswer` (one `AnswerSession` per answer; caption, errors, cap lines, history push), eval hooks, `DebugPanel` (`?debug`), Esc → `desk.dismiss()` between answers. |
| `src/pdf/PdfViewer.tsx` | Virtualized pages (`PageRenderer`, `KEEP_RADIUS` 3, `MAX_INFLIGHT` 2 renders, dpr ≤ 2), scroll ownership (`ScrollOwner`), split state (`setSplit` re-lays the column with a glide), implements `ViewerApi` and `DeskHost`. Sets `setStackBottom` when stacked. |
| `src/pdf/PageSlot.tsx` | One page: canvas host + SVG layers `highlight` and `agent` (+ student overlay). |
| `src/pdf/viewerApi.ts` | `ViewerApi` (page geometry, layers, text runs, scroll/visibility, `deskHost()`). |
| `src/pdf/scroll.ts` | `animateScrollTo` (eased, 300–600ms, owner-marked so follow mode can tell engine vs student). |
| `src/pdf/textRuns.ts`, `mathGlyphs.ts`, `contentMask.ts`, `loadPdf.ts` | Text runs from pdf.js; broken-ToUnicode math repair; coarse content grid (connector routing); `loadPdf`. |
| `src/desk/layout.ts` | `frameFor(W,H,split,aspect)` → reading / split (normal 1:1, wide 0.4:0.6) / stacked; `margin` = clamp(16, 2.5vw, 40); `SAFE_TOP` 64, `safeBottom()` (dock), `MIN_SLIDE_COL` 440. |
| `src/desk/Desk.ts` | Board DOM in `.desk-stage`; opens/closes the split (`GLIDE_MS` 420), `state()`/`subscribe()` → `DeskState {split, stacked, following, sketching, column, board}`. |
| `src/desk/follow.ts` | `Follow` (rule 6: student scroll/zoom stops the engine moving the view; `paused()` → pill), `ScrollOwner`, `isScrollKey`. |
| `src/ui/layout.ts` | `dockPlacement(W, deskState)`: dock centred under the slide column, ≤ `DOCK_MAX` 560. |
| `src/ui/AskBar.tsx` + `barMode.ts` | One bar whose meaning follows the moment (`barMode`: before "Ask about this PDF…", during an answer "Ask about this…" (typing pauses it; Enter asks an aside; stop sits in the parts row once it shows), after "Follow up…", after an answer that closed on a question (`closingQuestion`: its last sentence ends in ?) "Your answer…" (the reply goes out with `check`). The "about: … · p.N" chip (point-to-ask) sits before the field. `/` focuses; Esc clears typed text, then closes an aside, then stops; intent → prewarm; suggestions; cap line; transcript. |
| `src/ui/Caption.tsx`, `captionWindow.ts`, `text.ts` | Sentence-windowed caption (≤ 2 lines, splits at clause marks), waiting / "Still thinking…" (4s) / faint "…" pause, error + Retry; `primes` (x' → x′), `takeSentences`. |
| `src/ui/TopBar.tsx` | File name, page indicator (ticks when the agent moves pages), open file, settings button. |
| `src/ui/SettingsPopover.tsx` + `src/settings/settings.ts` | Ink style (live/hand/clean), ink + highlight colour, caption speed (wpm, default 170), shortcuts. Persisted in localStorage `pdf-tutor.settings` (v2); `useSettings()`. |
| `src/ui/CanvasToolbar.tsx` + `src/ink/student/*` | Student drawing (D toggles, pen/highlighter/eraser, undo); strokes in `ink` store, sent as `STUDENT INK`. |
| `src/ui/FollowPill.tsx`, `EmptyState.tsx` | "Back to answer" (→ `desk.resume()`); drop/open screen with the sample. |
| `src/ui/RouteChip.tsx` | Journeys: "p9 → p2 · <section>" at the top of the slide column for `ROUTE_MS` (App), then "Back to pN" (`returnTarget`: N = the page in view when the question was asked; shown only once the answer has played past its first part and the view is elsewhere, so an answer that opens by moving to its page never offers it; mid-answer, pressing it is the student taking over: follow pauses). Journeys land with the same split framing as any scroll (`framedTop`: slide top on the board's top). |
| `src/ui/PartsBar.tsx` | The playing answer's controls: one slim row in the caption once the first word is spoken: pause/resume · `n/N` + part title · segment rail (≥ 2 parts) · replay sentence · speed · stop. During an aside: ASIDE tag (warm grey) · "Answer paused at n/N" · Resume answer ↵. |
| `src/ui/playbackKeys.ts` | Pure key map: Space pause/resume, R replay sentence, Shift+←/→ sentences, ←/→ parts (≥ 2), `<` `>` speed; with an aside open Esc (even from the bar) and Return (outside a field) resume the answer, Space/R/speed act on the aside. Never while typing, with ⌘/Ctrl/Alt or a popover open. |
| Asides (App `askAside`/`closeAside`, `src/ui/trail.ts`, `Desk.setAside`) | A question asked mid-answer: the answer pauses on its word; a second `Director` (the aside's ink lane, on a desk proxy that never aborts the desk) plays the side answer into a warm-grey inset on the board (`has-aside` steps the rest back; the paused answer's sections are cropped to their ink meanwhile); Return / Resume collapses it to a marker (click reopens) and the answer resumes. One level. Agent: `/api/ask` with `context.aside` (`src/agent/moment.ts`: question, plan, words so far, board); dev scripts play `answers[q]`. |
| Session trail (`src/ui/trail.ts`, `Desk.headNext`) | Each answer's first section gets a question header (number, title, `p.N · m:ss`; a check reply ✓); clicking it replays the recorded script (no call). Not in `?eval`. No persistence. |
| Point-to-ask (App) | A text selection on a page or the board, or a pen loop on a page (`isLoop`), sets the chip; the question carries `context.about`. Student pen defaults to blue. |
| `src/ui/ShortcutsOverlay.tsx`, `src/ui/zoomKeys.ts` | `?` opens the shortcuts card; ⌘−/⌘+/⌘0 (Ctrl elsewhere) zoom the board; the control (− NN% + │ Fit) is the board's bottom-right (`Desk.setZoom/zoomStep`). |
| `?script=learner` (`src/demo/learner.ts`) | The v1 storyboard as one simulated session on econ.pdf p12 (`steps`: ask, aside, resume, follow-up, circle + chip, check reply, zoom, shortcuts); gallery scene `learner`. |
| `src/pdf/sections.ts` | `SectionLabels`: a page's label = deepest bookmark at or before it, else the page title (tallest top line). |
| `src/ui/ui.css`, `src/app.css`, `src/styles/tokens.css`, `src/desk/desk.css`, `src/pdf/viewer.css` | Styles; tokens are the source for ink colours/weights (`ink/agent/tokens.ts` mirrors them). |

## States and data flow

- **Reading** (`split: 'none'`): pages centred (`readingColumn`, ≤ 860px). No board.
- **Split**: first `{{sketch}}` → `Desk.addRegion` → `openBoard(normal|wide)` → `host.setSplit` glides
  the slide column left and the board in; the slide is re-framed with its top on the board's top.
  `size=l` on any section → wide. Board persists across answers; × or Esc (when idle) → `dismiss()`.
- **Stacked**: when the split slide column would be < 440px: slides on top (page fitted to ~45% of
  the band), board below, dock at the foot.
- **Dock**: caption + ask bar as one unit; App measures it and calls `setSafeBottom` so nothing is
  framed or drawn under it; `--view-top/--view-bottom` CSS vars give the viewer's visible band.
- **Sketching**: `.stage.is-sketching` dims non-current pages while an answer draws on the board and
  the student follows.
- **Follow mode**: engine scrolls only while `following()`; a student scroll/zoom flips it off and
  shows the pill; ink still lands where it belongs.

## Dev URLs (append to your dev server URL)

`?demo=1|side|plane`, `?script=kit|toolkit|relational|lec09`, `?src=<pdf url>` (`/api/dev-pdf/<n>.pdf`
from `PETU_PDF_DIRS`), `&page=N` (with `&eval`), `&debug`, `&noplay`, `&style=hand|clean`, `&eval`
(installs `window.__petu`), `&nogen` (replay only), `&fail=N` (cut the stream after N chunks).
Demo/script/fail paths play canned scripts and make no API call.

- **Flow across the document** (spec section of that name): the director reports journeys (a scroll
  to a page that isn't adjacent) → route chip; the session's parsed script → `deriveParts`. Keys
  (`playbackKey`) in a capture-phase listener in App, before AskBar's Esc-stops. Journey beat:
  `JOURNEY_HOLD_MS` 500 + `ARRIVAL_MS` 200 (director.ts). Dev: `?script=flow` (econ.pdf, asked on p9);
  gallery `flow-controls` shows the row paused at 1.25×.
- **Speed**: `settings.speed` (localStorage with the other settings) is the `PacedClock` rate (every
  word and pause ÷ speed; the wpm setting is unchanged); a change calls `session.respeed()` (words
  after the next re-time). Ink waits on its word's *live* start (`onAction(a, at, live)` →
  `director.run(a, at, live)`; null while paused), so pause, speed and seek-back keep ink on its word.

## Invariants / contracts

- Nothing drawn or framed under the dock; reveal before drawing; pan back before drawing off-screen.
- Re-layout on resize; layout derives from window size (`frameFor`), never from the screen.
- The board scroller carries `data-petu-board` (eval captures it). Don't rename it.
- UI bar: calm; no blinking/pulsing indicators, no gradient text, no visible scrollbars; every control
  has hover, focus-visible and active states; text ≥ 11px; reduced motion respected.
- Every UI check covers Chrome **and** WebKit (the founder uses Safari).

## To change X, touch Y

- Split ratios / margins / stacked threshold: `src/desk/layout.ts` (`frameFor`, `WIDE_SHARE`,
  `MIN_SLIDE_COL`, `STACK_SHARE`) + `tests/desk/layout.test.ts`.
- Dock position/width: `src/ui/layout.ts` + `tests/ui/layout.test.ts`; dock CSS `.dock` in `ui.css`.
- Caption behaviour: `captionWindow.ts` (pure) + `tests/ui/caption*.test.ts`; timings are constants at
  the top of `App.tsx` (`CAPTION_LINGER_MS`, `STILL_THINKING_MS`, `PAUSE_GRACE_MS`).
- A new setting: `Settings` + `DEFAULTS` in `settings.ts` (bump `VERSION` only for a migration) →
  `SettingsPopover.tsx` → read via `getSettings()`/`useSettings()`; `tests/settings/settings.test.ts`.
- Answer lifecycle / error lines: `runAnswer` in `App.tsx`; wording in `src/agent/client.ts` (`askErrorLine`, `capLine`).
- Viewer rendering/scroll: `PdfViewer.tsx`; tests `tests/pdf/*`.

## Tests / commands

```bash
npx vitest run tests/ui tests/desk/layout.test.ts tests/desk/follow.test.ts tests/pdf tests/settings
npx vite --port 5182 --strictPort      # your own server; 5180/5181 are the founder's
```
Review real interaction in Chrome and WebKit by hand (no recordings unless asked). Headless Chrome's
`--virtual-time-budget` does not work here (the pdf.js worker stalls).

## Pitfalls

- `App.tsx` is large and stateful: refs (`sessionRef`, `busyRef`, `pageRef`, `agentRef`) exist so
  callbacks see current values; a stale closure is the usual bug.
- `safeBottom()` is module state in `desk/layout.ts` (set by App via `setSafeBottom` and PdfViewer via
  `setStackBottom`): it leaks between tests in one file unless reset (see `tests/ui/layout.test.ts`).
- The dock's `left/width` are set inline on purpose (a Safari var() glide issue); keep it that way.
- Esc is overloaded: stops an answer (AskBar), closes the canvas tool, closes the board when idle.
- Settings are per browser (localStorage); private mode silently doesn't persist.
