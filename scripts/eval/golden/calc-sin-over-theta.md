# Golden lesson: why does sin θ / θ go to 1?

- **Document:** `openstax-calculus-volume-1.pdf` (OpenStax Calculus Vol. 1)
- **Page:** 159 (Section 2.3, Figure 2.30, equation 2.18)
- **Question type:** derivation / limit idea
- **Question (as the student types it):** "I can follow the inequalities on this page but I don't see *why* sin θ / θ goes to 1. Where does it come from?"

## The student's likely confusion

They see a chain of symbolic steps (an inequality, divide by sin θ, flip, squeeze) without the picture that makes the first inequality obvious. So the result feels like a trick. Many also think "0/0 just gives 1 here", or have memorised "sin θ ≈ θ" with no idea why it holds or that it needs radians. The page's Figure 2.30 holds the whole argument, but the text points to it only once.

## Carrying example

One wedge of the unit circle at θ = 0.5 radians, then closed down to 0.2 and 0.1. At 0.5 the three lengths are visibly different (sin 0.479, arc 0.5, tan 0.546) and the squeeze is loose (0.878 < 0.959 < 1). At 0.1 they are nearly identical (0.0998, 0.1, 0.1003) and the squeeze is tight (0.995 < 0.998 < 1). Students can watch the gap close.

## The scene

**Things**
- A large first-quadrant **wedge** of the unit circle, left of centre: origin O, radius 1 along the x-axis to A = (1, 0), the arc up to the point P at angle θ, the drop line from P down to the x-axis (length sin θ), the horizontal leg from O (length cos θ), and the tangent segment rising from A to where line OP meets it (length tan θ).
- Three coloured lengths on the wedge: drop line (blue, sin θ), arc (gold, θ), tangent segment (green, tan θ).
- To the right, a **ladder** of three vertical bars side by side in the same colours, heights sin θ, θ, tan θ, with values written on top.
- Below the ladder, a **squeeze strip**: a short number line from 0.85 to 1.0 with two jaws (left jaw = cos θ, right jaw = 1) and a dot for sin θ / θ between them.
- Late in the lesson, a magnifier circle on the tip of the wedge, connected to a zoomed inset where the arc and the two straight segments are almost the same line.

**Relations**
- Each coloured length on the wedge → its bar on the ladder (leader lines, same colour).
- Horizontal leg (cos θ) on the wedge → the left jaw of the squeeze strip ("this jaw is that side").
- The ladder → the strip, through an arrow labelled "÷ sin θ, then flip".
- As θ changes, every element above updates in place: wedge, ladder heights and values, jaws and dot.

**Layout (in words)**
The wedge is the anchor, so it is big and off-centre to the left with its tip pointing up-right toward the ladder. The ladder sits to the right of the tip, at the tip's height, so the leader lines from the three lengths run short and roughly horizontal. The squeeze strip hangs below the ladder and the magnifier inset sits above-left of the wedge tip. Every later element sits next to the part of the drawing it explains. Nothing is boxed or grid-aligned; the strip is narrow and the ladder is tall.

**Connectors to the PDF**
- p159 Figure 2.30 (image) and caption "sine and tangent functions are shown as lines on the unit circle" → the wedge.
- p159 "the length of the side opposite angle θ in this new triangle" → the green tangent segment.
- p159 the inequality after "Thus, we see that for" → the ladder.
- p159 the line after "By dividing by" and the line after "Equivalently, we have" → the arrow "÷ sin θ, then flip" and the strip.
- p159 "(2.18)" and "we conclude that" → the closed jaws at the end.

## Beats

**1. Draw it with a real angle.**
- Say: "Let's draw the page's Figure 2.30 with an actual angle: half a radian on a circle of radius 1."
- Board: the wedge at θ = 0.5, with O, A, P and the angle marked.
- Slides: p159 point at Figure 2.30, highlight "shown as lines on the unit circle".
- Connections: Figure 2.30 → wedge.

**2. Three ways to measure the turn.**
- Say: "There are three ways to measure how far we've turned. The drop line is sin 0.5, which is 0.479. The arc itself is exactly 0.5, because on a radius-1 circle, in radians, the arc length is the angle. The tangent line is tan 0.5, which is 0.546. Which do you think is longest? The arc is trapped between the two straight lines."
- Board: the three lengths light up in colour; the ladder grows to the right with bars 0.479, 0.5, 0.546 and leader lines from each length.
- Slides: p159 highlight "the length of the side opposite angle θ", then point at the inequality after "Thus, we see that for".
- Connections: the inequality mark → ladder.

