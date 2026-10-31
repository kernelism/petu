// src/ui/landing/mount.ts — brings the landing's static markup (Landing.tsx) to life: the headline's
// ink swash, the hero lesson, the story's camera over its lesson (one segment per step in view), and
// the growing rectangle under scroll. Returns the Runtime; dispose() stops every timer, animation,
// observer and listener (Landing's effect cleanup).
import { Runtime, nibDraw, sample } from './ink';
import { buildStage, seek, segOf, type Ctx, type Lesson, type Seg } from './stage';
import { staircase } from './staircase';
import { storyLesson } from './storyLesson';

const MATH = "'STIX Two Text Variable', 'STIX Two Text', serif";
const q = <T extends Element>(s: string, r: ParentNode) => r.querySelector(s) as T | null;

export function mountLanding(root: HTMLElement, opts: { hero?: Lesson; story?: Lesson } = {}): Runtime {
  const rt = new Runtime();
  const heroLesson = opts.hero ?? staircase;
  const storyL = opts.story ?? storyLesson;
  const fontsReady = (document as Document & { fonts?: FontFaceSet }).fonts?.ready ?? Promise.resolve();
  const whenFonts = (fn: () => void) => { fontsReady.then(() => { if (!rt.disposed) fn(); }); };

  /* ---------------- hero ---------------- */
  const heroHost = q<HTMLElement>('[data-pl="hero-stage"]', root);
  const swashSvg = q<SVGSVGElement>('[data-pl="swash"]', root);
  if (heroHost) {
    const hero: Ctx = buildStage(rt, heroLesson, heroHost, false);
    const playHero = () => seek(hero, 0, heroLesson.mark.heroEnd);
    const swash = (instant: boolean) => {
      if (!swashSvg) return;
      const g = swashSvg.querySelector('g')!; g.innerHTML = '';
      const pts = sample((t) => [6 + t * 186, 24 - Math.sin(t * Math.PI) * 7 + t * t * -9 + Math.sin(t * 9) * .4], 90);
      nibDraw(rt, swashSvg, g, pts, { w: 7, min: 2.2, ang: .55, tin: .05, tout: .3 }, instant, 900);
    };
    whenFonts(() => { rt.later(() => swash(false), 350); rt.later(playHero, 600); });
    const replay = q<HTMLButtonElement>('[data-pl="replay"]', root);
    const onReplay = () => { heroHost.scrollIntoView({ block: 'center', behavior: rt.rm ? 'auto' : 'smooth' }); playHero(); };
    replay?.addEventListener('click', onReplay);
    rt.onDispose(() => replay?.removeEventListener('click', onReplay));
    rt.listen('resize', () => { if (hero.conn) heroLesson.relink(hero); });
    rt.onDispose(() => { hero.timers = []; });
  }

  /* ---------------- story: the same kind of lesson, a camera that moves over it ---------------- */
  const view = q<HTMLElement>('[data-pl="story-view"]', root);
  const storyHost = q<HTMLElement>('[data-pl="story-stage"]', root);
  const steps = Array.from(root.querySelectorAll<HTMLElement>('[data-seg]'));
  if (view && storyHost) {
    const story: Ctx = buildStage(rt, storyL, storyHost, true, 1);
    const SEG = segOf(storyL.mark);
    type R = { x: number; y: number; w: number; h: number };
    const rectOf = (c: Ctx, e: Element): R => {
      const k = c.scale || 1, s = c.st.getBoundingClientRect(), r = e.getBoundingClientRect();
      return { x: (r.left - s.left) / k, y: (r.top - s.top) / k, w: r.width / k, h: r.height / k };
    };
    const svgRect = (c: Ctx, svg: SVGSVGElement, x: number, y: number, w: number, h: number): R => {
      const k = c.scale || 1, s = c.st.getBoundingClientRect(), m = svg.getScreenCTM?.();
      if (!m) return { x: 0, y: 0, w: 1, h: 1 };
      const a = new DOMPoint(x, y).matrixTransform(m), b = new DOMPoint(x + w, y + h).matrixTransform(m);
      return { x: (a.x - s.left) / k, y: (a.y - s.top) / k, w: (b.x - a.x) / k, h: (b.y - a.y) / k };
    };
    const padR = (r: R, px: number, py: number): R => ({ x: r.x - px, y: r.y - py, w: r.w + 2 * px, h: r.h + 2 * py });
    const union = (c: Ctx, els: Element[], p: number): R => {
      const rs = els.map((e) => rectOf(c, e));
      const x = Math.min(...rs.map((r) => r.x)), y = Math.min(...rs.map((r) => r.y));
      const X = Math.max(...rs.map((r) => r.x + r.w)), Y = Math.max(...rs.map((r) => r.y + r.h));
      return padR({ x, y, w: X - x, h: Y - y }, p, p);
    };
    const cams: Record<Seg, (c: Ctx) => R> = {
      ask: (c) => union(c, [c.st.querySelector('.pl-slidewrap')!, c.dock], 14),
      page: (c) => padR(svgRect(c, c.slide, ...storyL.pageRect), 30, 20),
      words: (c) => union(c, [c.dock, c.st.querySelector('.pl-board')!], 10),
      board: (c) => padR(rectOf(c, c.st.querySelector('.pl-board')!), 10, 10),
      check: (c) => union(c, [c.dock, c.st.querySelector('.pl-board')!], 10),
    };
    let curSeg: Seg | null = null;
    const camera = (seg: Seg, instant: boolean) => {
      const r = cams[seg](story);
      const vw = view.clientWidth, vh = view.clientHeight;
      if (!r.w || !r.h || !vw) return;
      const k = Math.min(vw / r.w, vh / r.h, 2.1);
      const tx = (vw - r.w * k) / 2 - r.x * k, ty = (vh - r.h * k) / 2 - r.y * k;
      story.st.style.transition = instant || rt.rm ? 'none' : 'transform 1.15s cubic-bezier(.65,0,.25,1)';
      story.st.style.transform = `translate(${tx}px,${ty}px) scale(${k})`;
      story.scale = k;
      story.tf = story.st.style.transform;
    };
    story.onBuild = () => { if (curSeg) { story.st.style.transition = 'none'; story.st.style.transform = story.tf || ''; } };
    const activate = (seg: Seg) => {
      if (seg === curSeg) return; curSeg = seg;
      steps.forEach((s) => s.classList.toggle('pl-active', s.dataset.seg === seg));
      const [a, b] = SEG[seg];
      seek(story, a, b);
      camera(seg, false);
    };
    if (typeof IntersectionObserver === 'function') {
      const io = new IntersectionObserver((es) => { es.forEach((e) => { if (e.isIntersecting) activate((e.target as HTMLElement).dataset.seg as Seg); }); },
        { rootMargin: innerWidth < 760 ? '-58% 0px -22% 0px' : '-45% 0px -45% 0px' });
      steps.forEach((s) => io.observe(s));
      rt.onDispose(() => io.disconnect());
    }
    whenFonts(() => camera('ask', true));
    rt.listen('resize', () => { if (curSeg) camera(curSeg, true); });
  }

  /* ---------------- unfold: the hero's rectangle, for every n ---------------- */
  const grow = q<SVGSVGElement>('[data-pl="grow"]', root), readout = q<HTMLElement>('[data-pl="readout"]', root), sec = q<HTMLElement>('[data-pl="unfold"]', root);
  if (grow && readout && sec) {
    let shownN = 0;
    const drawGrow = (n: number) => {
      const box = 540, s = Math.min(box / n, (box + 40) / (n + 1)) * .9;
      const W = n * s, H = (n + 1) * s, ox = (640 - W) / 2 - 56, oy = (640 - H) / 2 - 10;
      let h = '';
      for (let k = 0; k < n; k++) for (let j = 0; j <= n; j++) {
        const orig = j < k + 1;
        h += `<rect x="${(ox + k * s).toFixed(2)}" y="${(oy + H - (j + 1) * s).toFixed(2)}" width="${s.toFixed(2)}" height="${s.toFixed(2)}" fill="${orig ? 'rgba(42,63,240,.14)' : '#fff'}" stroke="${orig ? '#2A3FF0' : '#17171a'}" stroke-width="${n > 12 ? .8 : 1.2}" stroke-opacity="${orig ? .55 : .5}"/>`;
      }
      let d = `M${ox} ${oy + H}`; for (let k = 0; k < n; k++) d += `V${oy + H - (k + 1) * s}H${ox + (k + 1) * s}`; d += `V${oy + H}Z`;
      h += `<path d="${d}" fill="none" stroke="#2A3FF0" stroke-width="2.6" stroke-linejoin="round"/>`;
      h += `<rect x="${ox}" y="${oy}" width="${W}" height="${H}" fill="none" stroke="#17171a" stroke-width="2"/>`;
      h += `<path d="M${ox} ${oy + H + 16}v8M${ox} ${oy + H + 20}H${ox + W}M${ox + W} ${oy + H + 16}v8" stroke="#17171a" fill="none"/>`;
      h += `<path d="M${ox + W + 16} ${oy}h8M${ox + W + 20} ${oy}V${oy + H}M${ox + W + 16} ${oy + H}h8" stroke="#17171a" fill="none"/>`;
      h += `<text x="${ox + W / 2}" y="${oy + H + 48}" text-anchor="middle" font-family="${MATH}" font-size="22" fill="#1b1b1d"><tspan font-style="italic">n</tspan> = ${n}</text>`;
      h += `<text x="${ox + W + 34}" y="${oy + H / 2 + 7}" font-family="${MATH}" font-size="22" fill="#1b1b1d"><tspan font-style="italic">n</tspan> + 1 = ${n + 1}</text>`;
      grow.innerHTML = h;
      const terms = n <= 6 ? Array.from({ length: n }, (_, i) => i + 1).join(' + ') : `1 + 2 + 3 + ⋯ + ${n}`;
      readout.innerHTML = `<span class="pl-l2">${terms}</span><span class="pl-l2">= ${n} × ${n + 1} ÷ 2 = <span class="pl-res">${n * (n + 1) / 2}</span></span>`;
    };
    const onScroll = () => {
      const r = sec.getBoundingClientRect(), span = sec.offsetHeight - innerHeight;
      const p = span > 0 ? Math.min(1, Math.max(0, -r.top / span)) : 0;
      const n = 4 + Math.round(Math.pow(p, 1.25) * 16);
      if (n !== shownN) { shownN = n; drawGrow(n); }
    };
    rt.listen('scroll', onScroll, { passive: true });
    drawGrow(4); shownN = 4;
  }
  return rt;
}
