// src/ui/landing/Landing.tsx — the start screen ("Ink on the Page"): the hero lesson, the rectangle
// that holds for every n, the same kind of lesson slowed down, and the close with a drop zone. Loaded
// lazily by EmptyState, which owns the file input, drag and drop and the error; the motion lives in
// mount.ts and stops when this unmounts.
import { useEffect, useId, useRef } from 'react';
import '@fontsource-variable/bricolage-grotesque/standard.css';
import '@fontsource-variable/stix-two-text/wght.css';
import '@fontsource-variable/stix-two-text/wght-italic.css';
import './landing.css';
import { mountLanding } from './mount';

export type LandingProps = { onPick(): void; onSample(): void; error?: string };

const Arrow = () => (
  <svg className="pl-arr" viewBox="0 0 18 12" aria-hidden="true"><path d="M1 6h15M11 1l5 5-5 5" /></svg>
);

/** The petu mark: a disc split by a two-step staircase seam (public/brand/petu-mark-*.svg). The seam is
 *  thicker at small sizes: 9 at ~32px (nav), 12 at ~16–20px (footer). */
function PetuMark({ seam }: { seam: number }) {
  const id = 'pl-mark-' + useId().replace(/[^a-zA-Z0-9_-]/g, '');
  return (
    <svg className="pl-mark" viewBox="0 0 100 100" aria-hidden="true" focusable="false">
      <mask id={id} maskUnits="userSpaceOnUse" x="-60" y="-60" width="220" height="220">
        <rect x="-60" y="-60" width="220" height="220" fill="#fff" />
        <path d="M-150 77L36.5 77L36.5 50L63.5 50L63.5 23L250 23" fill="none" stroke="#000" strokeWidth={seam} strokeLinejoin="miter" />
      </mask>
      <circle cx="50" cy="50" r="46" fill="#111111" mask={`url(#${id})`} />
    </svg>
  );
}

const STEPS: { seg: string; title: string; body: string }[] = [
  { seg: 'ask', title: "Ask the way you'd ask a person.", body: "Circle the part that's bothering you, or just type. Here, a student wants to know why both balls land at the same time." },
  { seg: 'page', title: 'It starts on your page.', body: "petu goes to the line you mean and marks it, so you're never left guessing what \u201cthis\u201d refers to." },
  { seg: 'words', title: 'Every mark lands on its word.', body: 'As each word appears in the caption, its mark appears on the board. One sentence at a time.' },
  { seg: 'board', title: 'The picture builds as the idea does.', body: 'Nothing appears finished. The dropped ball falls, the thrown one keeps level with it, and the two land together, so you watch it happen instead of being told about it.' },
  { seg: 'check', title: "Then it checks you've got it.", body: 'A quick question can follow the answer. Ask \u201cwhy?\u201d or \u201csimpler\u201d at any point and it keeps going.' },
];

