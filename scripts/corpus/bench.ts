// scripts/corpus/bench.ts — the browser half of scripts/corpus/browserBench.ts: opens ?src=<pdf url>
// with the app's own loader and ContextBuilder, asks for the digest as a first question would (it
// waits DIGEST_WAIT_MS for the index), then times the full index fill and the final digest. No API
// calls. Result on window.__bench.
import { loadPdf } from '../../src/pdf/loadPdf';
import { ContextBuilder } from '../../src/agent/context/build';

type Bench = Record<string, unknown>;
const w = window as unknown as { __bench?: Bench; __benchErr?: string };
const unread = (d: string) => (d.match(/^p\d+: …$/gm) ?? []).length;
const heap = () => (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize ?? 0;

(async () => {
  const q = new URLSearchParams(location.search);
  const src = q.get('src')!;
  const h0 = heap();
  const t0 = performance.now();
  const doc = await loadPdf(src);
  const loadMs = performance.now() - t0;
  const b = new ContextBuilder(doc, src.replace(/^.*\//, ''));
  const t1 = performance.now();
  const first = await b.digest(1, q.get('question') ?? 'why does this work');
  const firstMs = performance.now() - t1;
  const index = (b as unknown as { index: { fill(): Promise<void>; ready(): boolean } }).index;
  await index.fill();
  const fillMs = performance.now() - t1;
  const t2 = performance.now();
  const full = await b.digest(1);
  const fullMs = performance.now() - t2;
  w.__bench = { pages: doc.numPages, loadMs, firstMs, firstUnread: unread(first), firstChars: first.length, fillMs, fullMs, fullChars: full.length, fullUnread: unread(full), stable: first === full, heapMB: (heap() - h0) / 1e6 };
  document.getElementById('out')!.textContent = JSON.stringify(w.__bench, null, 1);
  b.destroy();
  await doc.destroy();
})().catch((e) => { w.__benchErr = String(e?.stack ?? e); });
