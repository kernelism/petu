# Golden lesson: "I'm lost on this page" (conformal prediction)

- **Document:** `arxiv-2107.07511.pdf` (Angelopoulos & Bates, *A Gentle Introduction to Conformal Prediction*)
- **Page:** 4 (Section 1, Figures 1 and 2, equation (1)). Also uses p5 (Remarks).
- **Question type:** vague / lost
- **Question (as the student types it):** "I'm lost on this page. What is going on?"

## The student's likely confusion

The page brings in a model, calibration data, a score, a quantile with a ceiling and an (n+1), a prediction set, and a two-sided probability bound, all in about one column. The student can't tell which part is the main point and which parts are details. Underneath there is usually one real block: why should a cutoff picked on old photos give a guarantee on a *new* photo? The lesson must not re-summarise the page. It picks the main point (measure how wrong the model is on fresh data, cut at 90%, reuse that cut), runs it once with tiny numbers, and then lets the page's notation fall into place.

## Carrying example

α = 0.1 (aim for 90%). A calibration set of n = 19 labelled photos the model never saw. The model's softmax probability for the *true* class on each photo: 0.98, 0.97, 0.95, 0.93, 0.92, 0.90, 0.88, 0.85, 0.83, 0.80, 0.78, 0.74, 0.70, 0.65, 0.60, 0.52, 0.41, 0.25, 0.08. Scores s = 1 − p, in order: 0.02, 0.03, 0.05, 0.07, 0.08, 0.10, 0.12, 0.15, 0.17, 0.20, 0.22, 0.26, 0.30, 0.35, 0.40, 0.48, 0.59, 0.75, 0.92.

- Cut position k = ⌈(19 + 1)(0.9)⌉ = 18, so q̂ = the 18th smallest score = 0.75. The softmax threshold is 1 − q̂ = 0.25.
- Three new photos like Figure 1's easy / medium / hard squirrels:
  - Easy: fox squirrel 0.92, gray squirrel 0.05, marmot 0.02, other 0.01 → set {fox squirrel}.
  - Medium: fox squirrel 0.55, gray squirrel 0.30, marmot 0.10, other 0.05 → set {fox squirrel, gray squirrel}.
  - Hard: fox squirrel 0.31, gray squirrel 0.28, marmot 0.26, mink 0.10, other 0.05 → set {fox squirrel, gray squirrel, marmot}.
- Why 90%: the new photo is a 20th member of the line-up. Its rank is equally likely to be any of 1 to 20, and it is covered when its rank is 18 or lower: 18/20 = 0.90.

n = 19 is chosen so that (n + 1)(1 − α) is a whole number and the "+1" is visible as one extra slot.

## The scene

**Things**
- Three loose **zones** flowing left to right, named after Figure 2's panels: "(1) compute scores", "(2) get quantile", "(3) construct prediction set". They are drawn as regions, not boxes.
- Zone 1: 19 small **photo chips**, each with a short bar for the true-class probability; each bar flips into a score bar (1 − p).
- Zone 2: the **line-up**, the 19 score bars sorted left to right by height. A **cut marker** sits after position 18 (0.75); position 19 (0.92) lies beyond it.
- Zone 3: three **test photos** (easy / medium / hard), each with a small bar chart over classes. One horizontal **threshold line at 0.25** runs across all three charts. The classes above it are circled into a set.
- Below the line-up: **20 slots**, the 19 old scores plus an empty slot for the new photo. Slots 1 to 18 are shaded "covered" and 19 to 20 "not covered".
- A small **guarantee strip** at the far right: 0.90 ≤ coverage ≤ 0.95.

**Relations**
- Chip → score bar → place in the line-up: each calibration photo is tracked into its slot (a faint path for two or three of them, not all 19).
- Cut marker ↔ threshold line: one connector labelled "score ≤ 0.75 ⇔ probability ≥ 0.25", the same cut seen from the other side.
- Set size ↔ photo difficulty: the hard photo's circle is the largest, and it links to Figure 1.
- 20 slots → guarantee strip ("18 of 20").