export default function Landing({ onPick, onSample, error }: LandingProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const html = document.documentElement;
    html.classList.add('pl-page');
    const rt = mountLanding(rootRef.current!);
    return () => { rt.dispose(); html.classList.remove('pl-page'); };
  }, []);

  return (
    <div className="pl" ref={rootRef}>
      <header className="pl-nav">
        <div className="pl-frame">
          <a className="pl-word" href="#top" aria-label="petu"><PetuMark seam={9} />petu</a>
          <nav className="pl-links"><a className="pl-ink-link" href="#how">How it works</a></nav>
          <button type="button" className="pl-btn pl-sm" onClick={onPick}>Start with your notes</button>
        </div>
      </header>

      <main id="top">
        <section className="pl-hero">
          <div className="pl-frame">
            <div className="pl-hero-copy">
              <h1>
                <span className="pl-ln">The tutor</span>
                <span className="pl-ln">that shows</span>
                <span className="pl-ln">you <span className="pl-why">why.<svg data-pl="swash" viewBox="0 0 200 40" preserveAspectRatio="none" aria-hidden="true"><defs /><g /></svg></span></span>
              </h1>
              <p className="pl-lede">petu is a personal tutor that teaches on your own slides, notes and textbooks. It goes to the line you're stuck on, <b>marks it</b>, and <b>draws the idea out</b> beside it until you can see why it's true.</p>
              <div className="pl-ctas">
                <button type="button" className="pl-btn" onClick={onPick}>Start with your notes <Arrow /></button>
                <button type="button" className="pl-ink-link" data-pl="replay">Watch it again</button>
              </div>
              <p className="pl-fine">Works from a PDF of whatever you're studying.</p>
            </div>
            <div
              className="pl-hero-stage"
              data-pl="hero-stage"
              role="img"
              aria-label="petu explaining why the sum formula divides by 2: it marks the formula on the slide, stacks 1 + 2 + 3 + 4 as a staircase on the board, fits a turned copy against it to make a 4 by 5 rectangle, and shows the staircase is half of it, 4 × 5 ÷ 2 = 10."
            />
          </div>
        </section>

        <section className="pl-unfold pl-ruled" data-pl="unfold">
          <div className="pl-pin">
            <div className="pl-frame">
              <div className="pl-copy-col">
                <h2>Once you see it, it's true for every <span className="pl-m"><i>n</i></span>.</h2>
                <p className="pl-lede">That's the moment petu is built for. Not the answer, but the picture that makes the answer obvious, so it's still there in the exam.</p>
                <div className="pl-readout" data-pl="readout" aria-live="off" />
              </div>
              <svg data-pl="grow" viewBox="0 0 640 640" role="img" aria-label="the staircase as half of an n by n plus 1 rectangle" />
            </div>
          </div>
        </section>

        <section className="pl-story pl-ruled" id="how">
          <div className="pl-frame">
            <div className="pl-head">
              <h2>One question,<br />start to finish.</h2>
              <p className="pl-lede">A second lesson, slowed down: everything petu does in the few seconds after you ask.</p>
            </div>
            <div className="pl-body">
              <div className="pl-view" data-pl="story-view" role="img" aria-label="A second lesson, step by step: a student asks why a dropped ball and one thrown sideways land at the same time; petu marks y = ½ g t² on the slide, draws both balls tick by tick at the same drop (1, 4, 9, 16), shows they both land at tick 4, then checks: thrown twice as fast, it still lands at tick 4.">
                <div data-pl="story-stage" />
              </div>
              <div className="pl-steps">
                {STEPS.map((s) => (
                  <div className="pl-step" data-seg={s.seg} key={s.seg}><h3>{s.title}</h3><p>{s.body}</p></div>
                ))}
              </div>
            </div>
          </div>
        </section>

        <section className="pl-close pl-ruled" id="start">
          <div className="pl-frame">
            <div>
              <h2>Bring the lecture you're stuck on.</h2>
              <p className="pl-lede">Open your slides, notes or a textbook chapter and ask about the first thing that doesn't make sense. Any subject.</p>
              <div className="pl-ctas">
                <button type="button" className="pl-btn" onClick={onPick}>Start with your notes <Arrow /></button>
                <button type="button" className="pl-ink-link pl-flush" onClick={onSample}>Try a sample lecture</button>
              </div>
            </div>
            <button type="button" className="pl-drop" onClick={onPick} aria-label="Drop a PDF here, or choose a file">
              <svg className="pl-sheetart" viewBox="0 0 120 92" aria-hidden="true">
                <rect x="14" y="6" width="92" height="70" rx="2" fill="#fff" stroke="#17171a" strokeWidth="1.2" />
                <rect x="8" y="12" width="92" height="70" rx="2" fill="#fff" stroke="#17171a" strokeWidth="1.2" />
                <path d="M18 26h46M18 38h64M18 48h52M18 58h58" stroke="#c9c9c4" strokeWidth="2" strokeLinecap="round" />
                <rect x="16" y="35" width="70" height="8" fill="rgba(42,63,240,.14)" />
              </svg>
              <span className="pl-big">Drop a PDF here</span>
              <span className="pl-sub">or choose a file. Slides, notes, a paper, a chapter.</span>
            </button>
          </div>
        </section>
      </main>

      <footer className="pl-foot pl-ruled">
        <div className="pl-frame"><a className="pl-word" href="#top" aria-label="petu"><PetuMark seam={12} />petu</a><span className="pl-r">© 2026</span></div>
      </footer>

      <p className="pl-error" role="alert">{error ?? ''}</p>
    </div>
  );
}
