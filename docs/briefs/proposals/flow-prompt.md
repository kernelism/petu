# Proposal: prompt and grammar changes for "Flow across the document"

Status: proposal only (the flow lane does not edit `server/prompt/*` or `src/script/*`). The engine
side ships without any of this; each item below would make it better. Bump `PROMPT_VERSION` with any
prompt wording change and run the dev split (`compare.ts` ACCEPT) before adopting.

## 1. Highlight wording (prompt, "pointing" section)

The engine now grows a highlighted/underlined fragment to its sentence, bullet, line or equation
(`src/locate/unit.ts`), keeping the quoted words as an inner emphasis; quotes of ≤ 2 words stay as
quoted (symbols, terms). The model can help by quoting the words that matter rather than a span cut
mid-phrase. Suggested sentence (general, any subject):

> Highlight what you are talking about as a whole statement — a sentence, a bullet, an equation —
> or a single term or symbol you are defining; never a few words cut out of the middle of a phrase.

## 2. Announce journeys (prompt, "timing" / "walk the pages" section)

The engine shows the route chip ("p9 → p2 · The Law of Demand"), holds the narration 800 ms at the
move and rests on the destination before marking it. What it cannot do is say *why* we go. Suggested:

> When you move to a page that is not next to the current one, say where you are going and why in
> the sentence that moves ("To see where this line comes from, go back to the demand curve…"), and
> when you come back, say so ("Back on this slide, …").

## 3. Optional part tag (grammar + prompt)

Parts are derived today from journeys (`src/playback/parts.ts`): titled by the destination's
bookmark or page title, "Back to pN" for a return. That gives titles like "The Law of Demand", not
the founder's "Where 1.645 comes from". An optional tag would let the model name a part:

```
{{part "Where 1.645 comes from"}} To see where this number comes from, {{scroll p=422}} …
{{part "Back to this p-value"}} {{scroll p=479}} Back here, …
```

- Parser (`src/script/`): `part` with one quoted title (≤ 40 chars), no target; a layout-free action
  the director ignores. Malformed → skipped like any tag.
- `deriveParts`: a `part` action starts a part at its word (overrides the journey split there; a
  journey right after a `part` tag does not start another one); its title replaces the derived one.
- Prompt: "If the answer has more than one movement, you may open each with `{{part "short title"}}`
  (a few words naming the idea, not the page)." No cap, no recipe; most answers have one part.

## 4. Go-deeper follow-up context (agent pipeline)

The inset sends the follow-up through the normal ask flow with the part's narration appended to the
question text (`App.tsx` `askDeeper`). Cleaner: an `AskContext.followUp = { partTitle, partText,
page }` field the stage-2 prompt renders as "The student paused your answer during the part …; answer
only this, briefly; the main answer resumes after." The follow-up should also be told it plays
narration-only today (see open problems below), or get its own board lane.

## Open problems this proposal does not solve

- The inset's follow-up plays narration only: its tags are parsed and dropped, because a second
  answer on the same director would reset the paused answer's registry and marks. Drawing in the
  inset needs a second Director with its own page layers / board section that is removed on close.
- Pause stops new words and actions; ink already fired (up to 450 ms ahead of its word) and running
  kit sweeps still finish while paused.
