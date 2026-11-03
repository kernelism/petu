# Layout and UI brief

The shell around the engine: the PDF viewer, the board's place on screen, the caption + ask-bar
dock, follow mode and settings. All geometry derives from the window, never the screen.

## File map

| Path | What it is |
|---|---|
| `src/App.tsx` | Wiring (865 lines): URL params, open PDF (drop / `?src=` / sample), `useAgent`, `Director`, `Desk`, `runAnswer` (one `AnswerSession` per answer; caption, errors, cap lines, history push), eval hooks, `DebugPanel` (`?debug`; the cap's developer line `capLine`), Esc / × → `desk.hide()` between answers (closing hides, never erases; `show()` or the next sketch brings the trail back). Cap copy for the student: `capNotice` (`client.ts`), a wrapping `.askbar-status` row. An opened check question stays pinned in the caption (`.caption-check`) until a reply, a new question, × or Esc. |
| `src/pdf/PdfViewer.tsx` | Virtualized pages (`PageRenderer`, `KEEP_RADIUS` 3, `MAX_INFLIGHT` 2 renders, dpr ≤ 2), scroll ownership (`ScrollOwner`), split state (`setSplit` re-lays the column with a glide), implements `ViewerApi` and `DeskHost`. Sets `setStackBottom` when stacked. |
| `src/pdf/PageSlot.tsx` | One page: canvas host + SVG layers `highlight` and `agent` (+ student overlay). |
| `src/pdf/viewerApi.ts` | `ViewerApi` (page geometry, layers, text runs, scroll/visibility, `deskHost()`). |
| `src/pdf/scroll.ts` | `animateScrollTo` (eased, 300–600ms, owner-marked so follow mode can tell engine vs student). |
| `src/pdf/textRuns.ts`, `mathGlyphs.ts`, `contentMask.ts`, `loadPdf.ts` | Text runs from pdf.js; broken-ToUnicode math repair; coarse content grid (connector routing); `loadPdf`. |
| `src/desk/layout.ts` | `frameFor(W,H,split,aspect)` → reading / split (normal 1:1, wide 0.4:0.6) / stacked; `margin` = clamp(16, 2.5vw, 40); `SAFE_TOP` 64, `safeBottom()` (dock), `MIN_SLIDE_COL` 440. |
| `src/desk/Desk.ts` | Board DOM in `.desk-stage`; opens/closes the split (`GLIDE_MS` 420), `state()`/`subscribe()` → `DeskState {split, stacked, following, sketching, column, board}`. |
| `src/desk/follow.ts` | `Follow` (rule 6: student scroll/zoom stops the engine moving the view; `paused()` → pill), `ScrollOwner`, `isScrollKey`. |
| `src/ui/layout.ts` | `dockPlacement(W, deskState)`: dock centred under the slide column, ≤ `DOCK_MAX` 560. |
| `src/ui/AskBar.tsx` + `barMode.ts` | One bar whose meaning follows the moment (`barMode`: before "Ask about this PDF…", during an answer "Ask about this…" (typing pauses it; Enter asks, routed by the scout to an aside or a new answer (`src/agent/route.ts`); stop sits in the parts row once it shows), after "Follow up…", after an answer that offers a check question (p6.2: the model's hidden `<check>`, `done.check`; else `closingQuestion` on a spoken closing question) a collapsed "Test yourself" chip; opened, the question is pinned in the caption (× / Esc put it away) and the bar reads "Your answer…" (the reply goes out with `check`). The "about: … · p.N" chip (point-to-ask) sits before the field. `/` focuses; typing with it unfocused writes into it (`ui/typeAhead.ts`: a letter that is no shortcut at once; a shortcut letter waits `TYPE_GAP_MS`, then acts alone or, followed by a key in time, is text); Esc clears typed text, then closes an aside, then stops; intent → prewarm; suggestions; cap line; transcript (`Transcript.tsx`, `transcriptLive.ts`: after the answer its text; mid-answer the heard sentences, the spoken one lit, auto-scroll unless scrolled away, click = `seekWord`; opens above the caption; Esc closes it before stopping). The field is a textarea that grows with the question to `MAX_LINES` (5), then scrolls inside, newest words in view. Dictation (`src/agent/dictation.ts`, Speechmatics; the mic or **V**: tap to start/stop, hold to talk, release sends): after `END_SILENCE_S` (2 s, Speechmatics' max) of silence a quiet "Sending…" countdown (`SEND_AFTER_MS`) runs, cancelled by more speech or any key; Enter / mic / V send at once; a one-word fragment never sends itself. Mid-answer, listening pauses the answer like typing does. |
| `src/ui/Caption.tsx`, `captionWindow.ts`, `text.ts` | Sentence-windowed caption (≤ 2 lines, splits at clause marks), one wait cue: a faint "…" before the first word, and after the last word once a mid-answer pause passes 1.5 s (`PAUSE_CUE_MS` in captionWindow.ts; no status text), error + Retry; `primes` (x' → x′), `takeSentences`. |
| `src/ui/TopBar.tsx` | File name, page indicator (ticks when the agent moves pages), open file, settings button. |
| `src/ui/SettingsPopover.tsx` + `src/settings/settings.ts` | Highlight (violet wash / yellow marker), Speed (0.75 · 1 · 1.25 · 1.5×; the clock is `BASE_WPM` 170 × speed), Voice (Off/Marin/Cedar; applies mid-answer through `src/playback/switchClock.ts`: Off at once, a voice from the next sentence), Answer quality (Standard / Best: a token the server maps, `server/quality.ts`; Best disabled unless `/api/spend` says `best`), a quiet "Keyboard shortcuts ?" link. Shortcuts are always on; the drawing style (live) and the ink (violet) are fixed and never stored (`?style=` is a dev aid for one load). Persisted in localStorage `pdf-tutor.settings` (v3: a v2 wpm × speed folds into the nearest step); `useSettings()`. |
| `src/ui/CanvasToolbar.tsx` + `src/ink/student/*` | Student drawing (D toggles, pen/highlighter/eraser, undo); strokes in `ink` store, sent as `STUDENT INK`. |
| `src/ui/FollowPill.tsx`, `EmptyState.tsx` | "Back to answer" (→ `desk.resume()`: in the lane, the answer's latest page mark, since its sticky drawing is always in view); drop/open screen with the sample. |
| `src/ui/RouteChip.tsx` | Journeys: "p9 → p2 · <section>" at the top of the slide column for `ROUTE_MS` (App), then "Back to pN" (`returnTarget`: N = the page in view when the question was asked; shown only once the answer has played past its first part and the view is elsewhere, so an answer that opens by moving to its page never offers it; mid-answer, pressing it is the student taking over: follow pauses). Journeys land with the same split framing as any scroll (`framedTop`: slide top on the board's top). |
| `src/ui/PartsBar.tsx` | The playing answer's controls: one slim row in the caption once the first word is spoken: pause/resume · `n/N` + part title · segment rail (≥ 2 parts) · replay sentence · speed · stop. During an aside: "Side question" · (pause, replay, speed on hover/focus) · "Answer instead" (quiet text: ends the paused answer and asks the side question as the answer) · Back to answer (lucide CornerDownLeft). Paused: `.pb.is-paused`, a one-part answer's title reads "Paused". |
| `src/ui/playbackKeys.ts` | Pure key map: Space pause/resume, R replay sentence, Shift+←/→ sentences, ←/→ parts (≥ 2), `<` `>` speed; with an aside open Esc (even from the bar) and Return (outside a field) resume the answer, Space/R/speed act on the aside. Never while typing, with ⌘/Ctrl/Alt or a popover open. |
| Mid-answer routing (App `routeAsk`, `src/agent/route.ts`) | A question typed over an agent answer is routed by the scout, not by construction: the answer waits paused (Space does nothing meanwhile) and the dock shows only the question, muted, while `prescout` sends the scout the paused answer (`ScoutRequest.paused`); its first field, `route`, streamed as its own event before any opener, picks the session that adopts that scout (asked once): `aside` (below) or `new`: `runAnswer` replaces the answer, which ends where it is: stage 2 gets `context.replaced` (what the student heard), the director stops with `withdraw` (an svg group still drawing leaves the board, `render.ts` WITHDRAW; Stop still lands it). No route (a dev script, a failed scout): aside. Stop, Esc, Return or another Enter drop a pending route. |
| Asides (App `askAside`/`closeAside`, `src/ui/trail.ts`, `Desk.setAside`) | A question the scout routes `aside`: the answer pauses on its word; a second `Director` (the aside's ink lane, on a desk proxy that never aborts the desk) plays the side answer into a warm-grey inset on the board (`has-aside` steps the rest back; the paused answer's sections are cropped to their ink meanwhile); Return / Resume collapses it to a marker (click reopens) and the answer resumes. One level. Agent: `/api/ask` with `context.aside` (`src/agent/moment.ts`: question, plan, words so far, board); dev scripts play `answers[q]`. |
| Session trail (`src/ui/trail.ts`, `Desk.headNext`) | Each answer's first section gets a question header (number, title, the pages it taught from and how long it played, `p.86–88 · m:ss`: `parts.ts taughtPages`, `trail.ts pagesLabel`, home first, so an answer asked on the cover and taught on p86–88 never reads p.1; a check reply ✓); clicking it replays the recorded script (no call). Not in `?eval`. No persistence. |
| Point-to-ask (App) | A text selection on a page or the board, or a pen loop on a page (`isLoop`), sets the chip; the question carries `context.about`. Student pen defaults to blue. |
| `src/ui/ShortcutsOverlay.tsx`, `src/ui/zoomKeys.ts` | `?` opens the shortcuts card (V "Ask by voice" listed when dictation is set up); ⌘−/⌘+/⌘0 (Ctrl elsewhere) zoom the board; the control (− NN% + │ Fit) is the board's bottom-right (`Desk.setZoom/zoomStep`). |
| `?script=learner` (`src/demo/learner.ts`) | The v1 storyboard as one simulated session on econ.pdf p12 (`steps`: ask, aside, resume, follow-up, circle + chip, check reply, zoom, shortcuts); gallery scene `learner`. |
| `src/pdf/sections.ts` | `SectionLabels`: a page's label = deepest bookmark at or before it, else the page title (tallest top line). |
| `src/ui/ui.css`, `src/app.css`, `src/styles/tokens.css`, `src/desk/desk.css`, `src/pdf/viewer.css` | Styles; tokens are the source for ink colours/weights (`ink/agent/tokens.ts` mirrors them). |

## Layout C, the anchored lane (W ≥ 1200; spec docs/superpowers/specs/2026-10-30-anchored-lane-design.md)

The page column and a paper **lane** are one sheet on the viewer's one scroll (mockups C1–C5).
Below 1200 px (or a lane < 440) everything below ("States") still applies: the split board (B).

| Path | What it is |
|---|---|
| `src/desk/layout.ts` `laneFrame` | 1440: page 800 + lane 544, margins 48; 2560: page 1100 + lane 1000, centred. `frameFor(…, lane = true)`: the page column is the same reading or drawing (nothing glides). |
| `src/desk/lane.ts` | Pure maths: `packLane` (anchor top, 24 px stacking, earlier groups never move), `dockTop` (move least, anchor inside), `leaderPath` (≤ 120 px, dot on the page edge), `leaderFrom` (a leader only to a real page mark: an answer that never marks a page, e.g. asked on a title page, sits at the top of its answer with none), `stickyInsets`. Tests `tests/desk/lane.test.ts`. |
| `Desk` lane mode | The board element mounts in the viewer's `.pv-lane` (`DeskHost.laneEl`). Each answer is a **group** (`.lane-group` › spacer + `.lane-item`: head + sections in flow) at its anchor (its first page mark; before one, the reading line, re-anchored with a glide at the first mark). The playing group is `position: sticky` (card + "pinned while the answer plays" when its anchor is out of reach), **docks** at `overview()` (answer end) beside its latest in-view page mark (FLIP 300 ms), **folds** to a 36 px card (thumbnail) when the next question starts; a click opens it. Asides append to the paused group, indented 24 px. Region rects come from the DOM (sticky). `DeskState.lane/page/edge`; `column` = the pen's column (the dock follows it). Esc never clears the lane. An svg board that explains several pages **walks** (`walkSplit`): each svg group belongs to the first page mark made after it begins; when a mark lands on a new page, the groups of earlier pages stay behind as a still slice (a docked group with its own leader, `Group.slice`, folding away with its answer's card) and the live drawing shows only its new stretch (`showFrom`); a follow-up that extends the board undoes the walk (`unwalk`). A walk reads as one thread (`threadWalk`): the answer's head sits over its first slice, each later stretch carries a continuation tag (`contTag` in `ui/trail.ts`, "3 · cont. 2/4"; hover/focus shows the question, click → `showHead`); it folds to one card at its first page reading "p.5–89 · m:ss" (`spanOf`, also the S list). Any folded card sits at its answer's first page mark (`Group.first`), not where it docked. A live group taller than the band **follows the pen** (svg part by part: `reveal` shifts its sticky top, `stickyInsets(…, pen)`); a `BOARD extend` header rides in the group. **Nothing sits under the top bar** (`clipLane`: the card and label keep to the comfort band via `--lane-clip`, parts above are masked with a fade). The dock's column ends its reading band above the dock (`--dock-col-x/w`, app.css three-layer mask). |
| `src/ui/SessionDrawer.tsx`, `session.css` | The session list ("Questions"), closed until asked for: S or the top bar's list button (`TopBar` `onToggleSession`). One row per saved question (a conversation: first question, follow-ups, asides on one board) by its title, in time order; the one on the board tinted; a row with follow-ups or asides opens (one chevron) to list them; a pick of one shows that answer (`headOf`: its header, else the latest before it that reached the board). A pick of another row saves the one on the board and brings that one back (App `pickSession`); the current row scrolls to its latest answer (`Desk.showHead`). M: past marks (`retireOut` in `ink/agent/marks.ts` keeps the last answer's page marks in a hidden `.petu-past` group). Edge marker "↑ p.N · marked". |
| `src/ui/NewQuestion.tsx`, `src/session/` | The ask bar's + (`.dock-new`, left of the bar outside the dock's width; `dockPlacement(…, reserveLeft)` keeps it inside the dock's column): stops what plays, saves the conversation (`saveConv`: `Desk.takeBoard` detaches every group/section/head as it is, `takeMarks` the tutor's page marks and past marks; the student's ink is never touched) and starts a clean board. Each conversation (`session/conversations.ts`) keeps its trail entries, gate seed scripts, svg board id (`Director.boardId/useBoard`), its own `History` and `SessionMemory` (passed to `useAgent.source`), and where it was left. Restore (`enterConv`): `putMarks`, `Desk.putBoard` (re-inserts the same nodes; `position()` lays them out for the window as it is), then the page it was left on is framed (it becomes the page in view). Titles: `session/title.ts` → `POST /api/title` once per conversation, cached by content; until then (or on failure/cap) the first answer's section title. Dev: `?script=new-question` (canned answers, no API call; `&title=live` asks for titles). Design note: docs/superpowers/specs/2026-10-31-new-question-design.md. |
| `src/pdf/overview.ts`, `src/ui/OverviewPill.tsx` | Overview zoom 50–200 % of the whole sheet: pinch / ⌘+wheel / Safari gestures / Z / ⌘±0; `.pv-zoom` clips only while zoomed (`overflow: clip`, sticky keeps working). B4's page zoom (`.pv-pagezoom`, `src/pdf/column.ts`) and the slide's band fit apply outside the lane only; the board's own pinch zoom stands down in the lane. |
| `src/settings/settings.ts` `highlight` | `'violet'` wash (default) or `'yellow'` marker. |

Dev: `?script=lane-econ`, `?script=lane-session` (OpenStax Economics p.87–88, needs the corpus PDF);
gallery scenes of the same names (moments c1-rule, c2-gap, end, c3-aside, c5-follow, c5-session, c5-overview).

## States and data flow

- **Reading** (`split: 'none'`): pages centred (`readingColumn`, ≤ 860px). No board.
- **Split**: first `{{sketch}}` → `Desk.addRegion` → `openBoard(normal|wide)` → `host.setSplit` glides
  the slide column left and the board in; the slide is re-framed with its top on the board's top.
  `size=l` on any section → wide. Board persists across answers; × or Esc (when idle) → `hide()` (inert while closed; the sections stay).
- **Stacked**: when the split slide column would be < 440px: slides on top (page fitted to ~45% of
  the band), board below, dock at the foot. A section scales down to fit the short board (`fitH` in
  `boardLayout`, never below half its width fit).
- **Dock**: caption + ask bar as one unit; App measures it and calls `setSafeBottom` so nothing is
  framed or drawn under it; `--view-top/--view-bottom` CSS vars give the viewer's visible band.
- **Sketching**: `.stage.is-sketching` dims non-current pages while an answer draws on the board and
  the student follows.
- **Follow mode**: engine scrolls only while `following()`; a student scroll/zoom flips it off and
  shows the pill; ink still lands where it belongs.

## Dev URLs (append to your dev server URL)

`?demo=1|side|plane`, `?script=kit|toolkit|relational|lec09`, `?src=<pdf url>` (`/api/dev-pdf/<n>.pdf`
from `PETU_PDF_DIRS`), `&page=N` (with `&eval`), `&debug`, `&noplay`, `&style=hand|clean`, `&eval`
(installs `window.__petu`), `&nogen` (replay only), `&fail=N` (cut the stream after N chunks; `&failat=C` after C characters, deterministic; gallery scene `cutoff`).
Demo/script/fail paths play canned scripts and make no API call.

- **Flow across the document** (spec section of that name): the director reports journeys (a scroll
  to a page that isn't adjacent) → route chip; the session's parsed script → `deriveParts`. Keys
  (`playbackKey`) in a capture-phase listener in App, before AskBar's Esc-stops. Journey beat:
  `JOURNEY_HOLD_MS` 500 + `ARRIVAL_MS` 200 (director.ts). Dev: `?script=flow` (econ.pdf, asked on p9);
  gallery `flow-controls` shows the row paused at 1.25×.
- **Speed**: `settings.speed` (localStorage with the other settings) is the `PacedClock` rate (every
  word and pause ÷ speed, at `BASE_WPM`); a change calls `session.respeed()` (words
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
  the top of `App.tsx` (`CAPTION_LINGER_MS`; the wait cue: `PAUSE_CUE_MS` in `captionWindow.ts`).
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
- Esc is overloaded: stops an answer (AskBar), closes the canvas tool, dismisses a pinned check question or an error line, hides the board when idle. It never erases anything.
- Settings are per browser (localStorage); private mode silently doesn't persist.