**Layout (in words)**
The board reads as a flow from left to right because the page's recipe is one: chips on the left, the line-up in the middle as the widest and lowest element (it is the heart), and the test charts on the right, slightly higher, so the threshold line can run across them like a horizon. The cut-to-threshold connector arcs over the top between the middle and right zones. The 20-slot strip sits directly under the line-up so the extra slot clearly belongs to the same line. The guarantee strip is small, at the bottom right, where the argument ends. The zones vary in width and height; nothing is centred.

**Connectors to the PDF**
- p4 Figure 2 panel labels "(1) compute scores (2) get quantile (3) construct" → the three zones.
- p4 "one minus the softmax output of the true class" → the score bars.
- p4 "define ˆq to be the" (the ⌈(n+1)(1−α)⌉/n quantile) → the cut marker.
- p4 "includes all classes with a high enough softmax output" → threshold line and circled sets.
- p4 Figure 1 → the three test photos.
- p4 equation (1) → guarantee strip; its "n + 1" → the extra slot.
- p4 "no matter what (possibly incorrect) model is used" → the line-up (we measured the model's errors; we never trusted its numbers).

## Beats

**1. One recipe, three moves.**
- Say: "This page is really one recipe in three moves. They're the three panels of Figure 2: score, cut, use the cut. Let's run it once with tiny numbers, and then the page will make sense."
- Board: three loose zones, faintly named, flowing left to right.
- Slides: p4 point at Figure 2, highlight "(1) compute scores (2) get quantile (3) construct".
- Connections: Figure 2 panels → zones.

**2. How wrong was the model?**
- Say: "Take 19 labelled photos the model has never seen. For each one, how much did the model believe the right answer? That one was 0.98, very sure. This one was 0.08, badly wrong. The score is one minus that, so a big score means the model missed badly."
- Board: 19 chips with probability bars; the bars flip into score bars (0.02 to 0.92).
- Slides: p4 highlight "one minus the softmax output of the true class".
- Connections: p4 phrase → score bars.

**3. Line them up and cut.**
- Say: "Line the 19 scores up from smallest to largest. We want to be right 90% of the time, so alpha is 0.1. The page says cut at position (19 plus 1) times 0.9, rounded up, which is 18. The 18th score is 0.75. That's q-hat."
- Board: the score bars slide into the sorted line-up; the cut marker drops after position 18 and is labelled q̂ = 0.75; the 0.92 bar sits past the cut.
- Slides: p4 highlight "define ˆq to be the" and the quantile expression after it.
- Connections: p4 expression → cut marker.

**4. Use the cut on new photos.**
- Say: "Now a new photo. A score of at most 0.75 means the model gives a class at least 0.25. So keep every class at or above 0.25. The easy squirrel gets one guess. The medium one gets two. The hard one gets three. The set grows when the model is unsure."
- Board: three test charts appear on the right; one threshold line at 0.25 runs across all three; the classes above it are circled ({fox}, {fox, gray}, {fox, gray, marmot}). An arc from the cut marker to the threshold line: "score ≤ 0.75 ⇔ probability ≥ 0.25".
- Slides: p4 highlight "includes all classes with a high enough softmax output", then point at Figure 1.
- Connections: cut ↔ threshold; hard photo's set → Figure 1.

**5. Why it should work: one more in the line.**
- Say: "Here's the part the page moves through fastest. Why would a cut from old photos work on a new one? Picture the new photo's score joining the line. Now there are 20. If the new photo is like the old ones, its spot is equally likely to be anywhere from 1 to 20. Its right answer makes the set whenever it lands in spots 1 to 18. That's 18 out of 20: 90%. That plus-one in the formula is the new photo."
- Board: the 20-slot strip appears under the line-up; an empty slot slides in; slots 1 to 18 shaded "covered", 19 to 20 "missed". Labelled "18/20 = 0.90".
- Slides: p4 point at equation (1), highlight "n + 1" under the fraction.
- Connections: extra slot → "n + 1"; strip → equation (1).

**6. Read equation (1) back.**
- Say: "So equation (1) says: at least 1 minus alpha, which is 0.9, and at most 0.9 plus 1 over 20, which is 0.95. And notice we never had to trust the model's probabilities. We only measured how wrong they were on fresh photos."
- Board: guarantee strip "0.90 ≤ coverage ≤ 0.95" at the bottom right, linked from the slot strip. A connector from the line-up to the page's "no matter what" sentence.
- Slides: p4 highlight "no matter what (possibly incorrect) model is used".
- Connections: line-up → p4 sentence; strip → equation (1).

## The aha

Conformal prediction doesn't trust the model's confidence. It lines up how wrong the model was on fresh photos and cuts where 90% of those mistakes stay below. That cut works on a new photo because the new photo is just one more in the line.

## Check question

Keep the same 19 scores but ask for 80% coverage (α = 0.2). Where do you cut, what is q̂, and what set does the medium photo (fox 0.55, gray 0.30, marmot 0.10, other 0.05) get?

**Answer:** k = ⌈20 × 0.8⌉ = 16, so q̂ = the 16th smallest score = 0.48 and the threshold is 1 − 0.48 = 0.52. The medium photo gets {fox squirrel} only: lower coverage gives smaller sets.

## Why this is good

- Answers a vague question by choosing *one* main point and running it with tiny numbers. It doesn't summarise the page line by line. The first beat tells the student how the page is organised (three moves) so they can find their way back.
- The central drawing (the line-up) carries the whole lesson: scores enter it, the cut lives on it, and the new photo joins it. Later beats extend it rather than starting new pictures.
- The hardest idea on the page (why the guarantee holds, and what "+1" means) becomes a counting argument you can see: 18 of 20 slots.
- Two views of the same cut (score ≤ q̂ and probability ≥ 1 − q̂) are joined by an explicit connector, so the student doesn't think there are two thresholds.
- Ties every piece back to the page's own figures and symbols (Figure 2's panels, q̂, equation (1), Figure 1), so the page reads clearly afterwards.
- The check question changes one input and asks for the whole chain again, plus the consequence (smaller sets).

