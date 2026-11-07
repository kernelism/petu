// src/ui/trail.ts
/**
 * The session trail (spec "v1 learner UX"): the board is one continuous session, and each answer's
 * first section carries a question header (Desk.headNext). Asides get a smaller, indented head that
 * also frames their inset; when the aside ends it collapses to a marker that reopens it.
 * Plain DOM: the board is not React (src/desk/Desk.ts owns it); these elements are placed by Desk.
 */

export type TrailKind = 'answer' | 'aside' | 'check';

/** Height of an answer's header row on the board (px, including the air under it). */
export const HEAD_H = 44;
/** Height of an aside's title row (and of its collapsed marker). */
export const ASIDE_HEAD_H = 40;

export type TrailHead = {
  el: HTMLElement;
  h: number;
  /** "p.86–88 · 0:52": the pages it taught from (pagesLabel) and how long it played. */
  setMeta(meta: string): void;
  /** The answer worked an example whose numbers are not the slides' (src/calc/provenance.ts): its head says so. */
  markExample?(): void;
};

/** What an answer's head says when its worked numbers are an example (teaching-engine §3.6 check (b), §7 decision 4). */
export const EXAMPLE_NOTE = 'Example numbers, not from your slides';

/** "0:52" from ms. */
export function clockOf(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** The trail's line for an answer: its question, prefixed by how it relates to the one before. */
export function trailTitle(kind: TrailKind, question: string, about?: string | null): string {
  if (kind === 'check') return `Check yourself: ${question}`;
  return about ? `About ${about}: ${question}` : question;
}

const node = <K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text?: string): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  e.className = cls;
  if (text != null) e.textContent = text;
  return e;
};

const PLAY = '<svg width="11" height="11" viewBox="0 0 12 12" aria-hidden="true"><path d="M3 1.8v8.4L10 6z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg>';

/**
 * An answer's header: number, question, meta; hover or focus shows Replay (plays the recorded script
 * again, no new call). The whole row is the button.
 */
export function answerHead(o: { num: string; question: string; check?: boolean; onReplay(): void }): TrailHead {
  const el = node('div', `trail-head${o.check ? ' is-check' : ''}`);
  const btn = node('button', 'trail-row');
  btn.type = 'button';
  btn.setAttribute('aria-label', `Replay: ${o.question}`);
  btn.title = 'Replay this answer';
  const num = node('span', 'trail-num', o.num);
  num.setAttribute('aria-hidden', 'true');
  const q = node('span', 'trail-q', o.question);
  const meta = node('span', 'trail-meta');
  const replay = node('span', 'trail-replay');
  replay.innerHTML = `${PLAY}<span>Replay</span>`;
  btn.append(num, q, meta, replay);
  btn.addEventListener('click', () => o.onReplay());
  el.append(btn);
  let example: HTMLElement | null = null;
  return { el, h: HEAD_H, setMeta: (m) => { meta.textContent = m; },
    markExample: () => { if (!example) { example = node('span', 'trail-example', EXAMPLE_NOTE); q.after(example); } } };
}

/**
 * An aside's head: open, a warm-grey frame around its inset with "Aside · question" and the way
 * back; collapsed, a small marker "aside · question ↗" that reopens it.
 */
export function asideHead(o: { question: string; onBack(): void; onToggle(): void }): TrailHead {
  const el = node('div', 'trail-head is-aside');
  const row = node('div', 'trail-aside-row');
  const tag = node('span', 'trail-aside-tag', 'Aside');
  const q = node('span', 'trail-aside-q', o.question);
  const back = node('button', 'trail-aside-back', '↵ back to the answer');
  back.type = 'button';
  back.addEventListener('click', () => o.onBack());
  row.append(tag, q, back);
  const marker = node('button', 'trail-aside-marker');
  marker.type = 'button';
  marker.setAttribute('aria-label', `Reopen the aside: ${o.question}`);
  marker.append(node('span', 'trail-aside-mq', `aside · ${o.question}`), node('span', 'trail-aside-arrow', '↗'));
  marker.addEventListener('click', () => o.onToggle());
  const meta = node('span', 'trail-meta');
  el.append(row, marker);
  return { el, h: ASIDE_HEAD_H, setMeta: (m) => { meta.textContent = m; } };
}

/** Height of a continuation tag (the compact head over a later stretch of a walking answer). */
export const CONT_H = 30;

export type ContTag = { el: HTMLElement; /** Part `i` of `n` (n: null while the answer still plays). */ set(i: number, n: number | null): void };

/**
 * A walking answer's later stretch (each page it walks to keeps its own still slice of the board): a
 * compact tag "3 · cont. 2/4" in the head's quiet style. Hover or focus shows the question; a click
 * goes to the answer's head (where it began).
 */
export function contTag(o: { num: string; question: string; onGo(): void }): ContTag {
  const el = node('div', 'trail-head is-cont');
  const btn = node('button', 'trail-row trail-cont');
  btn.type = 'button';
  const num = node('span', 'trail-num', o.num);
  num.setAttribute('aria-hidden', 'true');
  const n = node('span', 'trail-cont-n');
  const q = node('span', 'trail-cont-q', o.question);
  btn.append(num, n, q);
  btn.addEventListener('click', (e) => { e.stopPropagation(); o.onGo(); });
  el.append(btn);
  return {
    el,
    set(i, total) {
      n.textContent = `cont. ${total ? `${i}/${total}` : i}`;
      btn.setAttribute('aria-label', `Answer ${o.num}, part ${i}${total ? ` of ${total}` : ''}: ${o.question}. Go to its start`);
    },
  };
}

/** "p.86–88", "p.12, 40–41": an answer's taught pages as the header's meta names them (ascending, runs joined). */
export function pagesLabel(pages: readonly number[]): string {
  const ps = [...new Set(pages)].sort((a, b) => a - b);
  const runs: string[] = [];
  for (let i = 0; i < ps.length; i++) {
    let j = i;
    while (j + 1 < ps.length && ps[j + 1] === ps[j] + 1) j++;
    runs.push(j > i ? `${ps[i]}–${ps[j]}` : `${ps[i]}`);
    i = j;
  }
  return `p.${runs.join(', ')}`;
}
