# petu learning engine: from posters to computed, steppable explanations

*Design recommendation for the founders. Plain language first (sections 1, 2 and the start of 3), technical detail after.*

---

## 0. Revision after founder review (2026-11-04)

Two decisions change the design. Everything below this section stands unless it conflicts with them.

**1. A flexible canvas.** The board becomes a free canvas a teacher would use. Derivations
("take a slice dx: dm = λ dx, dI = x² dm, I = ∫ x² dm"), worked arithmetic, equations, arrows, side
sketches and short hand-written-style annotations are all allowed, anywhere on the board. This
replaces the labels-only rule (p6.8) and decision 1 in section 7.

The one thing still removed is paragraph prose: whole sentences or lists of sentences, the
"random lines of text" from the 2026-10-31 complaint. The voice keeps the reasoning, the board keeps
the working. `prose.ts` already treats math lines as non-prose, because it counts only runs of
letters. The change is mostly in the prompt, plus math rendering for derivation lines, using the
KaTeX the board already loads lazily.

**2. Numbers come from programs.** Every computed number, on the board or in speech, comes from code
the engine runs, never from the model's head. The model writes a small `<calc>` program. It is plain
JavaScript-style code, run in a sandbox (a Web Worker with no DOM and no network, with a step and time
cap; QuickJS-in-wasm if we need stronger isolation). The program exports named values, arrays and
step traces. This replaces the 120-character formula language as the place where arithmetic lives,
so any calculation a student can bring is computable: loops, sorting, matrices, recurrences, numeric
integration, statistics. A `<proc>` step rule (section 3) is just a calc function.

```
<calc id="rod">
  const M = 1, L = 1;
  const slices = n => { let I = 0; for (let i = 0; i < n; i++) { const x = -L/2 + (i + .5) * L/n; I += x*x * M/n; } return I; };
  export const I4 = slices(4), I10 = slices(10), I100 = slices(100);
  export const exact = M*L*L/12;
</calc>
```

The board and the narration refer to the results by name: a derivation line `I ≈ {rod.I4}`, and in
speech "with four slices the sum is {{val rod.I4}}". The engine fills in the numbers.

**What "not strict" means for checking.** Today the gate drops a whole sentence when a number
doesn't check. Instead:

