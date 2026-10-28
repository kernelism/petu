# petu

A tutor that explains a PDF by performing on it.

Open a PDF and ask a question. The tutor answers in narrated captions while it scrolls to the
right page, highlights the lines it's talking about, and draws to explain — on the page, or on a
board that opens beside the slides (the slides move to the left; close the board with × or Esc). Every mark lands on the word that
refers to it, and the diagram builds up as the explanation goes.

> Status: pre-alpha. Checkpoint 2 (the AI agent) works end to end on your own PDFs through a
> local dev server. Voice comes later.

## Run it on your own PDFs

Requires Node 22.6+ and an OpenAI API key.

```bash
npm install
cp .env.example .env      # then set OPENAI_API_KEY=… in .env (nothing else needs changing)
npm run dev               # http://localhost:5180
```

Then either:

- **drop a PDF** onto the window, or
- open it by URL: `http://localhost:5180/?src=<url>`. Files in `public/dev/` (gitignored) are served
  at `/dev/<name>.pdf`; files in `~/Documents/670/contents` (or the folders in `PETU_PDF_DIRS`) at
  `/api/dev-pdf/<name>.pdf`.

Scroll to the page you're asking about, press `/`, type a question, press Enter. The tutor answers
about the page in view (it also reads the text of the pages around it and can jump elsewhere).
While it answers, scroll freely; a **Back to answer** pill brings you back. `Esc` stops an answer,
`D` lets you draw on the page yourself: circle something, then ask "what is this?". Follow-ups
("why?", "simpler") carry on from the previous answer.

**Privacy:** each question sends the page in view as an image, the text of nearby pages and your
question to OpenAI. The key stays in the local server and never reaches the browser.

### `?debug`

Add `&debug` to the URL for a small panel (bottom left; click to expand):

- model and effort; upstream time to first token; Enter → first chunk, first caption word, first
  action, first ink;
- cost of this answer, total spent / cap, and how much of the prompt was cached;
- notes from the server (lint, dropped text, retries) and the model's private sketch `plan ▸`;
- every action with its word time, how early or late it started, its duration, and — greyed — any
  action the engine **skipped** and why (an unknown mark or point is skipped, never guessed).

### Spending caps

Every call goes through a persistent ledger (`.petu/spend.json`) that reserves a request's worst
case before sending and refuses anything that would cross a cap:

- **$40 hard stop** for checkpoint 2 in total (development and evaluation included; can only be
  lowered);
- your budget, the `founder` phase: **$21.99**, at most **$3 a day**.

A typical answer costs about half a cent. When a cap is reached the ask bar says which one and
shows the command that raises it **for one run**, e.g.

```bash
PETU_DAILY_CAP_USD=6 npm run dev      # today's cap
PETU_CAP_FOUNDER=25 npm run dev       # your phase budget (the $40 total still applies)
```

Command-line values win over `.env`; nobody needs to edit `.env` for caps. Other knobs (model,
effort, output limit) are listed in `.env.example`.

### Known limits

- Digital PDFs only: a scanned page has no text to quote (the tutor says so and points by marks
  or coordinates inside the image, less precisely).
- Figures drawn as one flattened image, unusual vector exports (text as outlines, pattern fills)
  give the tutor fewer marks to point at; it then falls back to quoting nearby text.
- One answer looks at one page in detail; other pages are text only.
- A curve whose hand-given points loop back on themselves is skipped rather than drawn wrong;
  occasionally a construction or a page mark the model writes can't be resolved and that one element
  is skipped (about 1 in 150 tags on the dev questions). Graphs drawn from a formula ({{plot}}) and
  every computed number come from the engine.
- Image views are at most 48×48 cells; computed values are written as decimals (only fractions the
  tutor wrote itself, like 1/9 weights, stay fractions).
- The first caption word usually appears 1.2–1.6 s after Enter, sometimes 2–3 s.
- No history across reloads, one document at a time, desktop browsers only.

### Reporting a bug

Instead of a screen recording, send:

1. the question, the PDF name and the page number;
2. what the tutor saw on that page:
   ```bash
   npm run ground -- path/to/file.pdf 12
   ```
   (prints the text lines and figure marks exactly as sent to the model; it reads the PDF locally
   and makes no API call);
3. a screenshot with `&debug` open (expand the panel; the skipped actions and their reasons are
   the most useful part). Every answer is also recorded locally in `.petu/answers.jsonl` (question,
   page, the script as sent, malformed tags with their raw text); its last line is enough;
4. optionally the raw answer (costs one more answer): open the PDF by URL with `&eval&page=12`
   added, then in the browser console run
   `await __petu.ask("your question"); copy(JSON.stringify(__petu.result()))` and paste the result.

## Demos (no API key needed)

| URL | What it shows |
|---|---|
| `/?demo=1` | Highlights and drawing directly on the page |
| `/?demo=side` | The board opens beside the slides; a sketch with a connector to the slide |
| `/?demo=plane` | A bigger sketch: the board takes 0.6 of the window |
| `/?script=relational` | The agent's geometry grammar (names, constructions) on the sample page |
| `/?script=toolkit` | Every drawing tool once (dev) |

Add `&style=hand` / `&style=clean` for other drawing styles.

## Development

```bash
npm test             # unit tests (Vitest)
npm run typecheck    # tsc --noEmit
npm run build        # typecheck + production build
npm run fixture      # regenerate the sample PDF in public/fixtures/
npm run ground -- <pdf> <page…>                      # the model's view of pages
npm run eval -- --split dev --config terra-none      # judged eval of the real app (spends)
```

Never commit `.env`. Personal test PDFs go in `public/dev/` (gitignored).

## How it works

The tutor writes one streamed script: narration with inline action tags.

```
The thin lens equation comes from {{shade p=36 pts=#d1 #d4 #d5 outline}} two similar triangles.
{{sketch id=s near=p36 fit}} {{let on=s O=0,0 X=300,-200 M=mid(O,X)}} Draw the ray {{line on=s from=O through=M}} …
```

The page is listed for the model as text lines and figure marks (`#d3` a dot, `#s2` a segment),
so it points by name, and the engine computes all coordinates: marks, midpoints and line crossings
land exactly. The app parses the stream incrementally, times each action to the word after it,
and executes it against the viewer and the drawing desk.

See [AGENTS.md](AGENTS.md) for architecture, contracts, plan and scope.

## Roadmap

1. ~~Viewer, student canvas, playback engine, captions~~
2. ~~Desk canvas and drawing toolkit~~ (now: slides left, board right)
3. ~~Agent: OpenAI-backed answers streamed into the engine, with a spend cap~~
4. Polish: settings, history, error states
5. Voice
