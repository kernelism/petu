# petu

A tutor that explains a PDF by performing on it.

Open a PDF and ask a question. The tutor answers in narrated captions while it scrolls to the
right page, highlights the lines it's talking about, and draws to explain — on the page, on the
desk beside it, or on a full-screen canvas for bigger diagrams. Every mark lands on the word that
refers to it, and the diagram builds up as the explanation goes.

> Status: pre-alpha. Answers run through a local dev server on your own PDFs. Voice comes later.

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
  at `/dev/<name>.pdf`; files in the folders listed in `PETU_PDF_DIRS` at `/api/dev-pdf/<name>.pdf`.

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

Every call goes through a persistent local ledger (`.petu/spend.json`) that reserves a request's
worst case before sending and refuses anything that would cross a cap. A typical answer costs about
half a cent. When a cap is reached the ask bar says which one and shows the command that raises it
for one run, e.g.

```bash
PETU_DAILY_CAP_USD=6 npm run dev
```

Command-line values win over `.env`, so nobody needs to edit `.env` for caps. All knobs (model,
effort, caps, output limit) are listed in `.env.example`.

### Known limits

- Digital PDFs only: a scanned page has no text to quote (the tutor says so and points by marks
  or coordinates inside the image, less precisely).
- Figures drawn as one flattened image, unusual vector exports (text as outlines, pattern fills)
  give the tutor fewer marks to point at; it then falls back to quoting nearby text.
- One answer looks at one page in detail; other pages are text only.
- Sketches are deliberately simple (3–7 elements). A curve whose points loop back on themselves is
  skipped rather than drawn wrong; occasionally a construction the model writes can't be resolved
  and that one element is skipped.
- The first caption word usually appears 1–1.5 s after Enter, sometimes 2–3 s.
- No history across reloads, one document at a time, desktop browsers only.

### Reporting a bug

Include the question, the PDF and page number, and a screenshot with `&debug` open (the skipped
actions and their reasons are the most useful part). `npm run ground -- file.pdf 12` prints the
text lines and figure marks exactly as sent to the model; it reads the PDF locally and makes no
API call.

## Demos (no API key needed)

| URL | What it shows |
|---|---|
| `/?demo=1` | Highlights and drawing directly on the page |
| `/?demo=side` | The tutor sketches beside the page, with a connector to the slide |
| `/?demo=plane` | Full-screen canvas; the page becomes a reference card |
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

See [AGENTS.md](AGENTS.md) for architecture and contracts.

## Roadmap

1. ~~Viewer, student canvas, playback engine, captions~~
2. ~~Desk canvas (sketch beside the page, full-screen takeover) and drawing toolkit~~
3. ~~Agent: OpenAI-backed answers streamed into the engine, with a spend cap~~
4. Polish: settings, history, error states
5. Voice