- A typed number that a program computes is **replaced** with the program's value, not dropped.
- A number the page or the question gives (a slide's pixel values, "478 + 356") is accepted as data.
- Anything else is drawn and noted in the eval log, not hidden from the student.

Dropping is kept only for a calc that fails to run, and that goes to repair first.

**Built so far (Phase 1, round 10).** The calc sandbox and wire, steps on a constant, step back, three
hand-written demos, prompt p6.18–p6.23 and scout s2.13. The engine-owned sliding window (`data-slide`,
`src/svgboard/slide.ts`): the model writes the data in a calc and the step tweens; the engine lays out
input, kernel (and the turned kernel for convolution) and output, moves the frame, fills each output and
writes its working, and registers the outputs as `<id>.out` for `{{val}}`. Repairs (r3): a calc a repair
writes is run before its beat is checked, and the note shows a calc that ran by its value names. Open items:

- ~~A model-written frame computes its own x~~: done, the engine window (`data-slide`) owns the frame.
- `grounded()` accepts any typed number equal to any calc export: §0 said replace, this only accepts.
- ~~A `<calc>` inside a repaired beat is not run~~: done (the gate's `calcs` hook, repair note r3).
- STEPS use is measured on single answers so far; sample the same question several times before claims.

**Phase 1 evaluation, automated part (2026-11-05, p6.23, gpt-6.1-terra, no judge).** Question set
`teach` (`scripts/eval/teach.ts`: the plan's filtering, median, correlation-vs-convolution, 5x5 convolution,
addition and rod questions, plus two unseen: a standard deviation and a Riemann sum), 3 samples each,
table by `scripts/eval/teachReport.ts`.

| | round 1 (24 answers) | rerun D2, D4 after fixes (6) |
|---|---|---|
| answers with a calc | 16 | 6 |
| calcs that failed to run | 0 of 16 | 0 of 6 |
| numerals typed in the narration | 0 | 0 |
| gate number flags | 0 | 0 |
| answers that stepped / engine windows | 8 / 8 | 6 / 6 |
| beats dropped | 10 | 3 |
| median first word | 2.0 s | 1.8 s |
| mean cost per answer | $0.016 | $0.010 |

- Spoken numbers spot-checked: the standard deviation (mean 5, squared deviations 32, σ 2, s 2.14), the
  rectangle sums (0.4688, 0.3984) and the output sizes (3×3 / 5×5 / 7×7) are right.
- Round 1's drops were mostly two engine bugs, fixed since: a window's outputs lost their rows when the
  window fit one row down (and a one-row matrix lost its rows on the wire), and a dropped beat took its
  calc with it, so every later beat failed on "no calc img".
- What is left: the model sometimes says a window's output before drawing the window (the beat is
  dropped, correctly), and names a readout id it never gave (`{{val id=result}}`).
- The addition question (D5) on `examples.pdf` is refused as off the document every time: that page has
  no arithmetic, so the refusal is right and D5 measures nothing. The rod (D6) and one Riemann answer use
  constant formulas instead of a calc: still engine-computed, not typed.
- Not done (founder work): the ChatGPT arm, the human rubric and the learning check.

**Phase 2 built so far (2026-11-05, branch `iter/r11`).**

- **Seek-to-state for free SVG.** A seek back hides the svg groups drawn after the target (kept, not
  erased) and they show again on their words, with a short fade, never drawn twice; windows and tweens
  rewind as before. Verified in the rod demo. I1 now reads: page ink stays; the board follows the words.
- **Holds at step boundaries.** A sentence a process step moved in (a tween, a window's step or sweep)
  ends on a 700 ms hold (`STEP_HOLD_MS`), after the sentence, not before it; measured 1.4 s between
  words after "…the sum is 6." against 0.32 s elsewhere. The gate's length budget counts each hold.
- **The data bridge.** Already there: a free readout reads an engine window's outputs
  (`data-val="conv.out[0][0]"`); now under test.
- **Re-explain this step.** E (once a step has played) opens an aside: "Explain the step on the board
  again, more slowly…". Every aside now carries the board's computed numbers and step constants. Live on
  lec06: the aside drew the window the frame was on ([2,3,4 / 3,4,5 / 4,5,6]) and said where the turned
  kernel's 1 lands, from those numbers.
- **Gate check (c), one dataset.** A second engine window over another input is noted (failed under
  `&gatecheck=all`) until its precision is measured.
- **Eval after Phase 2** (teach, 2 samples each, 16 answers): 12 calcs, 0 failed; 0 typed numerals and
  0 gate number flags; 1 beat dropped (10 in round 1's 24); median first word 2.0 s; $0.016 an answer;
  no one-dataset notes. The drop was "x: …, y: …" in a data-set (commas for semicolons), now accepted.
- Not built: (f) conventions needs a conventions line from the scout first; the prediction prompt is
  optional and waits on the pacing decision in §7.

**Phase 3 built so far (2026-11-05, branch `iter/r12`).**

- **Raster on the student's own slide image.** A window may slide over a picture on the page by its mark:
  `data-slide="#i1"` (the mark the page listing already gives; `data-px` columns, default 24, at most 40;
  `data-page` when not the answer's page). The app reads the PDF image object's own bytes (not a render
  of the page), turns them into whole gray levels by block averages with integer luma (`src/pixels/gray.ts`),
  and puts them into the answer as a computed table (`{{computed id=px_i1_24 f=…}}`) just before the svg
  tag (`src/pixels/stream.ts`). From there they are ordinary calc data: the gate's shadow board, step back
  and a replay of the recorded answer read the same integers without the PDF. The node replay reads the
  same bytes (`scripts/lib/pixels.ts`); browser and node agree to the integer on the lec06 eye.
- **The picture view.** An input over 12 cells wide or tall is drawn as pixels, not numerals: the shaded
  input and output (one path per gray level, so a 24×24 picture is a few dozen elements), the frame on the
  input, the output pixel under the window's centre, and below them a zoom row with the window's real
  values, the kernel (turned for convolution) and the result, plus the working. Outputs are whole levels
  unless `data-fmt` asks for decimals. Demo `?script=eye-proc`: the box blur over the eye on slide 16
  ends on an output that matches the slide's own blurred picture.
- Prompts p6.24–p6.25 tell the model about the page-image form, in the WINDOWS paragraph.
- **Eval** (teach, lec06 questions D1–D4 plus two new ones on the eye slides: D9 "show me how this box
  filter blurs the eye, pixel by pixel" on p15, D10 "what will this kernel do to the image?" on p13; 2 samples
  each, no judge). On p6.24 the model never used the picture: D9 built a made-up 3×6 patch and said it was
  "not measured eye pixels". p6.25 (and "pixels readable" on image marks in the page listing) fixed that, and
  exposed a gate bug: the gate's segmenter took a 24×24 table (~2.3k characters) for narration, so every
  picture window was dropped (17 drops in 6 answers). With the segmenter fixed: 12 answers, 0 drops,
  0 failed calcs, 0 typed numerals and 0 gate number flags; D9 and D10 used the slide's picture in 4 of 4
  (D10 unprompted: it read the shift off the real eye, output = image[m, n+1] = 108); D1–D4 unchanged in
  kind; median first word 1.8 s; $0.014 an answer.
- Seen live and fixed: a model's data-cell pushed the output off the board (the engine now shrinks the
  pixels to fit). Seen, not fixed: the model wrote its own label over the picture (D10).
- **Moot:** "slices and eqchain made the default" is covered by §0's free canvas and calc.
- Not built: the plot view, the grid-fill pattern and the data-literal inspector (no eval question
  needs them yet); (f) conventions and the prediction prompt, as in Phase 2.

**Effect on the plan.** Phase 1 adds the calc sandbox and derivation rendering. The
`expr.ts` list extensions in section 5 shrink to what the engine needs for drawing; arithmetic moves
into calc. Phase 1 grows by one to two days.

---

## 1. What is wrong today, and why

### What you saw

You asked petu to "explain the different filtering techniques in this PDF" on lec06_conv. The board came out as a static poster: a row of pixels, then small kernel boxes with arrows pointing to results (correlation 90, convolution -90, box 60, Gaussian 67.5, sharpening 90+30=120, median 90). Nothing moved over the pixels. You could not see where any number came from. Each example quietly used a different set of pixels, and the "smooth derivative" sketch was labelled wrong.

Every one of those numbers is arithmetically reachable. 67.5 is correct for the pixels (0, 90, 90) with weights 1/4, 1/2, 1/4. But none of them can be traced back to pixels the student can see:

- Box, Gaussian and sharpen assume the neighbourhood (0, 90, 90). The median uses (90, 90, 180), where box would give 120 and Gaussian 112.5.
- The poster did draw the flipped kernel ([-1, 1] vs [1, -1]), but its only example is a derivative kernel, where flipping happens to equal negating (90 vs -90). A student easily takes away "convolution flips the sign". What the deck teaches (slide 5) is that convolution flips the kernel. For symmetric kernels (box, Gaussian, median window) correlation and convolution give the same result. For an asymmetric kernel the flip changes the direction of the effect. Slide 13's shift kernel shows this: correlation shifts the image left, convolution shifts it right. This is the biggest teaching gap, and better animation alone would not fix it.
- The sharpening example mixed a 1D 3-tap mean with slide 17's 2D 3x3 kernel.
- The median example ignored the slide's own patch (slide 33, where the answer is 27).

### Why it happened: the format, not the model

The model is not weak here. The board's format cannot express what you asked for.

1. **There is no data, only drawings.** The board knows scalars and smooth curves. It has no arrays, no "cell i", no window. Each picture types its own numbers, so nothing forces six filters to share one input.
2. **Nothing changes step by step.** The rule is "once drawn is drawn". A beat can add a group, but it cannot move a window from position 1 to 2 to 3. Only a single smooth number can animate.
3. **Going back does not rewind the board.** Seeking back re-speaks the words, but the scheduler deliberately does not redraw ("actions already fired are not fired again").
4. **Motion ignores pause and speed.** Tweens and the old kit sweeps run on wall-clock time, so the 0.75 to 1.5x setting and pause do not reach them.
5. **The checker only takes notes on typed numbers.** The gate fails a typed number only if it sits beside an engine readout and is within 15% of it. Everything else is a note, so the inconsistent poster passed.
6. **Derivations are banned on the board.** The labels-only rule, enforced in the prompt and in `src/svgboard/prose.ts`, forbids a teacher's "take a slice dx, write dm, write dI, integrate". This was a deliberate product choice made after complaints about random prose on the board. It is in section 7 for you to decide.

Notably, petu once had a working moving window. The old tag kit (`src/desk/kit/compute.ts`, `kit.ts winGo/stepOrSweep`) glides a window frame over cells, writes out "1·90 + 0·60 + (-1)·30 = 60", fills the output cells one by one, and the gate checks those numbers. Prompt p6.0 replaced the kit with free SVG, and the prompt that taught the kit was deleted on 2026-11-01. The demo still runs at `?script=kit`. The write-up that justified the switch (`live-vs-demo-boards.md`) is not in the repo, so we cannot check what was measured.

**Root cause in one sentence:** we ask one model to do the computation, the layout and the animation in a single pass of hand-written SVG, and the format has no notion of data, steps or replay.

---

## 2. What the research says

Here is what the research says, briefly. The evidence agrees with itself to an unusual degree.

- **Split "what happens" from "how it is drawn."** In ALGOGEN, the LLM writes a small tracker that emits states, and a deterministic renderer draws them. It succeeded on 99.8% of 200 tasks, against 82.5% for end-to-end generation ([arXiv 2605.12159](https://arxiv.org/abs/2605.12159)). PAL hands arithmetic to an interpreter, a +15% absolute gain on GSM8K ([arXiv 2211.10435](https://arxiv.org/abs/2211.10435)). Khanmigo now uses a calculator rather than predicting numbers ([Khan Academy blog](https://blog.khanacademy.org/why-were-deeply-invested-in-making-ai-better-at-math-tutoring-and-what-weve-been-up-to-lately/)).
- **LLM-written demos look right and are wrong.** In InteractScience, the controls worked more than 85% of the time, yet 53% of inspected demos had logic errors and 48% had numeric errors ([arXiv 2510.09724](https://arxiv.org/html/2510.09724v2)). That is our poster, generalized.
- **Layout is the main failure of LLM-drawn animation**, more than code that doesn't run ([OmniManim](https://arxiv.org/html/2605.15585), [TheoremExplainAgent](https://arxiv.org/html/2502.19400v2)). The fix that works is the engine owning placement ([Penrose](https://penrose.cs.cmu.edu/docs/ref), [FEYNMAN](https://arxiv.org/html/2603.12597)).
- **"Experts": a strong planner and good examples matter. Agent personas do not.** In Code2Video's ablation, removing the planner cost 41.5 quiz points, removing retrieved references cost 30, and removing the critic cost 21 ([arXiv 2510.01174](https://arxiv.org/html/2510.01174v1)). EduVisAgent's "experts" are a fixed sequence ([arXiv 2505.16832](https://arxiv.org/html/2505.16832v2)). No paper we read shows dynamic routing to experts beating a fixed pipeline. Every Manim-style agent runs offline, from 72 s to tens of minutes per video.
- **Vision models cannot check geometry.** They score about 57% on line intersections ([BlindTest](https://arxiv.org/html/2407.06581v4)). Checks on the critical path must be programmatic.
- **Replay needs each frame to be a function of state.** Examples are Remotion's frame model ([docs](https://www.remotion.dev/docs/the-fundamentals)) and GSAP's seek/timeScale/reverse ([docs](https://gsap.com/docs/v3/GSAP/Timeline/)). Generator-style scenes "can't be reset" ([Motion Canvas](https://motioncanvas.io/docs/flow)).
- **Pedagogy.**
  - Animation on its own gives small gains: d=0.37 (Höffler & Leutner, [abstract](https://www.leibniz-ipn.de/en/research/publications/instructional-animation-versus-static-pictures-a-meta-analysis)) and g=0.23 (Berney & Betrancourt, [PDF](https://tecfa.unige.ch/perso/sandra/pdf/Earli2016_berney_betrancourt_FINAL.pdf)). The gains are smallest for formal notation, which is exactly what convolution arithmetic is.
  - People understand processes as discrete steps. Steps that stay on screen can be compared, while animations are "fleeting" (Tversky et al., [PDF](https://hci.stanford.edu/courses/cs448b/papers/Tversky_AnimationFacilitate_IJHCS02.pdf)).
  - The pacing evidence conflicts. System-paced animation beat learner-paced in one meta-analysis. Learner control helped transfer in another study but took far longer, and many students ignored the controls ([Tabbers & de Koeijer](https://repub.eur.nl/pub/21233/20100907-271.pdf)).
  - Segmenting into user-paced steps helps ([Mayer, segmenting](https://www.cambridge.org/core/books/multimedia-learning/segmenting-principle/37240877DDA0362355ADB39936027982)). So do worked examples that fade (full arithmetic first, then results only; [summary](https://en.wikipedia.org/wiki/Worked-example_effect)) and concreteness fading (concrete numbers, then a picture, then the formula; [summary](https://www.learningandthebrain.com/blog/?p=5200)).
  - Watching a diagram build up helps only if the build-up marks the structure in sync with narration (Fiorella, [PDF](https://escholarship.org/content/qt55v7s9t1/qt55v7s9t1_noSplash_87418a79f71257344483b22e7c67c540.pdf?t=prk1a3)).
  - Caveat: Mayer & Chandler (2001) and Rey et al. (2019) were seen only via search snippets or from prior knowledge, and were not re-read for this report.
- **What we found no study for.** "Stay grounded in the student's own slides" has no direct study. Our grounding rules are derived from the pre-training, coherence, signaling and concreteness-fading principles.

**What this means for petu:**

- The model declares the data and the rule.
- The engine computes every number, places everything and owns the timeline.
- Checks are code, not a vision model.
- Pace and going back are playback, not regeneration.
- The explanation proceeds in discrete stops: worked fully at first, faded afterwards, with the trace staying on screen.

---

## 3. The recommended architecture

### 3.1 The idea in plain language

When an explanation involves a process (a window sliding, a carry moving left, slices adding up to an integral, an algorithm iterating), the model stops drawing it. It writes a short **process declaration**, which we call a `<proc>`, with five parts:

- the input data, copied from the slide (with the page it came from);
- the state being tracked (an output row, a carry digit, a running sum);
- the order of steps (left to right, right to left, until something is zero);
- the rule applied at each step, in petu's existing formula language plus arrays;
- which standard views to show it with (cells, a window frame, the multiply-and-add line, the output row, a carry register, a sort, slices).

The browser runs that rule step by step into a list of states (a "trace"). It draws each state with fixed, engine-owned views and lays them out itself. Every number the student sees or hears is computed. The narration points at steps ("slide one cell: {{step box 2}} ..."), so the window moves when the words say it does.

Because the board is now a function of (beat, step), these all happen in the browser without calling the model:

- pause;
- 0.75 to 1.5x speed;
- step forward or back;
- replay a step.

**A correction to the "regenerate when I go back" idea.** Going back should replay, which is exact, instant and free. A new model call happens only when the student asks something new at a step, such as "why is it flipped here?" or "what if the kernel were [1,2,1]?". That call receives the board's state at that step. The UI should keep these as two separate buttons: **Back** and **Re-explain this step**.

**The "experts" question.** We recommend against a cast of specialist LLM agents. The research does not support it, and the clock and the budget rule it out:

- a serial specialist call adds 2 to 4 s before the first word, against a 2 to 3 s target;
- a parallel specialist call roughly doubles the cost of about half a cent per answer and arrives after stage 2 has already started;
- vision critics are unreliable at geometry.

The expertise that matters in petu lives in three places, all inside the existing two-call pipeline:

1. **The planner** (today's scout). It reads the pages, lifts the slide's own example numbers and conventions, and picks the shape of the explanation.
2. **The engine.** It contains deterministic compute and views (the window maths that already exists, plus carry, sort, slices and so on), along with small exemplar packs showing the model how to use each pattern.
3. **The verifier** (today's gate, made strict). It checks every number against the trace and every input against the page text.

The pipeline is fixed. What changes per question is the data, the rule and the examples the model is shown.

### 3.2 Components and data flow

```
question
  -> SCOUT (planner, existing call, streams while opener is spoken)
       route, pages, opener, plan + NEW: DATA (slide numbers with page cites),
       CONV (conventions), pattern hint
  -> STAGE 2 (existing single streaming call, plan first)
       hidden <plan>, then beats; a beat is EITHER a free <g> (static picture)
       OR a <proc/> (process) + 1-3 sentences with {{step}}/{{run}}/{{val}}
  -> svgBeats.ts (existing: lifts each top-level element when it closes;
       NEW branch: <proc> -> {{proc ...}} wire tag)
  -> CLIENT
       proc/run.ts    : executes the rule -> trace state[0..n] with expansions
       proc/views/*   : engine-owned renderers, engine-owned layout in plan regions
       data bridge    : state[k] exported into DataScope -> free <g> groups bound
                        with data-val / data-set follow the step too
       step clock     : InkTime x settings.speed; idempotent setStep actions
       GATE (shadow)  : runs the same proc headlessly before release;
                        spoken numbers vs trace, inputs vs page text, one dataset,
                        strict typed numbers, structural checks
```

### 3.3 What the model writes and what the engine computes

| The model writes | The engine computes |
|---|---|
| Input literals copied from the slide (`src="p33"`), or a flagged invented example | Every window value, product, sum, sort, median, output cell, carry, partial sum |
| State names, step order, the per-step rule (expression language plus arrays) | The visible expansion line ("1/3·10 + 1/3·10 + 1/3·100 = 40"), from the same code that produced the value |
| Required convention fields: `pad`, `flip`, `origin` | Padded ghost cells per boundary mode |
| Which views, and which plan region they go in | All positions, sizes and layout inside that region |
| Narration, with `{{step}}` anchors and `{{val}}` for every spoken number | The window glide, the fills and holds, timed on the narration clock |
| Optional free `<g>` for static pictures or one-off sketches | Re-resolving bound free SVG at every step (data bridge) |

The model never writes coordinates for computed parts, and it never writes a computed number.

### 3.4 Playback and student controls

- **Default pacing follows the research.** The tutor sets the pace within a step. The engine holds briefly (600 to 800 ms) at landmark steps and at the end of each process beat, and the student may stay there. Playback then continues on its own.
- **Controls** sit next to today's `stepPart`/`replaySentence` in `App.tsx`: pause, step back, step forward, replay this step, and the existing 0.75/1/1.25/1.5x setting, which now also applies to motion. A continuous scrub bar is not in v1. The research does not back it as a primary control, and it is expensive to build.
- **Fading.** Narrated steps are fully worked. `{{run box to=8 per=0.5}}` advances silently with results only (Renkl-style fading). The pacing budget in `src/agent/pacing.ts` counts run time.
- **Seek.** Proc actions become an idempotent class, `setStep(proc, k)`. On any seek, the scheduler computes each proc's target step from the word it lands on and sets that step directly. Going back redraws the earlier state exactly. From phase 2, free SVG groups released after the seek point are hidden, not deleted. Invariant I1 becomes "released ink is never withdrawn from the record; the view follows (beat, step)".
- **Prediction (phase 2, optional, at most once per answer).** After two worked positions the engine asks: "Where does the window go next, and what will it output?" The student answers, then the next step is revealed. It can be skipped.
- **What-if without the model (later).** The student edits a kernel weight in an inspector, and the trace recomputes instantly.

### 3.5 Streaming and latency

- A `<proc/>` is self-closing, uses attributes only, and runs 150 to 400 characters. Today's first groups are 1 to 1.6k characters, which p6.12 found pushes the first word to 5.5 to 7.8 s. So the first process beat closes sooner than a hand-drawn group. Plan-first and the scout opener still cover the plan's writing time.
- Step 1 draws while later beats are still being written. A trace takes microseconds to milliseconds to compute (capped at 120 steps and 200 cells per array).
- There are no new model calls. The scout grows by about 30 to 80 output tokens. Stage 2's output shrinks, because short procs replace hand-drawn grids. Exemplar packs add about 300 to 600 uncached input tokens in the user turn, roughly +$0.0003 to $0.0006. The expected total is about $0.0055 per answer.

### 3.6 Verification (deterministic, in the existing gate)

GateState gains a proc branch next to its existing `computeSource` calls. Before releasing a beat, it runs the proc headlessly with the same code the screen uses and checks:

- **(a) Spoken numbers.** Every spoken number or `{{val}}` matches a trace value at the step anchored at or before it.
- **(b) Inputs.** The input literals appear in the cited page's extracted text, or the proc is marked `src="invented"` and carries a visible "example, not from your slides" chip.
- **(c) One dataset.** Procs that compare operators share one input, via `like=` or the same data name, unless the plan declares a second example.
- **(d) Strict typed numbers.** On a board that declares data, a typed number in free SVG that is not a trace value **fails**, instead of being noted. This tightens `grounded()` in `src/svgboard/check.ts`, which is how the poster got through.
- **(e) Structure.** Views, step targets and index ranges exist. Out-of-range reads produce data-bad, which means the item is hidden and flagged ("skip, never guess").
- **(f) Conventions.** A proc whose dimension or kernel differs from the slide its `src` cites is flagged. An example is a 1D mean labelled as slide 17's 3x3 sharpen.

Failures go to the existing repair path (`server/repair.ts`: at most 2 repairs, 450 tokens each), with precise messages such as "r[10] out of range (len 10)". Whole-beat release, HEADROOM_MS 6000 and MIN_REPAIR_MS are unchanged. A vision critic runs only in offline evals.

### 3.7 Grounding: "based on the PDF, explained our way," made checkable

1. **Data comes from the page.** The scout's DATA line lifts the slide's numbers with page cites: for this deck, the slide-33 patch, slide 26's [1 2 1], slide 13's shift kernel, slide 17's sharpen kernel. Check (b) enforces it.
2. **Conventions come from the deck.** The CONV line records them. For example, this deck writes correlation with `*` and its formula on slide 5 is correlation. The view labels and glyphs come from these fields, not from free text.
3. **Invented examples are labelled.** When the slide has no numbers, or a better-suited example is needed (a 1D row with a spike and a step shows why the median helps), the planner invents one, says why in the plan, and the board carries the chip.
4. **Point back to the slide.** At each landmark the existing highlight re-points at the slide line or formula being unpacked. The terms of slide 5's formula link to the cells under the window, so the board reads as "the slide, unpacked".
5. **"Our way"** means three things: the order of the explanation (concrete numbers, then the moving window, then the slide's general formula), the choice of example, and the visual. It never means content the deck lacks. Anything beyond the slides is tagged "beyond your slides".
6. **Broad questions get triage.** "Explain the different filtering techniques" covers about 15 techniques in 92 slides. A 60 s answer gets: a 10-second map, one deep demonstration on shared data, one punchline contrast, then follow-ups offered.

### 3.8 The convolution case, written out

Scout plan fields (inside its 100-word plan):

```
DATA r=[10,10,10,100,10,10,70,70,70,70] invented (deck has no 1D spike+step row);
     P=[[10,15,20],[23,90,27],[33,31,30]] p33; w121=[1,2,1]/4 p26; shift=[0,0,1] p13
CONV correlation written with * (p5); pad zero; 1D row, 2D patch
beats: 1 map  2 box sweep on r  3 Gaussian same row  4 median  5 corr vs conv flip
       6 slide-33 patch  7 punchline: derivative, spike vs edge
```

Stage-2 stream (abridged):

```
<plan> ... BOARD viewBox="0 0 560 420" regions: map(0-80) row(90-300) patch(310-420) ... </plan>

Beat 1 (free <g>, labels only): linear: box, Gaussian, sharpen, derivative | non-linear: median.
Correlation vs convolution is notation, not a separate filter.

Beat 2
<proc id="box" src="invented" region="row"
      data="r=[10,10,10,100,10,10,70,70,70,70]; w=[1,1,1]/3"
      state="out=zeros(10)" for="i in 1..8" pad="zero"
      step="out[i]=dot(win(r,i,3),w)"
      view="cells(r) window(r,i,3) products out(out)"/>
Lay a three-wide window over the first pixels {{step box 1}}, multiply each by a third
and add: {{val box.out[1]}}. Slide one cell {{step box 2}}: the spike is inside now,
ten plus ten plus a hundred, over three: {{val box.out[2]}}.
```

The engine draws a frame on cells 0 to 2 with the line "1/3·10 + 1/3·10 + 1/3·10 = 10", and 10 drops into output cell 1. The frame then glides one cell to the right, the line becomes "1/3·10 + 1/3·10 + 1/3·100 = 40", and 40 drops into output cell 2. Earlier outputs stay on screen.

```
Beat 3 (continuation, no new element)
{{run box to=8 per=0.5}}While the spike sits in the window it lifts every average,
and where the window straddles the step {{step box 5 hold}} it gives {{val box.out[5]}}.
```

The trace is out[1..8] = [10, 40, 40, 40, 30, 50, 70, 70]. The fast steps show results only, and the hold lands on 30.

```
Beat 4
<proc id="gauss" like="box" src="p26" data="w=[1,2,1]/4"/>
Same pixels, but the middle weight counts double {{step gauss 3}}: {{val gauss.out[3]}}.
{{run gauss to=8 per=0.35}}
```

The result is [10, 32.5, 55, 32.5, 25, 55, 70, 70]. At step 3 the line reads "1/4·10 + 1/2·100 + 1/4·10 = 55".

```
Beat 5
<proc id="med" like="box" step="out[i]=median(win(r,i,3))"
      view="cells(r) window(r,i,3) sort out(out)"/>
The median sorts the window and keeps the middle {{step med 3}}: {{val med.out[3]}}.
{{run med to=8 per=0.35}}The spike is gone, and the step stays sharp.
```

The result is [10, 10, 10, 10, 10, 70, 70, 70]. At step 3 the sort view lifts (10, 100, 10), reorders it to 10 10 100, and boxes the middle 10.

```
Beat 6  (fixes the poster's real teaching error)
<proc id="sh" src="p13" data="s=[11,12,13,14,15]; w=[0,0,1]" state="out=zeros(5)"
      for="i in 0..4" pad="zero" step="out[i]=dot(win(s,i,3),w)"
      view="cells(s) window(s,i,3) products out(out)"/>
<proc id="shc" like="sh" flip/>
Correlation picks the right neighbour, so the picture moves left. Convolution turns
the kernel around first, so it moves right. For symmetric kernels like the box and
the Gaussian, turning it around changes nothing.
```

Correlation gives [12, 13, 14, 15, 0] and convolution gives [0, 11, 12, 13, 14]. The kernel strip visibly rotates 180 degrees before the second sweep.

```
Beat 7  (the slide's own patch: one input, several operators)
<proc id="p" src="p33" region="patch" data="P=[[10,15,20],[23,90,27],[33,31,30]]"
      state="b=0;g=0;m=0;sh=0" for="i in 0..0"
      step="b=mean(win2(P,1,1,3,3)); g=dot(win2(P,1,1,3,3),outer([1,2,1],[1,2,1])/16);
            m=median(win2(P,1,1,3,3)); sh=2*P[1][1]-b"
      view="cells(P) window(P,1,1,3) products sort"/>
On your slide's patch the 90 is an outlier. The box gives {{val p.b}}, the Gaussian
{{val p.g}}, the median {{val p.m}}, and sharpening pushes it up to {{val p.sh}}.
```

The values are box 31, Gaussian 40.3125 (shown as 40.31), median 27 and sharpen 149: the median removes the outlier and sharpening amplifies it. Narration must not confuse the median's 27 with the correlation-shift output, which is also 27 on this patch.

```
Beat 8 (punchline, if budget allows)
<proc id="d" like="box" for="i in 0..8" step="out[i]=r[i+1]-r[i]" view="cells(r) out(out)"/>
```

The raw difference is [0, 0, 90, -90, 0, 60, 0, 0, 0]: the spike (90 and -90) beats the real edge (60). Run on the median output instead, only the true edge, 60, survives. This motivates "smooth first" (slides 87 to 89).

Follow-ups offered at the end: pyramids, aliasing, separability.

The model typed none of 10, 40, 30, 55, 32.5, 27, 31, 40.3125, 149, 60 or 90. The gate checks every spoken number against the trace. Box, Gaussian and median share `r` through `like=`.

Two proposed rule changes are not fully pinned down here: the 2D window helper (`win2`) and the slicing of multi-element rules across lines are syntax details for phase 1.

### 3.9 Short sketches

**Column addition, 478 + 356**

```
<proc id="add" src="invented" data="a=[4,7,8]; b=[3,5,6]" state="s=zeros(3); c=0; t=0"
      for="i in 2..0" step="t=a[i]+b[i]+c; s[i]=mod(t,10); c=floor(t/10)"
      view="cells(a) cells(b) register(c) out(s) products"/>
Ones first {{step add 2}}: eight plus six is {{val add.t}}, write {{val add.s[2]}},
carry {{val add.c}}.
```

The column sums are 14, 13 and 8, so s = [8, 3, 4] and the answer is 834. The register view shows the carry digit travelling to the top of the next column. Borrowing is the same proc with a different rule: `t=a[i]-b[i]-c; c=if(t<0,1,0); s[i]=t+10*c`.

**Slice and integrate: moment of inertia of a rod about its centre (M=1, L=1)**

```
<proc id="rod" src="invented" data="M=1; L=1; N=4" state="acc=0; x=0; dI=0"
      for="i in 0..N-1" step="x=-L/2+(i+0.5)*L/N; dI=x^2*M/N; acc=acc+dI"
      view="slices(x,L/N,-L/2,L/2) eqchain('dm=(M/L)dx','dI=x^2 dm','I=sum dI') out(acc)"/>
```

1. The first slice is labelled dx, dm and its lever arm x.
2. `{{run rod}}` fills the remaining slices while the running sum climbs to 0.078125.
3. `<proc id="rod10" like="rod" data="N=10"/>` gives 0.0825, and N=100 gives 0.083325.
4. The last line reads `integral(x^2,-0.5,0.5)` = 0.08333 = ML²/12, so the limit is visibly approached.

The disk works the same way with a ring slice (2πr dr), giving 0.484375 at N=4 against 0.5. Choosing a strip, ring or shell is the planner's judgment, stated in the narration. The engine guarantees only the sums.

The `eqchain` line depends on your decision on board derivations (section 7). Without it, this case shows slices plus a readout only.

---

## 4. How it generalizes to cases we never anticipated

All cases share one shape: data, state, step order, rule, views. Nothing is a per-subject template.

1. **A new rule with standard views needs no new code.**
   - Euclid's GCD: `for="until b==0" step="r=mod(a,b); a=b; b=r" view="register(a) register(b)"`. The trace (1071, 462) → (462, 147) → (147, 21) → (21, 0) gives 21.
   - Newton's method: `step="x=x-(x^2-2)/(2*x)" view="plot"`.
   - Moving averages in finance, n-gram counts and CNN layers are the same window.
   - Punnett squares, outer products and the Gaussian table from its formula are a grid filled by rule.
2. **A rule no view fits.** The model draws a free `<g>` bound to the proc's exported state, for example a tangent line placed with `data-at="pt(f, newton.x)"`. Through the data bridge, that hand-drawn picture moves step by step under the same clock, and step back works for it. The model still writes only the rule. The engine computes and binds.
3. **Static structure** (a taxonomy, a camera diagram, a "which is separable?" question) stays as today's free SVG with its checks. For property questions, the plan uses pose, pause, reveal. The deck uses this on almost every slide marked "?".
4. **What it cannot express yet, honestly:**
   - raster operations on the slide's own image;
   - symbolic algebra (equations are checked numerically through `integral()`, not derived);
   - algorithms that rewrite structures inside one step beyond the array functions (sorting traces, graph search);
   - frequency-domain arguments (why a Gaussian beats a box).

   Each is added only when logged questions show demand. For rules beyond the expression language there is a sandboxed tracker (QuickJS in a Worker, returning data only and never touching the DOM). It is deferred, because generated code is often "visually correct yet behaviorally fragmented" ([EE-Eval](https://www.emergentmind.com/papers/2606.31012)).
5. **How we find gaps:** the eval log records every answer that fell back to free SVG for a process. A new view or helper is built only when a pattern recurs.

---

## 5. What we keep, what we replace

**Kept as is**
- Scout plus one stage-2 streaming call, plan-first, the 3200-token cap.
- One cached system block (12 h), the ledger and spend caps.
- `svgBeats.ts` element lifting.
- Sanitize, style and render for free SVG.
- `data.ts` (DataScope, constDefs/rederive, refreshData, data-ghost/trace) and `expr.ts` including `integral()`.
- GateState, the shadow board, BeatSplitter, `live.ts` release, repair and drop, and `repair.ts`.
- Scheduler pause, hold, respeed and withBeat; VoiceClock; InkTime.
- The scout's aside route and PAUSED ANSWER.

**Reused as libraries**
- `compute.ts`: winGeometry, winOrigin, winValues, weightAt with flip, winCell expansions, reduce, substitute/joinTerms, sweepStepMs, MAX_CELLS/MAX_IMG decimation, and their tests.
- `kit.ts`: the winGo, winRect, ensureWinCalc and winDone visuals, ported as pure state-to-SVG views.
- `anim.ts`: Ctl.ff for fast-forward.

**Extended**
- `expr.ts`: list literals, indexing, `len`, `zeros`, `range`, `win`/`win2` with pad modes, `flip`, `dot`, `sum`, `mean`, `min`, `max`, `sort`, `median`, `mod`, `outer`.
- `compute.ts`: a median WinOp; nearest, reflect and wrap padding.
- `scheduler.ts`: idempotent setStep and seek-to-state.
- `check.ts grounded()`: strict on data boards.
- `lint.ts` TAG_NAMES: proc, step, run.
- Scout: DATA and CONV lines.
- `App.tsx`: step controls.

**New**
- `src/proc/{parse,run,trace,clock,layout}.ts` and `src/proc/views/*` (cells, window, products, out, sort, register, slices, plot, eqchain).
- `server/prompt/moves.ts`: exemplar packs by pattern family (window, recurrence/carry, slice-sum, grid-fill), placed in the stage-2 user turn, chosen by the scout's pattern hint.
- A short domain-neutral PROCESS section in the system prompt, whose one example is a running total over a list.

**Replaced or retired**
- Hand-drawn posters for processes, which become procs.
- Wall-clock motion: tweens and sweeps move onto InkTime × speed.
- The "fired actions never refire" seek rule, for procs.
- Typed-number "notes" on data boards, which become failures.

**Not built:** persona agents, dynamic orchestration, vision critics on the critical path, a scrub bar in v1, a generic code sandbox in v1.

**The prompt test.** Exemplars in the user turn keep the system block byte-identical and keep `tests/server/prompt.test.ts` passing. They are general per pattern, not per subject or question; a window exemplar uses prices, not pixels. This stays within the spirit of "no recipes", but it is a policy call you should confirm.

---

## 6. Phased plan

### Phase 1: prototype and side-by-side evaluation (about 5 to 7 working days)

Scope: the convolution lecture plus two other subjects, column addition and the rod's moment of inertia, all worked out in the case dossier.

1. **Day 1. Motion on the narration clock.** Move `anim.ts` tweens and `kit.ts` tweenMove/stepOrSweep onto InkTime × `settings.speed`. Add a test that a tween started while paused does not move. This ships on its own and closes the open item in `flow-prompt.md`.
2. **Days 2 to 3. Proc v1.**
   - Lists in `expr.ts`.
   - `src/proc/parse` and `run` producing traces with expansions.
   - Views: cells, window, products, out, sort, register, and a minimal slices view with a running-sum readout.
   - `{{step}}`, `{{run}}` and `{{val proc.x[i]}}`.
   - Idempotent setStep, so step back works.
   - Step back, step forward and replay buttons.
   - Fixture tests:
     - row r: box [10,40,40,40,30,50,70,70], Gaussian [10,32.5,55,32.5,25,55,70,70], median [10,10,10,10,10,70,70,70], raw diff [0,0,90,-90,0,60,0,0,0];
     - patch P: box 31, Gaussian 40.3125, median 27, sharpen 149;
     - shift kernel: correlation [12,13,14,15,0] vs convolution [0,11,12,13,14];
     - box5 on [10,20,30,40] at index 0: constant 12, nearest 16, reflect 18, wrap 26;
     - rod: 0.078125 / 0.0825 / 0.083325;
     - addition: 478+356 = 834, column sums 14, 13, 8.
3. **Day 3. Hand-written scripts first.** Before any prompt change, write `?script` demos of the three subjects, so you can judge the experience directly. Behind an eval flag, the `eqchain` view is on, so you can see the rod with and without board derivations.
4. **Days 4 to 5. Prompted run behind a flag.**
   - The `<proc>` branch in `svgBeats.ts`.
   - The scout DATA/CONV lines.
   - The PROCESS section (within the 8300-token test, trimming layout advice the engine now owns).
   - Exemplar packs.
   - Gate checks (a), (b), (d) and (e).
5. **Days 5 to 7. Evaluation.**
   - **Questions** (about 12):
     - "explain the different filtering techniques in this PDF";
     - "how does the median filter work";
     - "what's the difference between correlation and convolution";
     - "how does 478 + 356 work, with carrying";
     - "derive the moment of inertia of a rod about its centre", on a short mechanics PDF;
     - plus 2 unseen questions to measure how often answers fall back to free SVG.
   - **Arms:** petu-proc, petu today (p6.17), and plain ChatGPT given the same PDF and question.
   - **Automated metrics:**
     - proc compiles on first try, and after repair;
     - zero untraced numbers on board or in speech (from the gate log);
     - fixtures pass;
     - median time to first word;
     - cost per answer;
     - step back restores the exact earlier state.
   - **Human rubric**, blind where possible: the founders plus 3 to 5 students, rating side by side.
     - Is the moving window, carry or slice visibly shown?
     - Can you trace each output back to its inputs?
     - Does it match the slides (data and conventions)?
     - Did pause, speed and step back behave as expected?
     - Which would you rather learn from?
   - **Learning check:** a 3-question quiz per topic before and after, with a different student per arm where numbers allow.
   - **Proposed pass bar** (targets, not established norms):
     - first-try compile at least 80%, at least 95% after repair;
     - zero untraced numbers;
     - median first word under 3 s;
     - cost about $0.005 to $0.006;
     - petu-proc preferred over ChatGPT in at least 2 of 3 pairs on "I could follow the computation".
   - **Spend:** about 12 questions × 3 runs × about $0.006 is well under the $3/day founder cap. ChatGPT runs go through its own UI.

### Phase 2 (about 1 week): the timeline contract and the remaining checks

- Seek-to-state for free SVG: groups after the target are hidden, not deleted, with I1 reworded.
- Landmark holds and hold at the end of each beat.
- One optional prediction prompt per answer.
- The data bridge: proc state exported to DataScope, so free SVG binds to steps.
- Gate checks (c) one-dataset and (f) conventions vs the cited slide.
- "Re-explain this step", carrying the proc source plus state[k] into the aside route.
- Run time counted in the pacing budget.

### Phase 3 (as evidence warrants)

- Slices and eqchain made the default, if you approve board derivations.
- The plot view, and the grid-fill pattern (Punnett, outer product, the Gaussian table from its formula).
- **Raster on the student's own slide image:** crop the eye on slides 11 to 18, run the kernel in canvas, and sweep a zoomed 3x3 window of real pixel values. This is the single most "a chatbot cannot do this" visual.
- A data-literal inspector for "what if".

### Deferred, or not built

- The QuickJS tracker (only if logged questions keep exceeding the expression language).
- An asynchronous vision critic (offline evals only).
- A scrub bar.
- Persona agents (unless an eval shows the single planner choosing patterns badly and a specialist call fits under the opener).

---

## 7. Risks and open questions

### Decisions for the founders

1. **Derivations on the board.** The labels-only rule (p6.8, `prose.ts`) was added after real complaints about random prose, and it currently blocks "dm = λ dx, dI = x² dm, ∫". The proposal is a narrow exemption: engine-rendered `eqchain` lines whose numbers are all bound to trace values, at most 4 lines. Free prose stays banned. Without the exemption, slicing-to-integrate shows slices and a readout but no chain.
2. **Back vs re-explain.** Do you agree that Back replays exactly, and that only a separate "Re-explain this step" calls the model?
3. **Pacing default.** The research conflicts. We propose: system-paced within a step, holds at boundaries, speed and step controls as options, no scrub bar in v1. Is that right for your users?
4. **Invented examples.** Is a visible "example, not from your slides" chip acceptable, or should the tutor invent only when the slide has no numbers at all?
5. **Exemplar packs in the user turn.** This keeps the cache and the prompt test intact, but it softens the "no per-question recipes" rule in spirit, even though the packs are per pattern, not per subject.
6. **Level adaptation.** Should the tutor infer prior knowledge (novices get pre-training and 3 worked steps; experts get the formula first and one confirming step), or ask once?

### Risks

- **The model may not learn the format.** Models generalize poorly to an unfamiliar DSL from a few examples (Grammar Prompting, [arXiv 2305.19234](https://arxiv.org/abs/2305.19234v3)). Mitigations: numpy-like names, attributes in the XML the model already writes, exemplar packs, precise repair messages, and measuring the compile rate before changing the default.
- **Prompt budget.** The prompt sits near the 8300-token cap. Trimming SVG guidance may bring back old static-diagram failures, such as dots off curves. Watch the eval set.
- **The kit was dropped once.** Its write-up (`live-vs-demo-boards.md`) is not in the repo, so we do not know exactly what failed. Engine-owned regions and an A/B on the eval set guard against repeating it, but this is the main unknown.
- **Layout crowding.** 2D grids larger than about 7x7 plus a products line will not fit a 560-wide board. Decimation and shorter expansions are needed.
- **The scout may misread slide numbers.** OCR or extraction slips on tables are caught only when a value is missing from the page text, not when it is consistently misread. Source chips let the student see where the data came from.
- **A stricter gate means more repairs.** Failing untraced numbers may withhold beats until the model reliably uses `{{val}}`. With only 2 repairs allowed, some beats will simply be dropped at first.
- **Pacing budget.** Sweeps can blow the 60 s target. Fading by default (full arithmetic on positions 1 and 2) and counting run time are the guards.
- **Seek semantics.** Rewinding bound state means rewording invariant I1. Repeated back-and-forth must not pile up ghosts. Ghosts follow the step log.
- **Pedagogy.** A moving window by itself adds little (g about 0.23). The value comes from discrete stops, a trace that stays on screen, narration in sync and the slide's formula at the end. If the prompt yields sweeps without worked first positions, the student gets a prettier poster.
- **Proposal (b) relies partly on unverified sources.** The ChatGPT-visuals architecture is inferred from press coverage, and several pacing studies were read only as snippets. Neither changes the recommendation, but neither should be quoted as fact.

---

## 8. Scorecard of the three proposals

1 = weak, 5 = strong.

| Criterion | evolve (stepped exact data on the svg board) | program (trace programs, `<proc>`) | experts (fixed pipeline: planner, move compilers, verifier) |
|---|---|---|---|
| Fixes the root cause | 3. Adds data and steps, but the model still places every moving part with formulas in i and k, so layout and per-step drawing stay its job | 5. The model writes only data and rule; the engine owns numbers, layout and timeline | 4. Removes computation and layout from the model for catalogued moves; anything outside the catalog is still a poster |
| Generality to unforeseen subjects | 3. Anything indexable by k works; array-rewriting processes (sorting, Euler without `scan`) fall back to static SVG | 5. A model-written rule covers GCD, Newton, carries and slices with no new template; the data bridge animates unforeseen pictures | 3. A fixed set of compilers; a new family waits for new code, otherwise free SVG |
| Numeric correctness | 4. Engine-computed and gated per step, but 120-character formulas and hand-placed text leave gaps | 5. One pure function produces the value, the expansion and the gate check; page-text and one-dataset checks | 5. The same compute.ts path for screen and gate, plus the strict grounded() rule |
| Pacing and step control | 4. `{{step}}` on the narration clock, with a const log for seek back; free-SVG rewind is limited | 5. Idempotent setStep, `{{run}}` fading, landmark holds, step back/forward/replay | 4. Sub-steps tied to words, plus rebuild on seek; needs a new sub-step clock |
| Grounding in the PDF | 4. Scout lifts data with cites; a "data-src" note check comes later | 5. Required `src`, page-text verification, invented-data chip, CONV line driving labels | 5. Scout lifts data and conventions; dimension and convention check against the cited slide |
| Latency and cost | 5. No new calls; smaller first group via data-each; cached prompt growth only | 5. No new calls; 150-400 character procs close faster than today's first groups | 4. No new calls, but about 300-600 uncached exemplar tokens per answer, and the kit's heavier blocks |
| Build effort and risk | 4. Least new code, reuses the existing render path; risk in formula-heavy prompting | 2. Most new code (parser, runner, views, scheduler contract) plus DSL learnability risk | 3. Reuses the kit renderer fast, but brings back what p6.0 replaced, for reasons we cannot check |
| **Total (of 35)** | **27** | **32** | **28** |

**Recommendation:** use **program** as the spine. The code is the most new of the three, but it is the only design that takes coordinates and arithmetic out of the model for anything that moves, while staying open to subjects nobody planned for.

Ideas grafted from the runners-up:

- **From experts:** exemplar packs in the user turn, keyed by the scout's pattern hint, which keeps the cache and the prompt test intact. The scout's convention fields with a dimension/convention check. The explicit costed "no persona agents" stance.
- **From evolve:** the data bridge, so free SVG follows the step. The per-step state log for seek back. Fixing motion on InkTime × speed first, as a standalone win.
- **From all three:** what they agree on is the strongest signal in the research. Declare data once from the slide, let the engine compute every number, make the board a function of (beat, step), let going back replay rather than regenerate, and make the gate strict on boards that declare data.