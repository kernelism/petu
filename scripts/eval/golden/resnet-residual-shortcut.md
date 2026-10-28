# Golden lesson: why does adding x back make deep nets trainable?

- **Document:** `arxiv-1512.03385.pdf` (He et al., *Deep Residual Learning for Image Recognition*)
- **Page:** 2 (Figure 2, the residual building block). Also uses p1 (Figure 1, degradation), p3 (Section 3.1), p5 (Table 2).
- **Question type:** research-paper intuition
- **Question (as the student types it):** "Why does adding x back help? A stack of layers can learn H(x) directly, and F(x) + x can represent exactly the same functions. So what does the shortcut actually change?"

## The student's likely confusion

They are right that the two forms can represent the same functions; the paper says so too (p3, "both forms should be able to asymptotically approximate"). What they're missing is that the shortcut changes what is *easy to reach*, not what is possible. With the shortcut, "do nothing" becomes the default, where weights sit at or near zero. Without it, doing nothing is a precise target the layers must hit. Students also tend to assume the paper's motivation is vanishing gradients, while the paper's argument is the degradation problem plus how hard it is to learn an identity mapping.

## Carrying example

The paper's own puzzle (Figure 1: the 56-layer plain net has higher *training* error than the 20-layer one), plus one extra block with one number flowing through it:

