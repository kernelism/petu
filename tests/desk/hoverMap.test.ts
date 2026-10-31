import { describe, expect, it } from 'vitest';
import { BeatLinks, boxAt, markAt } from '../../src/desk/hoverMap';
import { legibleWidth, placePreview, previewOf, PREVIEW_MAX_W, PREVIEW_MIN_W, renameIds } from '../../src/desk/preview';

const el = () => document.createElementNS('http://www.w3.org/2000/svg', 'g');
const R = (y: number) => ({ x: 100, y, w: 200, h: 20 });

describe('BeatLinks: page marks belong to the beat they are spoken in', () => {
  it('a mark joins the latest group noted before it (drawing first, then its sentences)', () => {
    const l = new BeatLinks();
    const a = l.beat(el());
    expect(l.mark(4, R(100))).toBe(a);
    const b = l.beat(el());
    l.mark(5, R(200));
    l.mark(5, R(240));
    expect(a.marks.map((m) => m.page)).toEqual([4]);
    expect(b.marks.map((m) => m.r.y)).toEqual([200, 240]);
  });
  it('marks before the answer\'s first group are the answer\'s (its leader), not a part of the drawing', () => {
    const l = new BeatLinks();
    expect(l.mark(87, R(300))).toBeNull();
    const a = l.beat(el());
    expect(a.marks).toEqual([]);
    expect(l.answerMarks().map((m) => m.page)).toEqual([87]);
  });
  it('an aside\'s marks go to the aside\'s groups; the answer\'s beat resumes after it', () => {
    const l = new BeatLinks();
    const a = l.beat(el());
    l.setAside(true);
    expect(l.mark(9, R(10))).toBeNull(); // the aside has drawn nothing yet
    const s = l.beat(el());
    l.mark(9, R(20));
    l.setAside(false);
    l.mark(4, R(30));
    expect(s.marks.map((m) => m.r.y)).toEqual([20]);
    expect(a.marks.map((m) => m.r.y)).toEqual([30]);
  });
  it('a new answer starts with no beat, and the last answer\'s marks are retired (past)', () => {
    const l = new BeatLinks();
    const a = l.beat(el());
    l.mark(4, R(1));
    l.newAnswer();
    expect(a.marks[0].past).toBe(true);
    expect(l.mark(4, R(2))).toBeNull();
  });
});

describe('hit testing', () => {
  it('on the paper between strokes, the smallest group box holding the point wins (a label over its chart)', () => {
    const chart = { x: 0, y: 0, w: 800, h: 500 }, label = { x: 100, y: 100, w: 120, h: 30 };
    expect(boxAt([chart, label], 150, 110)).toBe(1);
    expect(boxAt([chart, label], 600, 400)).toBe(0);
    expect(boxAt([chart, label], 900, 900)).toBe(-1);
    expect(boxAt([null, label], 150, 110)).toBe(1);
  });
  it('the latest page mark under the pointer wins; a few px of slack around thin marks', () => {
    const rects = [{ x: 10, y: 10, w: 100, h: 10 }, { x: 50, y: 12, w: 20, h: 4 }];
    expect(markAt(rects, 60, 14)).toBe(1);
    expect(markAt(rects, 20, 14)).toBe(0);
    expect(markAt(rects, 20, 23)).toBe(0);
    expect(markAt(rects, 20, 40)).toBe(-1);
  });
});