**3. Turn it into a squeeze.**
- Say: "Divide all three by the sine, 0.479: you get 1, then 1.043, then 1.139. Flip them over: 0.878, 0.959, 1. So sin θ over θ is stuck between cos θ and 1. And cos θ is just this bottom side of the triangle."
- Board: an arrow "÷ sin θ, then flip" from ladder to the strip. Jaws at 0.878 and 1, dot at 0.959. A leader line from the horizontal leg on the wedge to the left jaw.
- Slides: p159 point at the line after "By dividing by", then the line after "Equivalently, we have".
- Connections: page lines → arrow and strip; cos leg → left jaw.

**4. Close the angle.**
- Say: "Now close the angle to 0.2. The three lengths become 0.199, 0.2 and 0.203, and the jaws close in: 0.980, then 0.993, then 1."
- Board: the wedge animates to θ = 0.2. The ladder bars shrink and nearly level; the left jaw slides right to 0.980 and the dot to 0.993.
- Slides: none.
- Connections: same leader lines, updated values.

**5. Closer still: the curve goes straight.**
- Say: "At 0.1 they're 0.0998, 0.1 and 0.1003. Zoom in on the tip: the arc and the two straight lines are practically the same line. The bottom side stretches to the full radius, so cos θ heads to 1 and the jaws meet."
- Board: θ = 0.1; strip shows 0.995 < 0.998 < 1. The magnifier circle appears on the tip, with an inset where the arc and segments overlap.
- Slides: p159 highlight "we conclude that", point at (2.18).
- Connections: closed jaws → (2.18).

**6. Read the page again.**
- Say: "So that's the whole proof on this page: the arc is trapped between two straight lines, and those lines agree as the angle shrinks. It only works because the arc equals θ, which is what radians mean."
- Board: a connector from the gold arc to the ladder's middle bar, labelled "arc = θ only in radians". The strip, ladder and wedge stay lit together.
- Slides: back to Figure 2.30, then the inequality, then (2.18), in the order of the argument.
- Connections: wedge → inequality → strip → (2.18), as one chain.

## The aha

Up close, a circle's arc is straight. The arc θ sits between the drop line sin θ and the tangent tan θ, and those two meet as the angle closes, so sin θ and θ become the same length.

## Check question

If your calculator is in degrees and x is measured in degrees, what does sin x / x approach as x → 0?

**Answer:** π/180 ≈ 0.01745, not 1. An angle of x degrees is an arc of length πx/180 on the unit circle, so sin(x°)/x = [sin(πx/180) / (πx/180)] × (π/180), which tends to 1 × π/180. The squeeze picture compares sin with the arc, and the arc equals the angle only in radians.

## Why this is good

- Supplies the missing picture behind an algebraic chain the student can already follow. The answer is about *why*, not about repeating the steps.
- One drawing, the page's own figure, with concrete numbers. The lesson changes θ and lets the same drawing tighten, so the limit is something you watch happen.
- Every symbolic step is attached to a part of the drawing (cos θ is the bottom side, the arc is θ). Algebra and geometry stay connected through leader lines.
- A prediction question ("which is longest?") comes before the reveal.
- Ties back to the page's figure, its inequality lines and its equation number in the order the argument uses them.
- The check question tests the hidden assumption (radians) rather than recall, and has a short exact answer.

## Appendix (hidden): arithmetic

Values (radians), rounded:

| θ | sin θ | tan θ | cos θ | sin θ/θ | θ/sin θ | 1/cos θ |
|---|---|---|---|---|---|---|
| 0.5 | 0.47943 | 0.54630 | 0.87758 | 0.95885 | 1.04291 | 1.13949 |
| 0.2 | 0.19867 | 0.20271 | 0.98007 | 0.99335 | 1.00670 | 1.02034 |
| 0.1 | 0.09983 | 0.10033 | 0.99500 | 0.99833 | 1.00167 | 1.00502 |

- At 0.5: dividing (0.47943, 0.5, 0.54630) by 0.47943 gives (1, 1.04291, 1.13949). Reciprocals: (1, 0.95885, 0.87758) → 0.878 < 0.959 < 1 ✓ (1/1.13949 = 0.87758 = cos 0.5 because tan/sin = 1/cos).
- Narration rounding: 0.479, 0.546, 1.043, 1.139, 0.878, 0.959; 0.199, 0.203, 0.980, 0.993; 0.0998, 0.1003, 0.995, 0.998.
- Degrees: π/180 = 0.0174533.
- Faithfulness: the page's argument is the length inequality sin θ < θ < tan θ for 0 < θ < π/2, then division by sin θ and taking reciprocals. The lesson follows that same route, not the area-based version.