## Appendix (hidden): arithmetic

- n = 19, α = 0.1: (n + 1)(1 − α) = 20 × 0.9 = 18 exactly; ⌈18⌉ = 18. The 18th smallest of the scores (listed in ascending order above, positions 1 to 19) is 0.75. Threshold 1 − 0.75 = 0.25.
- Scores from probabilities: 1 − 0.98 = 0.02, … , 1 − 0.25 = 0.75, 1 − 0.08 = 0.92 (all 19 listed; the list is already sorted because the probabilities are descending).
- Calibration coverage at this cut: 18 of 19 true classes have p ≥ 0.25 (all except 0.08).
- Test sets at threshold 0.25: easy {0.92}; medium {0.55, 0.30} (0.10 and 0.05 excluded); hard {0.31, 0.28, 0.26} (0.10, 0.05 excluded). The probabilities in each photo sum to 1.00 (easy: 0.92 + 0.05 + 0.02 + 0.01).
- Rank argument (exchangeable, no ties): if the test score has rank r among all 20, then r − 1 calibration scores are below it. It is ≤ the 18th smallest calibration score iff r − 1 ≤ 17, i.e. r ≤ 18. P = 18/20 = 0.90.
- Equation (1) bounds: 1 − α = 0.90; 1 − α + 1/(n + 1) = 0.90 + 0.05 = 0.95.
- Check: 20 × 0.8 = 16 → 16th smallest = 0.48 → threshold 0.52; medium: 0.55 ≥ 0.52 is in, 0.30 is out.
- Caveat (not narrated): the page's code line `np.quantile(..., q_level, method='higher')` indexes q_level × (n − 1) and, for small n, lands one position higher than the k-th smallest the text defines (here it would return 0.92). The lesson follows the text's definition and does not point at the code line.