describe('folded-card preview placement', () => {
  const win = { W: 1440, H: 900 }, band = { top: 64, bottom: 120 };
  const h = (w: number) => w * 0.8;
  const card = { left: 900, top: 400, right: 1360, bottom: 436 };
  it('beside the card on the side with room (the lane is at the right: over the page, to its left)', () => {
    const p = placePreview(card, 380, h, win, band);
    expect(p.side).toBe('left');
    expect(p.x + p.w).toBeLessThanOrEqual(card.left);
    // level with the card, inside the band
    expect(p.y).toBeLessThanOrEqual(card.top);
    expect(p.y + h(p.w)).toBeGreaterThanOrEqual(card.bottom);
  });
  it('right when it fits there', () => {
    const p = placePreview({ left: 100, top: 300, right: 400, bottom: 336 }, 380, h, win, band);
    expect(p.side).toBe('right');
    expect(p.x).toBeGreaterThanOrEqual(400);
  });
  it('stays inside the window: a card near the bottom lifts the popover above the dock', () => {
    const low = { left: 900, top: 760, right: 1360, bottom: 796 };
    const p = placePreview(low, 380, h, win, band);
    expect(p.y + h(p.w)).toBeLessThanOrEqual(win.H - band.bottom);
    expect(p.y).toBeGreaterThanOrEqual(band.top);
  });
  it('a narrow window narrows it on the wider side; with no room either side it goes below the card, never over it', () => {
    const p = placePreview({ left: 400, top: 300, right: 760, bottom: 336 }, 420, h, { W: 1100, H: 900 }, band);
    expect(p.side).toBe('left');
    expect(p.w).toBeGreaterThanOrEqual(PREVIEW_MIN_W);
    expect(p.x + p.w).toBeLessThanOrEqual(400);
    const q = placePreview({ left: 200, top: 200, right: 700, bottom: 236 }, 380, h, { W: 900, H: 900 }, band);
    expect(q.side).toBe('below');
    expect(q.y).toBeGreaterThanOrEqual(236);
  });
  it('widens until the labels read (≈ 11.5 px), within its range', () => {
    expect(legibleWidth(356, 11.5)).toBe(PREVIEW_MIN_W);
    expect(legibleWidth(356, 8)).toBe(Math.round((356 * 11.5) / 8));
    expect(legibleWidth(356, 4)).toBe(PREVIEW_MAX_W);
    expect(legibleWidth(356, null)).toBe(356);
  });
});

describe('folded-card preview art (a vector copy of the board)', () => {
  it('copies each section\'s layers at their cropped viewBox, renames ids and their references, drops the now-state', () => {
    const sec = document.createElement('div');
    sec.className = 'desk-region';
    sec.innerHTML = '<svg class="desk-region-layer desk-region-hl" viewBox="0 100 1000 400"><g></g></svg>'
      + '<svg class="desk-region-layer desk-region-ink" viewBox="0 100 1000 400" style="width:10px"><g><svg data-svgboard viewBox="0 0 1000 700">'
      + '<defs><pattern id="petu-hatch-a"></pattern></defs><g id="b1-g" data-live=""><rect fill="url(#petu-hatch-a)"/><use href="#b1-g"/></g></svg></g></svg>';
    const art = previewOf([sec]);
    const svgs = art.querySelectorAll(':scope > .lane-preview-sec > svg');
    expect(svgs.length).toBe(2);
    expect((art.firstElementChild as HTMLElement).style.aspectRatio).toBe('1000 / 400');
    expect(svgs[1].getAttribute('viewBox')).toBe('0 100 1000 400');
    expect(svgs[1].getAttribute('style')).toBeNull();
    const pat = art.querySelector('pattern')!;
    expect(pat.id).not.toBe('petu-hatch-a');
    expect(art.querySelector('rect')!.getAttribute('fill')).toBe(`url(#${pat.id})`);
    expect(art.querySelector('use')!.getAttribute('href')).toBe(`#${art.querySelector('g[id]')!.id}`);
    expect(art.querySelector('[data-live]')).toBeNull();
    // the original is untouched
    expect(sec.querySelector('pattern')!.id).toBe('petu-hatch-a');
  });
  it('leaves references to ids outside the copy alone', () => {
    const d = document.createElement('div');
    d.innerHTML = '<svg><rect id="a"/><rect fill="url(#elsewhere)" stroke="url(#a)"/></svg>';
    renameIds(d, 't');
    const r = d.querySelectorAll('rect')[1];
    expect(r.getAttribute('fill')).toBe('url(#elsewhere)');
    expect(r.getAttribute('stroke')).toBe('url(#a-t)');
  });
});
