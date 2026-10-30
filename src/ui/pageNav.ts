// src/ui/pageNav.ts — the top bar's page field: what a typed page means, and the key that opens it.
import { isTypingTarget } from './playbackKeys';

/** A typed page ("12", " 12 ", "p12") as a page of the document, clamped into 1…numPages; null if it isn't a number. */
export function parsePage(text: string, numPages: number): number | null {
  const m = /^\s*p?\s*(\d{1,6})\s*$/i.exec(text);
  if (!m || numPages < 1) return null;
  return Math.max(1, Math.min(numPages, Number(m[1])));
}

type KeyLike = Pick<KeyboardEvent, 'key' | 'metaKey' | 'ctrlKey' | 'altKey' | 'shiftKey' | 'defaultPrevented' | 'target'> & { isComposing?: boolean; repeat?: boolean };

/** G opens the page field: not while typing, not with a modifier, not with a popover or card open. */
export function isGoToPageKey(e: KeyLike, doc: ParentNode = document): boolean {
  return (e.key === 'g' || e.key === 'G') && !e.shiftKey && !e.metaKey && !e.ctrlKey && !e.altKey && !e.repeat
    && !e.defaultPrevented && !e.isComposing && !isTypingTarget(e.target) && !doc.querySelector('.popover, .keys');
}

/**
 * Until App passes the viewer's own `goToPage`, frame the page's top at the top of the visible band.
 * A student's jump: the scroll is theirs, so follow mode treats it as the student taking over.
 */
export function scrollToPageSlot(page: number): void {
  const scroller = document.querySelector<HTMLElement>('.pv-scroll');
  const slot = scroller?.querySelector<HTMLElement>(`.pv-page[data-page="${page}"]`);
  if (!scroller || !slot) return;
  const stage = scroller.closest<HTMLElement>('.stage');
  const viewTop = stage ? parseFloat(getComputedStyle(stage).getPropertyValue('--view-top')) || 0 : 0;
  const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const top = slot.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop;
  scroller.scrollTo({ top: Math.max(0, top - viewTop), behavior: reduce ? 'auto' : 'smooth' });
}
