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
| `src/geometry/figure.ts` | One figure per target; `fit` sketches freeze their scale at first build: uniform (angles kept), or per axis once the sketch has `{{axes}}` (data); no magnification cap. |
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
through a camera (`Desk.makeScene`, `camFor`). A later `{{scene}}` with the same id (in this answer or a
follow-up) continues that scene; a new id starts a fresh scene section below (a revision), the old one untouched. Nothing in a scene takes coordinates: every thing is placed by relation
(`right= left= above= below= beside= near=` a thing or a part) and claims its room
(`SceneSpace.claim`); later things are placed clear of all claims.

- **Things**: `node` (a chip, optional live `value=`), `flow` (chips `f[1]…`, `arrows`, `down`,
  `values=`), kit blocks and engine plots placed by relation (a plot with no `axes=` host is placed by the scene, clear of every claim), `note` (text, or a callout with `annotate=`: a routed
  leader; it moves with what it annotates; `value=p[2]` adds a live value after its words, refreshed on `set`), `group of=a,b "name"` (a loose dashed outline, seeded,
  never a box; nested groups never touch; if the outline would swallow a non-member, the members
  first glide together), `pair from=a to=b "…"` (a bracket; `note` and `pair` also draw in a plain sketch, placed inside its frame clear of its ink: `flatSpace`, `placeRel` `inside`), `merge of=a,b "…"` (members glide into
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
  the scene resolver), `split id=a "x" "y"`, `set id=a "label"` (a node, a merged chip or flow parts `f[2]`, `f[1:2]`: the words cross-fade, the chip glides to its new width, squeezing the words between row neighbours, and flashes the accent; a link: the old words fade, the new ones are placed again by `placeLabel` clear of things, labels and the curve — a short straight link with no clear spot glides into an arc, as at creation —; a note: its words cross-fade in place; a kit block, in a scene or not: its caption, `setCaption` in kit.ts, squeezed to the block's width only when a neighbour sits beside it), `set id=l strength=…`. Once drawn is drawn: a set is a visible change, never an erase. Every
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
  names); `shares` are kept as the board shows them (normalised to sum to 1; `set` takes raw values); `plotSrc` keeps plot tags so curves are recomputed with the current constants.
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
  (count) / `residual` (RMS, or `residual=k` one point's).
- **`emph id=b where="x>=q"`** (kit `emphWhere`): every matching cell of a grid or table, bar, line point or
  share part takes the accent (a later where replaces the earlier marks). Besides `x` (the value), `r c i`
  (row, column, index), `where` reads constants, readouts (`find` E → its value) and one-value blocks (a
  calc's result), so a highlight selects by the engine's own threshold, never by hand. fn= plots are exact; parametric plots use a
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

## Live geometry: figures that move (`src/geometry/live.ts`, `src/desk/live.ts`)

A figure's numbers may be formulas over the answer's `{{const}}` names (expr.ts grammar); when a
constant changes, everything built from it is re-resolved and its ink updated in place, each frame.
- Grammar: a `let` (or any point arg) `S=R*cos(th),-R*sin(th)` (`xy` PtExpr: two formulas), `along(M,B,s)`
  (t a formula: `tSrc`); `circle`/`shade at= r=R`, `angle r=`, ray `len=` (`exprs` on the raw action,
  evaluated by the resolver); `write`/`label … "spin:" value=w fmt=1 unit=rad/s` (a live readout: the
  words, the formula's value, the unit); `point … trace` (a faint solid path stays behind it).
- `{{tween th=2*pi s=1 dur=6 ease=linear|inout|out repeat=n yoyo}}` (`TweenAction`, kit `tweenMove`):
  constants glide to formula targets over `dur` s per leg (default 3, cosine in-out: a yoyo is a true
  oscillation); `repeat` runs it n times, `yoyo` makes each run there-and-back (ends where it started).
  Plots and computed blocks repaint, live geometry follows. `limit` and `beforeafter` move geometry too.
- Formula constants follow: `{{const t=0 r=1.4-0.9*t I=3+4*r^2 w=L/I}}` — `KitStore.setConst` (and the
  value model) re-derive every formula constant reading a changed one (`C.rederive`, definition order).
  A constant set directly becomes an input. So a readout of `w` climbs while a tween drives `t`.
- Engine: `Figure` never caches a live name and reads constants on every resolve; `Figures.isLive(raw)`
  marks an element live; the director gives it an id (`_liveN`), draws it as usual, then `LiveGeo.add`.
  `KitStore.constsChanged()` → `LiveGeo.refresh()`: same paths get new `d`, dots new centres, text
  groups translate; labels keep their first side while clear, else their current side, else
  `placeClear` (never on a stroke); registry boxes/strokes/anchor follow. A frame that doesn't resolve
  keeps the last state. Reduced motion / fast-forward: the end state at once. The fit freezes from the
  initial values: keep the motion's reach inside the drawn figure (a reach circle, the orbit).
- Demos: `?script=moving-tunnel|moving-skater|moving-market|moving-pendulum` (gallery scenes of the same
  names). Tests: `tests/geometry/live.test.ts`, `tests/desk/live.test.ts`.

## Amounts, counts and distributions (teaching moves, design 3.2–3.7)

- **Chart plots are kit lines** (`buildChartPlot`): `{{plot p=N on=#c1}}` on a linear calibrated chart is
  a kit block on the page layer whose plot has the slide's fixed axes (`Plot.fixed`: no axes drawn, the
  domain never moves, labelled only by an explicit quote). So `{{find}}`, readout points
  (`{{point p=N on=#c1 at=E}}`: the resolver passes the ref through with `onChart`), `beforeafter`
  (readout top-left inside the chart, no ghost label), `limit` and `contrast` work on the slide's graph.
  Log axes fall back to the stroke path (`chartPlot`). The value model models chart plots (domain = the
  chart's x axis from its grounding); the live parser's `GateState` reads chart axes from the latest
  grounding the app built (`latestCharts` in `charts.ts`, set by `groundingOf`).
- **Stacked bars**: `{{bars on=s id=b vals=100;90,20 labels=before,after parts=room,tax stack}}` (ragged
  rows imply `stack`; cells may be formulas over constants): `vals` hold the totals, `Block.parts` the
  parts; `b[i]` is a total, `b[i,j]` a part; `set id=b[i,j] to=` moves a part and the total follows.
- **split**: `{{split id=b[2] vals=8-t,t "seller" "tax"}}` (kind `splitBar`; without `vals=` it is the
  scene's chip split). Parts must sum to the bar; one value fewer than names: the first part is what
  remains (`splitParts`).
- **tokens**: `{{tokens on=s id=k n=8 states=seller,tax "coins"}}`: marks in clusters by state (≤ 120);
  `{{set id=k[7:8] state=tax}}` or `{{set id=k state=tax n=t}}` glides marks to the other cluster;
  `{{val id=k.tax}}` is a count (`tokenMoves`, `tokenCount`).
- **histogram**: `{{bars on=s id=h hist=<block> bins=16}}` counts any block's values (its full computed
  values: a window's output before it is swept); `axes=<hist>` shares its bins (one x scale, own heights).
- **brace** is drawn as a bracket beside the segment (`bracketStroke`), on the side whose strip holds
  less ink and page text (`bracketSide`), the label beyond its notch.
- Demos: `?script=canvas` (chart readout + beforeafter on the slide), `?script=kit` sections 9–11.
  Tests: `tests/values/chartValues.test.ts`, `tests/desk/kitStack|kitTokens|kitMovesNew.test.ts`,
  `tests/ink/bracket.test.ts`.

## Expressions and computed data

`src/desk/expr.ts` (no eval) reads a name as `[A-Za-z][A-Za-z0-9_]*`, lowercased (`K2`, `n10`, `T0`,
`rate0` are names; only a digit-leading term multiplies: `2x` = 2·x, `x2` is a name). `if(c, a, b)` is
`a` when `c` ≠ 0, else `b`. `integral(f, a, b)` is ∫ₐᵇ f dt over `t`, and `integral(f, u, a, b)` names
the variable (it shadows any outer name inside `f`; outer names such as `x` and constants stay
visible): tanh-sinh quadrature, ~1e-10 on smooth integrands, never evaluates the ends (so `1/sqrt(t)`
from 0 works), NaN when it can't converge. So a curve defined by an integral is an engine plot:
`plot fn="2/pi*integral(1/sqrt(1-sin(rad(x)/2)^2*sin(t)^2), 0, pi/2)" domain=0,170` is the true
pendulum period over T₀ (1.0732 at 60°). `calc of=v reduce=quantile q=0.9` is the ⌈q·n⌉-th smallest
value (a value of the data, as a conformal q̂ is; `q=90` reads as 0.9; default 0.5). Constants reach
every formula path: kit maps, generated data, plots on hand-drawn `{{axes}}`, and `vals=` / table
cells written as formulas (`vals=z*sigma/sqrt(n10),…`, `vals=a`; resolved when the block builds; a
missing name is a skip naming it). Plots break only at real poles (`breakPoles` in `plot.ts`: a sign
change or a local max of |y| that blows up when refined between neighbours), so a narrow peak is
drawn whole. Computed data is computed in full up to `MAX_CELLS` (200 000 cells; past it a skip names
the limit) and a big image shows decimated (≤ `MAX_IMG` squares a side, each the mean of its cells);
literal vals / tables / labels take up to `MAX_LIT` (40) rows and columns; a `fn=` window names its
cells a…z (≤ 26, a skip says so), a `reduce=` window may be any size.

## The slide as canvas (spec "The slide is part of the canvas")

Work on the slide and from it, rather than drawing a disconnected copy.

- **Calibrated charts** (`src/agent/context/charts.ts`: `Chart`, `ChartAxis`, `chartToPage`): the grounding
  lists `#c1 chart …` with its axes; `groundingOf` resolves `#cN` to `{kind:'chart', rect, x, y}`.
  `p=N on=#cN` on line/arrow/point/circle/label/curve/shade/angle/brace/plot/note/let: points are data
  values (parser: unclamped, `chart` on the action). The resolver keeps one figure per chart (world =
  data; page marks read back through the inverse map) and maps every point to the page; an unknown
  chart skips. A chart plot gets `onChart` (axes + rect), its domain defaults to the x axis and values
  off the y axis are cut (`chartPlot` in elements.ts, sampled by the kit's `samplePlot` with `{{const}}`s).
- **Lift** `{{lift p=4 mark=#g1|box=x,y,w,h on=s id=fig at= w=}}`: the resolver places it (`placeLift`:
  page proportions, inside the 1000 × 700 section; plain sketches only, not `fit`) and records it; a
  page mark used later in that section (`from=#d2`, `at=#b1`) resolves through the latest lift that
  holds it (`onLift`). The board draws a crisp pdf.js crop (`DeskHost.crop` → `PageRenderer.crop`,
  2.5 device px per CSS px, transparent ground) in a sheet slot behind later ink, fading in;
  `move id=fig to=x,y` glides it (by its centre). Raster only (a vector copy is open).
- **Page notes** `{{note p=4 "…" annotate=#e2|"quote"}}` (or `on=#c1 at=x,y`) → kind `annot`: the resolver
  turns a mark into its rect and attaches `Grounding.obstacles(page)` (text lines + rect marks); the
  board places it with `placeNote` (`src/desk/annotate.ts`, pure: right/left first, then around, then
  the margins; never touching text, figures or earlier ink; a leader when apart; no room → skipped).
- **Gate**: `checkPageText` (page annotations never cover page text lines), `lift-outside` in
  `checkLayout`. Demo `?script=canvas` on `public/fixtures/canvas.pdf` (`make-decks.ts canvas`: econ p12,
  bio p4, mechanics p2); gallery scene `canvas`. Tests: `tests/script/parseCanvas.test.ts`,
  `tests/geometry/canvas.test.ts`, `tests/desk/annotate.test.ts`, `tests/gate/canvas.test.ts`.

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

## Forgiven slips (skip, never guess)

Small slips whose intent is unambiguous are read as meant; anything ambiguous stays a skip, and
`server/lint.ts` says what to write instead.
- Parser (`tokenize.ts`, `pointExpr.ts`, `parseTag.ts`, `parseKit.ts`, `parser.ts`): a point key
  missing its `=` (`from=Ps to Pb`: only a point key of that tag, followed by a bare value that is
  no flag word); a literal in one pair of parentheses (`at=(0,-150)`); a connector end that is a
  construction (`to=w:mid(A,B)`); plot `axes=` without `domain=` takes the host plot's domain;
  `{{val id=p.y x=0}}` expands into `{{find … x=0}}`; `vals=<block id>` is `map=<id> fn="x"` (a
  constant's name is left to the constants path); `op=<one-block op> vals=<literals>` applies the op
  (shares normalise anyway); `{{arc center=P from=D to=B}}` is an angle whose radius reaches D and
  B — the resolver draws it only when |PD| = |PB| (±2%) and D, B are less than a half turn apart.
- Resolver: `highlight`/`underline` on a mark with no words boxes it / runs a line under it.
- Director: a connector naming a section a later tag declares waits for it (≤ `REGION_WAIT_MS`).
- Board: `emph` on a section id flashes a frame around its ink (`fade` on one skips: which
  elements?); `bars axes=<bar chart>` draws bars on that chart's y scale.
- Stay drops: two columns in `vals=` (lint: map= or two blocks), a tag over 800 characters (lint:
  a hand curve should be `plot fn=`), a half-turn or unequal arc, quotes of equations a page draws
  as outlines (no text to find: the model should use `mark=#eN`).

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
