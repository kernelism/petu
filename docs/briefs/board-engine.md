# Board engine brief

Turns a streamed script (`narration {{tag …}} narration`) into timed ink: on PDF pages, and on a
board of sections beside the slides. The model names meaning (marks, names, data); the engine
computes every coordinate and every number.

## File map

| Path | What it is |
|---|---|
| `src/script/types.ts` | The grammar as types: `Shape`, `KitBlock`, `KitVerb`, `RefAction`, `LayoutAction`, `RawAction` (pre-resolve) vs `Action`. Coords: page 0–1000 × 0–1000 (`p=N`), region 0–1000 × 0–700 (`on=id`). |
| `src/script/parser.ts` | `ScriptParser`: incremental; emits `word` / `action` / `end`. Tags may split across chunks; `MAX_TAG_CHARS` 800; newline or a second `{{` fails the tag → its text becomes narration. |
| `src/script/tokenize.ts` | Tag body → `{name, args, quotes, flags, rawArgs}`. |
| `src/script/parseTag.ts` | `parseTag(body)`: one `switch` on the tag name → `RawAction` or null (malformed = skipped + `console.warn`). |
| `src/script/parseKit.ts` | `parseKitBlock` / `parseKitVerb`: grid, bars, table, scatter, calc, fit; step, sweep, set, band, dist, col, level. |
| `src/script/pointExpr.ts` | Point args: literals, names, `#d3`, `mid/along/meet/foot`, kit parts `g[2,3]`. |
| `src/geometry/resolve.ts` | `Figures`: `note()` takes `let` names at parse time; `resolve()` turns names, marks, rays, fitted coords into plain `Action`s, or a skip reason string. |
| `src/geometry/figure.ts` | One figure per target; `fit` sketches freeze one uniform scale at first build. |
| `src/playback/clock.ts` | `NarrationClock` interface (TTS-ready); `PacedClock` = syllable-weighted pace from `settings.wpm` (170). |
| `src/playback/scheduler.ts` | Words → clock; actions fire with the first word after them. `START_MS` 600, `RESUME_MS` 1000, `FLUSH_MS` 200. `actionLeadMs`: 450ms for everything but `clear`. |
| `src/playback/session.ts` | `AnswerSession`: stream → parser → scheduler; states idle/loading/playing/done/stopped/error; `done` waits for `idle()` (App passes `director.finale()`: last ink, then the scene overview). |
| `src/playback/director.ts` | `Director`: serial layout lane (scroll, sketch, clear, reveal, frame) + concurrent ink; `STAGGER_MS` 120, `ACTION_TIMEOUT_MS` 3000, `LAND_MS` 150, `backlog()` speed-up. Owns `registry` and `figures`. |
| `src/playback/parts.ts` | Answer parts from journeys (`isJourney`: \|Δpage\| > 1): glances (< 12 words) fold, a short lead-in joins part 1; `partAt`, `partTitle`. Journeys in the director (`journeyBeat`: a journey after the answer's first word; the opening move to the question's page has no beat): `onJourney`, `hold` (narration waits `JOURNEY_HOLD_MS` 800), `ARRIVAL_MS` 350 rest before the first mark. Highlights/underlines on pages grow to meaningful units (`src/locate/unit.ts`, `units: false` turns it off). Scheduler/session: `pause`, `resume`, `hold`, `seek` (clock `retime`). |
| `src/desk/types.ts` | Contracts: `DeskApi`, `DeskHost`, `TargetCtx`, `ElementPlan`, `BuildEnv`. Read this first. |
| `src/desk/Desk.ts` | The board: sections (`addRegion`, `growRegion`, `centreRegion`), split glide (`GLIDE_MS` 420), reveal/frameBoth, connectors overlay, follow, `reset` (new answer), `dismiss` (× / Esc). |
| `src/desk/elements.ts` | `buildElement`: dispatch → `draw()` switch per shape kind, `ref()` (label/emph/move/fade), `connect()`. Text sizes `BODY_REL`, `textPx`, `mathPx`. |
| `src/desk/kit/kit.ts` | Visual kit: `buildBlock`, `buildKitRef` (verbs), `KitStore` (per registry), `metrics()` sizing from body px, parts/`resolveKitPoints`. |
| `src/desk/kit/compute.ts` | Pure arithmetic: `parseVals`, windows, reductions, expansions. Every number on the board comes from here. |
| `src/desk/kit/layout.ts` | Pure block placement (`right=`/`below=`, body alignment, wrap at margin, op glyphs). |
| `src/desk/kit/anim.ts` | Tweens + `Ctl`: one state animation per block; a new state change fast-forwards the running one. |
| `src/desk/kit/text.ts` | Kit type (tabular numerals), canvas measure (estimate in jsdom). |
| `src/desk/layout.ts` | Pure window geometry: `frameFor` (reading/split/stacked), `boardLayout`, `bodyFraction`/`bodyPx`, framing (`frameInk`, `inView`), safe bands. |
| `src/desk/route.ts` | Connector routing around page content (`ContentMask`, `routeGutter`, `maskBlocker`); the board leg (`boardArrival`) arrives clear of board ink: at the target's side, else its top/bottom. |
| `src/script/parseScene.ts` | Board v2 tags: `node flow link note group pair merge` (+ `parseSplit`). Placement args via `sceneRel` (parseKit). |
| `src/desk/scene/scene.ts` | Board v2 things and verbs: `buildScene` (node, flow, note, group, pair, merge; `planLink` for links), `buildSceneRef` (emph/fade a chip, `move` by relation — kit blocks too —, `split`, `set` label/weight), `glide`. |
| `src/desk/scene/place.ts` | `placeRel`: candidates around the anchor, scored by overlap, distance, camera travel and what the line back to the anchor would cross; `near` grows toward the window's shape. Pure. |
| `src/desk/scene/route.ts` | `routeLink` (one quadratic, length-proportional bend, detours scored by content crossed and other links), `placeLabel` (clear of things, labels and the curve), `ribbon` (weighted link: capped, tapering). Pure. |
| `src/desk/scene/shapes.ts` | `lassoPath` (seeded loose outline around boxes), `bracketPath` (pair bracket on the side and label spot that cross least). Pure. |
| `src/desk/scene/camera.ts` | `camFor` (minimal pan / zoom ≥ `ZMIN` 0.62 to frame new ink), `overviewCam` (end of answer: the whole scene centred, zoom ≥ `ZOVER`). Pure. |
| `src/desk/scene/store.ts` | `SceneStore` (things by id, `alias` after a merge, `ofKind`), `anchorBox` (thing / part / kit block / element → world box), hooks `setKitResolver`, `setSceneLink` (kit → scene without an import cycle). |
| `src/desk/registry.ts` | Drawn elements of the answer (id → bbox/boxes/strokes), `ext()` for per-answer stores. |
| `src/desk/render.ts`, `math.ts`, `expr.ts`, `plot.ts`, `nudge.ts`, `follow.ts`, `runs.ts` | SVG text/dots/shade/emph; lazy KaTeX; safe expression parser (no eval); plot sampling; label nudging (≤ 3; a point label goes outside a closed shape it sits on: registry `outline`s of circles, boxes, shades); follow mode (rule 6); region text runs. |
| `src/ink/agent/*` | Stroke geometry (`strokes.ts`), pen motion (`animate.ts`, `PX_PER_SEC` 700), highlights/labels (`marks.ts`), CSS tokens (`tokens.ts`), line weights (`weights.ts`), pen cursor (`penCursor.ts`: a fixed nib on `document.body` placed via the stroke group's `getScreenCTM()`; `drawStrokes` and scene links call `penDown`/`penTo`/`penLift`; newest stroke wins, fades 400ms after the last lift; off under reduced motion, `?nopen`, or without `getScreenCTM`). |
| `src/locate/locateQuote.ts` | Quote (+ `near=`) → rects on the page's text runs. |
| `src/demo/demoScript.ts`, `src/demo/scripts.ts` | Hand-written scripts (`?demo=…`, `?script=kit|toolkit|relational|lec09|scene|scene-econ|scene-bio|moves`). |

## Board v2: one connected scene

`{{scene id=s near=pN}}` opens a scene section: an unbounded world (section units, y down) seen
through a camera (`Desk.makeScene`, `camFor`). A later `{{scene}}` (or a follow-up) continues the
newest scene. Nothing in a scene takes coordinates: every thing is placed by relation
(`right= left= above= below= beside= near=` a thing or a part) and claims its room
(`SceneSpace.claim`); later things are placed clear of all claims.

- **Things**: `node` (a chip, optional live `value=`), `flow` (chips `f[1]…`, `arrows`, `down`,
  `values=`), kit blocks placed by relation, `note` (text, or a callout with `annotate=`: a routed
  leader; it moves with what it annotates), `group of=a,b "name"` (a loose dashed outline, seeded,
  never a box; nested groups never touch; if the outline would swallow a non-member, the members
  first glide together), `pair from=a to=b "…"` (a bracket), `merge of=a,b "…"` (members glide into
  one new chip; `SceneStore.alias` makes references to them mean it, links re-route).
- **Links**: `link from= to= strength= "label"` — one quadratic, bend proportional to length (close
  neighbours nearly straight; arcs only for far things in one row), chosen among candidates by
  content crossed and closeness to other links. Labels go where they touch no thing, label or line
  (`placeLabel`). A weighted link is a filled ribbon, capped (≈ 3.7 px) and tapering toward its
  source. A kit block in a scene with `op=` (or the auto → of a computed block beside its source)
  gets a routed link from its source (glyph as its label) instead of a glyph in a gap.
- **Claims**: things claim their rect; labels claim `'label'`, link/leader/bracket stretches `'line'`
  (minor: never "the last thing"). Placement and labels keep off all claims; routers ignore `'line'`
  claims and line elements (`registry.obstacles(t, skip, solid=true)`), so a link crosses another
  line rather than loop around it.
- **Verbs**: `move id=x below=y` (things and kit blocks; a kit block glides inside a wrapper `g`
  and keeps `Block.shift` for world-space consumers: `worldBox` in kitEndBox, resolveKitPoints and
  the scene resolver), `split id=a "x" "y"`, `set id=a "label"`, `set id=l strength=…`. Every
  move calls the thing's `moved` hooks each frame: links re-route, groups re-fit, callouts follow.
- **Camera**: follows new ink (`frameScene` → `camFor`); after the last ink, `Desk.overview()`
  eases out to show the whole scene centred (`overviewCam`, zoom ≥ 0.62 so text stays readable).
- **Page connectors** into a scene: `Desk.route` passes the board's ink to `routeGutter`; a part's
  own block counts only to the left of the part, so the wire never cuts across its neighbours.

Demos: `?script=scene` (mechanics), `?script=scene-econ`, `?script=scene-bio` (fixture
`public/fixtures/bio.pdf`, `node --experimental-strip-types scripts/make-decks.ts bio`). Tests:
`tests/desk/sceneGeometry.test.ts` (routing, labels, ribbons, placement, lasso, bracket, overview,
grammar), `tests/desk/route.test.ts` (connector board leg).

## Bound numbers, readouts, demonstration moves (gated beats, step 2)

Prevention by construction: the narration never types a number the engine computes.

- **Value model** = `GateState` (`src/gate/engine.ts`): the engine's numbers, headless. Two users,
  one implementation: `ScriptParser` applies every parsed tag to it in stream order, and the commit
  gate replays recordings through it. `consts` are lowercase (the expression language lowercases
  names); `plotSrc` keeps plot tags so curves are recomputed with the current constants.
- **`{{val id=… fmt=1 as=percent|abs}}`** (`src/script/parseValues.ts`): the parser turns it into a
  caption word with the engine's value at that point of the stream (`GateState.say` → `src/values/say.ts`:
  the board's own `fmt`, plus a spoken form for TTS). It glues to touching text (`${{val id=c}}.` →
  `$4.5.`) and is chunk-independent. Refs: a block's single value, a calc, a part (`v[2]`, `g[1,2]`,
  `t[3].c` / `t[3].price`), a constant, a readout (`E`, `E.x`, `E.y`). **Unresolved → the caption shows
  `UNBOUND_TEXT` (an em dash), never a guessed number**; the director records the val as skipped
  (`unbound value …`) and the gate fails its beat. A val must come after what it names (no
  look-ahead: the parser resolves on the spot).