- Input x = 2.0. The ideal output is almost a copy, H(x) = 2.1 (the paper's "closer to an identity mapping" case).
- Block: two weight layers with a ReLU between them, F(x) = w2 · relu(w1 · x). Weights start small: w1 = w2 = 0.1.
- Plain block outputs F(x) = 0.02 (error 2.08). Residual block outputs F(x) + x = 2.02 (error 0.08).
- To hit 2.1 exactly: the plain block needs w1·w2 = 1.05 (105 times its start of 0.01); the residual block needs w1·w2 = 0.05 (5 times its start).
- With all weights at zero: the plain block outputs 0 (it erases the signal), and the residual block outputs 2.0 (an exact copy).

Closing evidence from Table 2: plain-18 27.94% vs plain-34 28.54% top-1 error; ResNet-18 27.88% vs ResNet-34 25.03%.

## The scene

**Things**
- The **highway**: a long horizontal arrow across the middle of the board, labelled "identity (shortcut)", carrying a value token.
- The **detour**: two stacked "weight layer" boxes with a ReLU between them, forming a loop above the highway that rejoins it at a ⊕ node. This is the residual branch F.
- The **plain twin**: a copy of the detour alone, without a highway, below and slightly left. The same input token is split to both.
- A **target flag** "2.1" at the right end of both paths, with error brackets from each output to the flag.
- A **weight dial** (a short number line of w1·w2) to the lower right: start 0.01, residual target 0.05, plain target 1.05, with travel arrows.
- A **degradation strip** at the top left: two short bars of training error, 20-layer below 56-layer (Figure 1's shape). Later, Table 2's four numbers as paired bars (plain vs ResNet, at 18 and 34 layers).
- Later, a chain of the extra blocks between the strip and the highway: "18 extra blocks = 36 layers".

**Relations**
- Token flow along both paths with values at each stage (2.0 → 0.2 → 0.2 → 0.02 on the detour; ⊕ 2.0 → 2.02 on the highway).
- Error brackets ↔ dial: the size of each error bracket connects to the length of its travel arrow on the dial.
- Highway ↔ chain: the chain of 18 extra blocks is drawn as 18 highways with tiny detours, linked to the degradation strip ("this is how 56 can't be worse than 20").
- Detour ↔ the paper's F(x) := H(x) − x; highway ↔ "+x".

**Layout (in words)**
The highway runs the full width because it is the idea. The detour arches above it toward the right, as in the paper's Figure 2 but turned on its side so the token can be followed left to right. The plain twin sits underneath, offset left, so the two outputs end at different heights near the same target flag. Their error brackets then differ visibly in length. The degradation strip sits top-left, where the story starts, and the Table 2 bars appear beside it at the end, closing the loop. The dial sits bottom-right near the outputs it explains. No two parts have the same size, and nothing is centred.

**Connectors to the PDF**
- p1 Figure 1 (training-error panel) → degradation strip.
- p1 "the added layers are identity mapping" → the chain of extra blocks.
- p2 Figure 2, its "identity" arrow and "weight layer" boxes → highway and detour.
- p2 "F(x) := H(x) − x" and "F(x)+x" → detour label and ⊕ node.
- p2 "easier to push the residual to zero" → the beat-6 all-zero state.
- p3 "find the perturbations with reference to an identity mapping" → the dial.
- p3 "learned residual functions in general have small responses" → the tiny detours on the chain.
- p5 Table 2 → the four error bars.

## Beats

**1. The puzzle.**
- Say: "Start with the paper's puzzle. Take a 20-layer network that works and add 36 more layers. It gets *worse*, even on its own training data. So it isn't overfitting. Something about training breaks."
- Board: degradation strip, 20-layer error below 56-layer.
- Slides: p1 point at Figure 1 (left panel); highlight "not caused by overfitting".
- Connections: Figure 1 → strip.

**2. There's a free way to do no worse.**
- Say: "But there's a free way to do no worse: make the 36 extra layers just copy their input. Then the deep net is the shallow net. So the real problem is that plain layers find copying hard."
- Board: a chain of 18 extra two-layer blocks (36 layers) between the strip and the board's centre, each labelled "copy?".
- Slides: p1 highlight "the added layers are identity mapping".
- Connections: p1 phrase → chain.

**3. One block, one number.**
- Say: "Zoom into one extra block. The value 2.0 comes in, and say the ideal output is 2.1, almost a copy. Weights start small, 0.1 each. Without a shortcut, 0.1 times 2.0 is 0.2, ReLU keeps it, and 0.1 times that is 0.02. Way off."
- Board: the plain twin with the token flowing 2.0 → 0.2 → 0.2 → 0.02; target flag 2.1; a long error bracket labelled 2.08.
- Slides: p2 point at Figure 2's "weight layer" boxes.
- Connections: one block in the chain → plain twin (zoom connector).

**4. Add the highway.**
- Say: "Now add the shortcut. Same weights, same 0.02 out of the layers, but we add the input back: 0.02 plus 2.0 is 2.02. Off by only 0.08."
- Board: the highway lights up and the same token splits onto it. ⊕ gives 2.02, with a short error bracket of 0.08 beside the plain one.
- Slides: p2 point at the "identity" arrow in Figure 2; highlight "F(x) := H(x) − x".
- Connections: Figure 2 → highway + detour; the two brackets side by side.

**5. What each block has to learn.**
- Say: "Here's the difference. To hit 2.1, the plain block needs its two weights to multiply to 1.05, a hundred times where they started. The residual block only needs 0.05, a small nudge from 0.01. The layers only learn the correction."
- Board: the dial: start 0.01, a short travel arrow to 0.05 (residual), a long one to 1.05 (plain), each linked to its error bracket.
- Slides: p3 highlight "find the perturbations with reference to an identity mapping".
- Connections: brackets ↔ dial arrows; p3 phrase → dial.

**6. Zero means copy.**
- Say: "And if the best move is to do nothing at all, the residual block just lets its weights go to zero. Out comes 2.0, an exact copy. The plain block at zero outputs 0. It wipes the signal. Chain 18 of each and you can see why the plain net gets worse."
- Board: weights dial to 0. Detour outputs 0 on both paths: residual 2.0, plain 0. The chain updates: residual chain carries 2.0 end to end; plain chain shows the token disappearing at the first block.
- Slides: p2 highlight "easier to push the residual to zero".
- Connections: p2 phrase → zero state; chain → degradation strip.

**7. What they found.**
- Say: "That's what the experiments show. Plain, 34 layers is worse than 18: 28.54 versus 27.94 percent error. With shortcuts, 34 beats 18: 25.03 versus 27.88. And the trained F's turned out small, mostly nudges, just as the picture suggests."
- Board: next to the degradation strip, four bars: plain-18 27.94, plain-34 28.54, ResNet-18 27.88, ResNet-34 25.03. The detours in the chain shrink to small loops labelled "small responses".
- Slides: p5 point at Table 2; p3 highlight "learned residual functions in general have small responses".
- Connections: Table 2 → bars; p3 phrase → small detours.

## The aha

The shortcut changes what costs nothing. With x added back, zero weights means "copy", so each block only has to learn a small correction instead of rebuilding its input, and extra layers can't make the network worse by default.

## Check question

Suppose a block's ideal output is 0 (it should erase the feature). With x = 2.0 and weights starting at 0.1, which block is closer at the start, and what must the residual branch learn?

**Answer:** The plain block is already close (0.02). The residual block outputs 2.02 and must learn F(x) = −2.0 (w1·w2 = −1, or at most −1 because the final ReLU clips negatives to 0). So the shortcut helps when the ideal mapping is closer to a copy than to zero. That is exactly the paper's condition (p3: "closer to an identity mapping than to a zero mapping").

## Why this is good

- Treats the student's objection as correct (same expressive power) and moves the question to what is easy to reach. That shift is the real insight.
- Follows the paper's own argument (degradation, copying, perturbations, small responses, Table 2) rather than a popular substitute such as "it fixes vanishing gradients".
- One number flowing through one block keeps the maths checkable in your head. The same drawing is reused for the zero-weight case and for the chain of 18 blocks.
- Relations are visible: error brackets are tied to travel on a weight dial, and the chain is tied to the degradation curve, so cause and effect are connected on the board.
- Begins and ends at the paper's evidence, so the intuition is checked against the paper's data.
- The check question tests the *boundary* of the idea (when the shortcut would not help), which shows real understanding.

## Appendix (hidden): arithmetic

- Plain at start: w1·x = 0.1 × 2.0 = 0.2; relu(0.2) = 0.2; w2 × 0.2 = 0.02. Error |2.1 − 0.02| = 2.08.
- Residual at start: 0.02 + 2.0 = 2.02. Error 0.08. (The final ReLU after the addition in Fig. 2 leaves positive values unchanged.)
- Targets: plain w1·w2·2.0 = 2.1 → w1·w2 = 1.05. Residual 2.0 + w1·w2·2.0 = 2.1 → w1·w2 = 0.05. Start product 0.1 × 0.1 = 0.01. Ratios 105× and 5×.
- Zero weights: plain 0; residual 0 + 2.0 = 2.0.
- 56 − 20 = 36 extra layers (Figure 1) = 18 two-layer blocks like Figure 2. The beat-2 claim (copying gives "no worse") is the paper's p1 construction.
- Table 2 (p5), top-1 error, 10-crop: plain-18 27.94, plain-34 28.54, ResNet-18 27.88, ResNet-34 25.03. Plain gets worse by 0.60; ResNet improves by 2.85.
- Check: 2.0 + w1·w2·2.0 = 0 → w1·w2 = −1 (relu(w1·x) needs w1 > 0 for x = 2, so w2 < 0). With the final ReLU, any F ≤ −2.0 gives output 0.
- Simplification: a scalar toy stands in for vector feature maps and conv layers; stated aloud as "one number".
