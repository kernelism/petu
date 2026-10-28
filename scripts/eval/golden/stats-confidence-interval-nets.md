# Golden lesson: what does "95% confident" look like?

- **Document:** `openstax-introductory-statistics-2e.pdf` (OpenStax Introductory Statistics 2e)
- **Page:** 418 (the Apple Music example, chapter 8 introduction). Also uses p419 (confidence level wording).
- **Question type:** "visualise this"
- **Question (as the student types it):** "Can you help me picture what '95% confident' actually means? Is there a 95% chance the true mean is between 1.8 and 2.2?"

## The student's likely confusion

They attach the 95% to the one interval they have, as if the true mean μ might be inside (1.8, 2.2) with probability 0.95. They also don't see why "x̄ is within 0.2 of μ" lets you say anything about μ. The page states that flip in one sentence (t18) and moves on, and the page's opening line ("It is the population parameter that is fixed") goes past unnoticed. They need to *see* many samples, and that it's the interval that moves while μ stays put.

## Carrying example

The page's own numbers: σ = 1 song, n = 100, standard error 1/√100 = 0.1, margin 2 × 0.1 = 0.2, the page's sample mean x̄ = 2, interval (1.8, 2.2). For the picture we take a "god's-eye view" and pretend we know μ = 2.05. This is clearly labelled as pretend and dropped at the end. We then show 20 repeat surveys with these sample means: 2.00 (the page's), 2.11, 1.97, 2.16, 2.04, 1.93, 2.08, 2.21, 1.99, 2.12, 1.82, 2.06, 2.02, 1.95, 2.14, 2.09, 1.98, 2.18, 2.03, 2.07. Exactly one of these (1.82) is more than 0.2 from 2.05, so 19 of 20 nets catch μ. That makes the 95% something you can count.

## The scene

**Things**
- A long horizontal number line across the middle of the board, 1.6 to 2.5 songs.
- A gold vertical **post** at μ = 2.05, labelled "true mean (pretend we know it)". It never moves.
- Above the line: the bell of possible sample means, centred on the post, with an SD tick of 0.1 and a shaded central **band** from 1.85 to 2.25.
- Below the line: a growing stack of 20 **nets**. Each is a dot at its x̄ with a bar reaching 0.2 each way. Nets that cross the post are solid; the one that misses is hollow and red. The page's own net (x̄ = 2, 1.8 to 2.2) is first and slightly bolder.
- A small counter to the right of the stack: "caught: 19 of 20".
- A width marker on the page's net: "0.2 = 2 × 0.1".

**Relations**
- Each net's dot is dropped from the bell (a faint vertical leader from the bell to where the dot lands), so each net visibly comes from one sample mean.
- Band ↔ nets: a dot inside the band always gives a net that reaches the post. The one dot outside the band (1.82) gives the one miss. A leader line runs from the red net up to the bell's left tail.
- Mirror arrow between "x̄ within 0.2 of μ" (on the band) and "μ within 0.2 of x̄" (on a net): the same distance, read from the other end.

**Layout (in words)**
The number line is the spine. The bell sits above it and the stack hangs below it, so "where sample means land" (above) and "what we build from them" (below) share one horizontal scale. The post is the only full-height element, crossing bell, line and stack, which is why it reads as fixed. The stack grows downward and slightly to the right, like a falling list, leaving whitespace on the left for the page connectors. The counter hangs off the lower right. The band shading and the stack are deliberately not aligned to a grid: the nets' left ends are ragged because the x̄ values differ.

**Connectors to the PDF**
- p418 "It is the population parameter that is fixed." → the post.
- p418 standard-deviation formula (σ/√n, the figure mark under "sample mean is") → the bell's 0.1 tick.
- p418 "(2)(0.1) = 0.2" → the width marker on the page's net.
- p418 "within two standard deviations of the population mean" → the band.
- p418 "Because x̄ is within 0.2 units of μ" → the mirror arrow.
- p418 "The 95% confidence interval is (1.8, 2.2)." → the page's net.
- p418 "happens for 5% of samples" → the red net.
- p419 "the percent of confidence intervals that contain the true population parameter" → the counter.

## Beats

**1. Play god for a minute.**
- Say: "To see it, let's cheat for a minute. Pretend we secretly know the true average is 2.05 songs a month. I'll draw it as a post. It never moves. That's the key."
- Board: number line; gold post at 2.05.
- Slides: p418 highlight "It is the population parameter that is fixed."
- Connections: p418 sentence → post.

**2. Sample means wobble around the post.**
- Say: "Each survey of 100 people gives one sample mean. Different people, different mean. They wobble around the post, with a typical wobble of 1 over the square root of 100, which is 0.1."
- Board: the bell above the line, centred on the post, with an SD tick of 0.1.
- Slides: p418 point at the σ/√n formula under "the standard deviation for the sample mean is".
- Connections: formula mark → 0.1 tick.

**3. Where 95% of them land.**
- Say: "About 95% of the time the sample mean lands within two wobbles, 0.2, of the post. So somewhere between 1.85 and 2.25."
- Board: band shaded 1.85 to 2.25 under the bell.
- Slides: p418 highlight "within two standard deviations of the population mean", then "(2)(0.1) = 0.2".
- Connections: both phrases → band.

**4. Flip it into a net.**
- Say: "Now flip it around. If your sample mean is within 0.2 of the post, then the post is within 0.2 of your sample mean. So from your mean, reach out 0.2 each way. Call that a net. The page's survey got 2, so its net runs from 1.8 to 2.2, and it catches the post."
- Board: a dot drops from the band onto the line at 2.00 and becomes the first net below it (1.8 to 2.2), solid, crossing the post. Mirror arrow between the band and the net, labelled "same 0.2, read from the other end".
- Slides: p418 highlight "Because x̄ is within 0.2 units of μ", then "The 95% confidence interval is (1.8, 2.2)."
- Connections: p418 phrases → mirror arrow and page's net.

**5. Run it twenty times.**
- Say: "Let's run the survey 20 times. Twenty sample means, twenty nets. Watch which ones catch the post. Here's one that landed at 1.82, out in the tail. Its net stops at 2.02, just short."
- Board: 19 more nets drop one by one, each from the bell. The 1.82 net is hollow red, with a leader line up to the bell's left tail outside the band. The counter ticks to "caught: 19 of 20".
- Slides: p418 highlight "happens for 5% of samples".
- Connections: red net ↔ tail outside band; p418 phrase → red net.

**6. Where the 95% lives.**
- Say: "So the 95% belongs to the net-throwing, not to any one net. Your net either caught 2.05 or it didn't. The post doesn't hop in and out. What's 95% is how often this method catches it."
- Board: all nets except the page's fade; the counter gets the label "95% = how often the method catches the post". A connector from the counter to the p419 sentence.
- Slides: p419 highlight "the percent of confidence intervals that contain the true population parameter".
- Connections: p419 phrase → counter.

**7. Back to real life.**
- Say: "In real life the post is invisible. You only ever see your one net, 1.8 to 2.2. Saying you're 95% confident means you used a method that catches the true mean about 19 times out of 20."
- Board: the post becomes dashed and its "pretend" label fades. The page's net stays bold with "1.8 to 2.2". The bell fades to an outline.
- Slides: p418 highlight "We say that we are 95% confident" (the start of t28).
- Connections: page's net → p418 t28–t29.

## The aha

The true mean is a fixed post and your interval is a net thrown from a randomly placed sample mean. "95%" describes how often nets thrown this way catch the post, not the chance that this particular post is inside this particular net.

## Check question

Suppose the survey asked 400 people instead of 100, and the sample mean was still 2. What net would you get, and what fraction of such nets would catch the true mean?

**Answer:** The wobble is 1/√400 = 0.05, so the reach is 2 × 0.05 = 0.1 and the net is (1.9, 2.1). About 95% of such nets still catch the post. More data gives narrower nets, not a higher catch rate. The catch rate is set by the "2 standard deviations" rule, the confidence level.

## Why this is good

- Gives the student the exact picture they asked for: a fixed thing, a moving thing, and repetition. It answers the probability question by showing what the probability is *about*.
- Uses the page's own numbers and its own net (1.8, 2.2) as the first of the twenty, so the abstract claim is anchored to the example the student is reading.
- A clearly labelled temporary device (the god's-eye μ) makes the invisible visible, then is removed explicitly so the student isn't left with a false belief.
- One shared axis carries the whole lesson. The bell, band and nets are all linked by leader lines showing where each net came from, so the "flip" (t18) is a drawn relation, not a sentence.
- The one miss is shown and explained (it came from the tail), so 95% is counted, not asserted.
- The check question pulls apart two things students often conflate (width vs. confidence level) by changing one input.

## Appendix (hidden): arithmetic

- Standard error: σ/√n = 1/√100 = 1/10 = 0.1. Margin (page uses the empirical rule, 2 SDs): 2 × 0.1 = 0.2. Page interval: 2 ± 0.2 = (1.8, 2.2).
- Band around pretend μ = 2.05: 2.05 ± 0.2 = (1.85, 2.25).
- Twenty sample means and |x̄ − 2.05|: 2.00 (0.05), 2.11 (0.06), 1.97 (0.08), 2.16 (0.11), 2.04 (0.01), 1.93 (0.12), 2.08 (0.03), 2.21 (0.16), 1.99 (0.06), 2.12 (0.07), 1.82 (0.23, MISS: net 1.62 to 2.02), 2.06 (0.01), 2.02 (0.03), 1.95 (0.10), 2.14 (0.09), 2.09 (0.04), 1.98 (0.07), 2.18 (0.13), 2.03 (0.02), 2.07 (0.02). 19 within 0.2 → 19/20 = 95%.
- Plausibility of the list as draws from N(2.05, 0.1): its mean is 2.0475 and its SD is 0.0946.
- Exact catch probability for ±2 SE: P(|Z| ≤ 2) ≈ 0.9545, "about 95%" as the page says. (1.96 SE gives exactly 0.95. The page uses 2 here and 1.96 later in the chapter.)
- Check: 1/√400 = 1/20 = 0.05; 2 × 0.05 = 0.1; 2 ± 0.1 = (1.9, 2.1).