- **`{{find id=E of=…}}`** readouts (`src/values/readout.ts`, pure, used by the board's `KitStore.reading`
  and the model alike): `cross` (two plots on shared axes, `n=` the k-th), `level=`, `max`/`min`,
  `x=` (value), `x= slope`, `area from= to=` (under one plot or between two), and on a fit `inside=w`
  (count) / `residual` (RMS, or `residual=k` one point's). fn= plots are exact; parametric plots use a
  2000-step polyline. `x=`, `level=`, `from=`, `to=` may be formulas over constants. A find draws nothing.
- **Readout points**: `{{point on=s at=E "E"}}` is drawn by the kit (`buildReadoutPoint`) on the
  plot's layer with drop lines to both axes, and re-placed by `spreadLabels` whenever the plot redraws
  (widened axes, limit frames, beforeafter glide). `Figures.note` records find ids so `at=E` passes the
  resolver like a block part; `resolvePart` also resolves readouts (arrows, connectors).
- **Moves** (`MoveAction`; `of=<plot|computed block> <const>=<value>`):
  `contrast` is expanded by the parser (`GateState.expand`) into a copy with `with={k: v}`: a plot
  on the same axes (dashed, labelled `k = v` or the quote), a computed block `right=` the original
  (bars share one scale). `limit` (kit `limitMove`, `dur=` default 3s, `show=E`) settles the axes for
  the whole sweep, then tweens the constant: every plot and computed block drawn from it repaints each
  frame, readout points follow, a live readout (`k = 0.30 · E = 4.1`) sits above the plot; it ends on
  the value. `beforeafter` (kit `beforeAfter`) keeps the watched plot's old curve as a dashed ghost
  (labelled with the old value), tweens everything to the new constant, shades the band between old and
  new (bars: ghosts + changed bars accented; grids: changed cells tinted) and shows `k: a → b`. Both
  change the constant for the rest of the answer, as the value model does.
- **Gate** (`src/gate/check.ts`, `scripts/gate-beats/gateRun.ts`): `checkUnbound` flags a typed number
  that matches only computed values (page, question and literal matches pass; hedged numbers and
  small counts are exempt); an unresolved val is a `tag` flag; `checkOrder` flags a number equal to a
  constant's literal declared more than one beat later. `server/lint.ts` notes a formula or val naming
  a constant before its `{{const}}`.
- Demo: `?script=moves` (gallery scene `moves`): beforeafter on a market, contrast on a growing
  colony, limit on a falling stone with drag; every number in its narration is a val.
- Tests: `tests/values/values.test.ts`, `tests/gate/bound.test.ts`.

## How a tag becomes ink

1. `ScriptParser.push(chunk)` → `parseTag(body)` → `RawAction`.
2. `AnswerSession` calls `director.prefetch(raw)` at parse time (takes `let` names, warms text runs /
   KaTeX), then `Scheduler` fires `onAction(raw, at)` up to 450ms before its word (`at` = word start).
3. `Director.run`: layout actions resolve at once and queue on the serial lane (`execLayout`: sketch →
   `desk.addRegion`, scroll → `desk.scrollToPage`). Ink goes to `Director.ink()`.
4. `ink()`: page ink builds early (`buildsEarly`: anchor resolves while layout runs); waits for the
   layout queued before it (`afterLayout`) and for its target to be revealed; waits until `startAt`
   (word time + stagger); builds the rest (`figures.resolve` → `buildElement`).
5. `buildElement` → `ElementPlan {target, bbox, also?, draw(signal, pace)}`; connectors frame both
   ends (`desk.frameBoth`); `plan.draw` animates strokes/text. A string anywhere = skipped, with reason
   (shown in `?debug` and recorded by the eval).

## Invariants / contracts

- Every action carries `at`. Ink starts on its word; target-visible → ink-visible p90 ≤ 150ms.
- Layout is serial; ink never waits on earlier ink, only on the layout queued before it.
- Rule 1: strokes never split across a pan (`land()` before any view move).
- Skip, never guess: unknown mark/name/region, parallel `meet`, out-of-range page → skip with reason.
- Board sections scale as a whole; elements are never shifted individually. Sections persist across
  answers until × / Esc; `reset` (new answer) frees ids and connectors only.
- Bound numbers: the parser and the gate resolve `{{val}}` with the same `GateState`; the board's
  readouts with the same `src/values/readout.ts`. Never compute a readout or a val anywhere else.
- Kit: the model never writes a computed number; one state animation per block; reduced motion =
  discrete steps. Sections grow past 700 for tall kit content (`growRegion`, max 4×).
- Demo scripts use literals and must stay byte-identical through the resolver.
- Ids: region ids lowercase; element ids/point names case-sensitive (`'` → `′`).

## To change X, touch Y

- **New drawing tag**: `script/types.ts` (Shape) → `parseTag.ts` (case) → `server/lint.ts`
  `TAG_NAMES` → `desk/elements.ts` `draw()` case → teach it in `server/prompt/system.ts` (the prompt
  test requires every engine grammar piece to appear and parse; bump `PROMPT_VERSION`) → tests in
  `tests/script/parseTag*.test.ts`, `tests/desk/elements.test.ts`.
- **New kit block**: `KitBlock` + `KIT_BLOCKS` in types → `parseKit.ts` → `kit.ts` `buildBlock` (+ a
  `drawX`) → compute in `kit/compute.ts` → `lint.ts` → prompt kit card. Tests `tests/desk/kitBuild|kitCompute|kitLayout.test.ts`, `tests/script/parseKit.test.ts`.
- **New kit verb**: `KitVerb` + `KIT_VERBS` → `parseKitVerb` → `buildKitRef` switch in `kit.ts` → lint → prompt.
- **New op glyph**: `GLYPHS` in `parseKit.ts`, drawn by `drawOp` in `kit.ts`.
- **Timing/lead**: `actionLeadMs` (scheduler), `STAGGER_MS`/`backlog` (director), `PacedClock`.
- **Board sizing/type**: `desk/layout.ts` (`boardLayout`, `bodyPx`, `MIN_TEXT_PX` 12), `BODY_REL` in elements, `metrics()` in kit.
- **Connector routing**: `desk/route.ts`; `Desk.addConnector`.
- **New scene thing / verb**: `SceneShape` + `SCENE_KINDS` (types) → `parseScene.ts` (`SCENE_TAGS`) →
  `lint.ts` → `buildScene` / `buildSceneRef` (+ `isSceneRef`) in `scene/scene.ts`; pure geometry in
  `scene/{place,route,shapes}.ts` with tests in `tests/desk/sceneGeometry.test.ts` → prompt's SCENE card.

## Tests / commands

```bash
npx vitest run tests/script tests/playback tests/desk tests/geometry tests/ink tests/locate
npx vitest run tests/server/prompt.test.ts tests/server/examples.test.ts   # after any grammar change
npx tsc --noEmit && npx vitest run && npm run build
```
Visual check without API: `?script=kit`, `?script=toolkit`, `?script=relational`, `?demo=side`,
`?demo=plane` on your own dev port (not 5180/5181). Check Chrome and WebKit.

## Pitfalls

- A tag fires on the word *after* it; if no word follows for `FLUSH_MS` (200ms), it fires anyway.
- `RawAction` vs `Action`: ink is resolved at build time, not at fire time (fitted scales freeze on
  first build). Don't resolve early in new code paths.
- jsdom has no canvas/`getBBox`: text widths are estimated (`kit/text.ts`), so layout tests assert
  relations, not pixels.
- `lint.ts` `TAG_NAMES` is a hand copy of the parser's names: forget it and lint flags your tag.
- Adding grammar without teaching it in the prompt fails `prompt.test.ts` ("teaches every grammar
  piece"); teaching it with eval-deck words fails `EVAL_VOCAB`.
- Never draw under the caption dock; reveal before drawing; both connector ends on screen.
- `size=l` sketches switch the split to wide (0.4 : 0.6) while such a section is on the board.
