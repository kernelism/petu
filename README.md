# petu

A tutor that explains a PDF by performing on it.

Open a PDF and ask a question. The tutor answers in narrated captions while it scrolls to the
right page, highlights the lines it's talking about, and draws to explain — on the page, on the
desk beside it, or on a full-screen canvas for bigger diagrams. Every mark lands on the word that
refers to it, and the diagram builds up as the explanation goes.

> Status: pre-alpha. The viewer, canvas and playback engine work end to end on hand-written
> scripts. The AI agent (checkpoint 2) is next. Voice comes later.

## Quick start

Requires Node 22.6+ (the fixture script uses built-in TypeScript stripping).

```bash
npm install
npm run dev
```

Open the URL Vite prints, then drop a PDF onto the window, or try a demo:

| URL | What it shows |
|---|---|
| `/?demo=1` | Highlights and drawing directly on the page |
| `/?demo=side` | The tutor sketches beside the page, with a connector to the slide |
| `/?demo=plane` | Full-screen canvas; the page becomes a reference card |
| `/?script=toolkit` | Every drawing tool once (dev) |

Add `&debug` for the timing panel, or `&style=hand` / `&style=clean` for other drawing styles.

While the tutor is answering, scroll freely; a **Back to answer** pill brings you back. Press `D`
to draw on the page yourself, `/` to focus the ask bar, `Esc` to stop an answer.

## Development

```bash
npm test             # unit tests (Vitest)
npm run typecheck    # tsc --noEmit
npm run build        # typecheck + production build
npm run fixture      # regenerate the sample PDF in public/fixtures/
```

For the upcoming agent, copy `.env.example` to `.env` and set `OPENAI_API_KEY`. The key is read
only by the local server and never sent to the browser. Never commit `.env`.

Personal test PDFs go in `public/dev/` (gitignored).

## How it works

The tutor writes one streamed script: narration with inline action tags.

```
Take this point x {{circle p=3 "x"}} in the left image.
{{sketch id=side near=p3 size=m}} Seen from the side, {{point on=side at=300,570 "C"}} camera C…
```

The app parses it incrementally, times each action to the word after it, and executes it against
the viewer and the drawing desk. Drawings anchor to the PDF's own text where possible, so marks
land exactly on what they point at.

See [AGENTS.md](AGENTS.md) for architecture, contracts, plan and scope.

## Roadmap

1. ~~Viewer, student canvas, playback engine, captions~~
2. ~~Desk canvas (sketch beside the page, full-screen takeover) and drawing toolkit~~ — in review
3. Agent: OpenAI-backed answers streamed into the engine, with a spend cap
4. Polish: settings, history, error states
5. Voice
