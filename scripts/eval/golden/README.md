# Golden lessons

Six hand-designed answers that define what an ideal petu lesson looks like: the narration, the one connected board scene, the pointing on the PDF, and the connections between them. They anchor few-shot examples and the eval judge. They are deliberately spread across unrelated subjects and question types, so nothing here is a recipe for any one topic.

Designs only. They reference pages by number and quote at most a few words; the documents themselves stay in `.petu/corpus/` (not committed). Each file ends with a hidden arithmetic appendix that the performer never narrates.

| id | document · page | question type | question |
|---|---|---|---|
| `physics-third-law-cart` | OpenStax University Physics 1 · p230 | why | "If every push has an equal and opposite push back, why don't they all cancel? How does the professor's cart ever speed up?" |
| `econ-tax-incidence-hotels` | OpenStax Principles of Economics 3e · p139 | misconception | "Won't hotels just add the tax onto the bill, so guests end up paying all of it?" |
| `stats-confidence-interval-nets` | OpenStax Introductory Statistics 2e · p418 | visualise this | "Can you help me picture what '95% confident' actually means? Is there a 95% chance the true mean is between 1.8 and 2.2?" |
| `calc-sin-over-theta` | OpenStax Calculus 1 · p159 | derivation / limit | "I can follow the inequalities but I don't see *why* sin θ / θ goes to 1." |
| `resnet-residual-shortcut` | arXiv 1512.03385 (ResNet) · p2 | paper intuition | "Why does adding x back help, if F(x) + x can represent the same functions?" |
| `conformal-lost-page` | arXiv 2107.07511 (conformal prediction) · p4 | vague / lost | "I'm lost on this page. What is going on?" |

Each lesson has: the question; the student's likely confusion; the carrying example; the scene (things, relations, layout, PDF connectors); 6–7 beats (verbatim narration, board change, slide pointing, connections); the aha; a check question with its answer; why it is good; and the arithmetic appendix.

## Shared principles (judge guidance)

These hold across all six lessons. They say nothing about any particular subject, and a judge should apply them that way.

**Understanding the question**
1. **Diagnose before explaining.** The lesson aims at the specific thing this student is missing (a wrong combination of true facts, a misplaced probability, a missing picture, a lost main point), not at the topic in general. A vague question gets one main point chosen for it, not a summary of the page.
2. **Take the student's view seriously.** If part of their intuition is right, say so (the ResNet student is right about what the two forms can represent). If it's wrong, test it on the example and let it fail visibly (the $210 hotel price leaves 200 empty rooms). Don't just assert the correct answer.

**The example**
3. **One carrying example from start to finish.** Concrete values, the page's own values when it gives them, chosen so the effect is visible (lopsided splits, a loose-then-tight squeeze, a miss you can count). No second example until the check question.
4. **Correct maths, cross-checked.** Every number follows from the example, and where possible the lesson gets the same result two ways (all three system boundaries give 1.5 m/s²; hotel tax collected from either side gives the same prices). Simplifications are stated, and pretend devices (a known true mean) are labelled and then removed.

**The board**
5. **One scene that evolves.** A central picture appears early and later beats change it: move, re-weight, relabel, fade, shrink, extend. They don't add separate blocks. By the end the board is a record of the whole explanation.
6. **Relations are drawn, not just named.** Thickness means size, tint means which body a force acts on, leader lines show where each piece came from, and labelled arrows say "this becomes that" or "same cut, other side". Symbols in the page's formulas are attached to the parts of the drawing they stand for.
7. **Layout follows meaning.** Things sit next to what they explain: chips above the curve they cause, bars at the height of the gaps they measure, the extra slot under the line it joins. Asymmetric, never a grid of equal boxes, with room left for what grows later.

**The document**
8. **Tie to the page throughout, not only at the end.** At the moment an idea is used, the slides scroll to the exact words, figure, or equation part, and a connector joins it to the board element. The lesson ends by reading the page's own statement back in light of the picture.
9. **Faithful to the source.** Use the document's argument and evidence, not a popular substitute (the ResNet lesson uses degradation and identity mappings, not "vanishing gradients"; the calculus lesson uses the page's length inequality, not the area proof). Don't claim more than the page supports.

**Narration**
10. **Plain, warm, second person, short sentences.** Every sentence earns a board change or a pointing action. The intuitive word comes before the technical term ("can't walk away" before "inelastic", "a line around them" before "system"). No filler, no recap lists, no praise.
11. **Predict, then reveal.** At least one moment where the student can guess before the board answers: a "?" left on an arrow, "which do you think is longest?", "watch which nets catch the post".
12. **Right length.** About 5–9 beats, each one move. The lesson answers the question asked; it doesn't re-teach the chapter.

**Ending**
13. **A repeatable aha.** One or two sentences that state the mechanism in plain words. A student could say it to a friend.
14. **A check question that needs transfer.** It changes one thing (a new case, a flipped condition, a changed input, a hidden assumption such as radians) so recall alone can't answer it. It comes with a worked answer.

## What a judge should penalise

- Several unrelated mini-examples, or a new picture every beat.
- Uniform symmetric boxes with no connectors, or a board that would make sense without the narration (or narration that would make sense without the board).
- Numbers that are wrong, inconsistent between beats, or invented when the page gave values.
- No pointing at the PDF, or pointing that isn't timed to the idea being used.
- Re-summarising the page instead of resolving the confusion; or explaining with a different argument from the document's while presenting it as the document's.
- Jargon before intuition; filler; a check question that is just recall.
