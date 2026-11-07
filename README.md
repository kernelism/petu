# petu

**The tutor that shows you why.**

petu teaches from your own slides, notes and textbooks. Open a PDF and ask a question, by typing or
by voice. The tutor answers out loud with captions. It goes to the right page, marks the lines it is
talking about, and draws the idea out on a board beside the slides. Each mark lands on the word that
refers to it, so the diagram builds up as the explanation goes.

> **Status:** pre-alpha. It runs as a local dev server on your own PDFs, in a desktop browser.

---

## Quick start

You need **Node 22.6+** and an **OpenAI API key**.

```bash
npm install
cp .env.example .env    # then fill in the keys below
npm run dev             # → http://localhost:5180
```

| Key in `.env` | Needed for |
|---|---|
| `OPENAI_API_KEY` | **Required.** Answers and the spoken narration. |
| `SPEECHMATICS_API_KEY` | Optional. Asking by voice. Without it the mic button is hidden. |
| `PETU_ANTHROPIC_KEY` | Optional. Only when you set `PETU_MODEL` to a Claude model. |

The keys stay in the local server. The browser never sees them; for voice it gets a 60-second
Speechmatics key. Never commit `.env`.

## Using it

1. **Open a PDF.** Click **Start with your notes**, or drop a PDF onto the window. You can also
   open one by URL with `http://localhost:5180/?src=<url>`.
2. **Ask.** Press `/` and type, or hold `V` and speak. petu answers about the page in view and
   reads the text of the pages around it, so it can jump elsewhere.
3. **Follow along.** Scroll freely while it answers; **Back to answer** brings you back.
   Follow-ups like "why?" or "simpler" carry on from the last answer.
4. **Point at things.** Press `D` to draw on the page yourself, circle something, then ask
   "what is this?".

Press `?` for every shortcut. The common ones:

| Key | Does |
|---|---|
| `/` | Ask a question |
| `V` (hold) | Ask by voice |
| `Space` | Pause / resume |
| `R` | Replay the sentence |
| `←` `→` | Previous / next part |
| `<` `>` | Slower / faster |
| `Esc` | Stop, or close an aside or drawing |
| `G` | Go to page |
| `S` | Session list |
| `D` | Draw on / off |

**Worked numbers.** Every number in a worked example is computed by the app, not written by the
model. When the example's numbers come from the tutor rather than your slides, the answer is
labelled **Example numbers, not from your slides**.

**Privacy.** Each question sends the page in view as an image, the text of nearby pages and your
question to OpenAI (or Anthropic, if you chose a Claude model). The narration text goes to OpenAI
to be spoken. Voice questions stream your microphone to Speechmatics. Nothing is uploaded anywhere
else.

## Demos (no API key needed)

| URL | What it shows |
|---|---|
| `/?demo=1` | Highlights and drawing directly on the page |
| `/?demo=side` | The board opens beside the slides, with a connector to the slide |
| `/?demo=plane` | A bigger sketch: the board takes 0.6 of the window |
| `/?script=relational` | The geometry grammar (names, constructions) on the sample page |
| `/?script=toolkit` | Every drawing tool once (dev) |

Add `&style=hand` or `&style=clean` for other drawing styles.

## Your own test PDFs

- Files in `public/dev/` (gitignored) are served at `/dev/<name>.pdf`.
- Folders listed in `PETU_PDF_DIRS` are served at `/api/dev-pdf/<name>.pdf`.

## Spending caps

Every call goes through a local ledger (`.petu/spend.json`). It reserves a request's worst case
before sending and refuses anything that would cross a cap. A typical answer costs about half a
cent. When a cap is reached, the ask bar says which one and shows the command that raises it for
one run:

```bash
PETU_DAILY_CAP_USD=6 npm run dev
```

Command-line values win over `.env`. Every knob (model, effort, caps, output limit) is listed with
its default in `.env.example`.

## Debugging and bug reports

**`?debug`.** Add `&debug` to the URL for a panel in the bottom left. It shows the model and
effort, timings from Enter to the first word and first ink, this answer's cost, spend against the
cap, prompt caching, server notes, and every action with its timing. Actions the engine skipped are
greyed out with the reason; an unknown mark is skipped, never guessed.

**Report a bug.** Press the flag in the top bar (or `Shift+R`) the moment something looks wrong,
add an optional note, and press Enter. The dev server saves a report to
`.petu/reports/<time>-<slug>/`: `report.json` with the question, script, every action and its
timing, skipped actions, latency, cost and window size, plus `screenshot.png`. Tell the engineer
the time, or run:

```bash
npm run reports            # recent reports, one line each
npm run reports -- last    # a digest of the latest (or pass an id prefix)
```

Reports keep the PDF's name, hash and page, never its content, and never a key. Every answer is
also logged to `.petu/answers.jsonl`.

## Known limits

- **Digital PDFs only.** A scanned page has no text to quote, so the tutor points by position
  instead, less precisely.
- **Flattened figures** and unusual vector exports give the tutor fewer marks to point at; it falls
  back to quoting nearby text.
- **One page in detail.** An answer looks closely at one page; the others are text only.
- **Occasional skipped drawings.** A curve that loops back on itself, or a construction the engine
  can't resolve, is skipped rather than drawn wrong (about 1 tag in 150).
- **Image views** are at most 48×48 cells, and computed values are shown as decimals.
- **Latency.** The first caption word usually appears 1.2–1.6 s after Enter, sometimes 2–3 s.
- **Desktop browsers only**, one document at a time.

## Development

```bash
npm test                          # unit tests (Vitest)
npm run typecheck                 # tsc --noEmit
npm run build                     # typecheck + production build into dist/
npm run fixture                   # regenerate the sample PDF in public/fixtures/
npm run ground -- <pdf> <page…>   # the text and marks the model sees (no API call)
```

## How it works

The tutor writes one streamed script: narration with inline action tags.

```
The thin lens equation comes from {{shade p=36 pts=#d1 #d4 #d5 outline}} two similar triangles.
{{sketch id=s near=p36 fit}} {{let on=s O=0,0 X=300,-200 M=mid(O,X)}} Draw the ray {{line on=s from=O through=M}} …
```

The page is given to the model as text lines and named figure marks (`#d3` a dot, `#s2` a segment),
so it points by name and the engine computes every coordinate: marks, midpoints and crossings land
exactly. Calculations are small programs the app runs, so the numbers on screen are always right.
The app parses the stream as it arrives, times each action to the word after it, and plays it on
the page and the board.

See [AGENTS.md](AGENTS.md) for the architecture and contracts, and [PRODUCT.md](PRODUCT.md) for the
product.

## Roadmap

1. ~~Viewer, student canvas, playback engine, captions~~
2. ~~Board and drawing toolkit~~
3. ~~Streamed answers with a spend cap~~
4. ~~Voice: spoken narration and voice questions~~
5. ~~Worked examples with computed numbers~~
6. Polish: settings, history across reloads, error states
