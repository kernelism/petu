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
  /** "p.14 · 0:52": where it was asked and how long it played. */
  setMeta(meta: string): void;
};

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
  return { el, h: HEAD_H, setMeta: (m) => { meta.textContent = m; } };
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
