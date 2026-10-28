// server/cacheStats.ts — what the prompt cache most likely holds, from the usage OpenAI reported.
//
// Used only to estimate cost when no usage arrives (an aborted or crashed request): the input it
// most likely read from cache is booked at the cached rate instead of the 12h write rate. Two
// prefixes are tracked per (model, prompt version):
//  - the system block (12h breakpoint), shared by every document;
//  - each page block (30m breakpoint): system + document header + page text + page image.
// Persisted to .petu/cache.json so the estimate survives a dev-server restart.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Usage } from './prices';

const MIN = 60_000;
/** A 30m read refreshes the page entry; stay a little inside the TTL. */
export const PAGE_TTL_MS = 28 * MIN;
export const SYSTEM_TTL_MS = 11.5 * 60 * MIN;

type Obs = { at: number; tokens: number };
type File = { version: 1; system: Record<string, Obs>; pages: Record<string, Obs> };

export class CacheStats {
  private f: File = { version: 1, system: {}, pages: {} };
  constructor(private path: string | null, private now: () => number = Date.now) {
    if (path && existsSync(path)) {
      try {
        const f = JSON.parse(readFileSync(path, 'utf8')) as File;
        if (f?.version === 1 && f.system && f.pages) this.f = f;
      } catch { /* a corrupt file means "nothing known" */ }
    }
  }

  /**
   * A response's usage. `systemTokens` is a lower bound on the system block's size: a request that
   * read or wrote at least that much has the system block in cache for 12h.
   */
  observe(k: { model: string; version: string; docHash: string; page: number }, u: Usage, systemTokens: number): void {
    const cached = u.input_tokens_details?.cached_tokens ?? 0;
    const written = u.input_tokens_details?.cache_write_tokens ?? 0;
    const prefix = cached + written;
    const at = this.now();
    if (prefix >= systemTokens) {
      const sys = u.input_tokens_details?.cache_write_tokens_details?.ttl_12h_tokens;
      this.f.system[sysKey(k)] = { at, tokens: Math.max(systemTokens, Math.min(prefix, sys || systemTokens)) };
    }
    // The page breakpoint sits after the image; the next request on this page reads up to it.
    if (prefix > 0) this.f.pages[pageKey(k)] = { at, tokens: prefix };
    this.flush();
  }

  /** A system-only prewarm wrote the system block. */
  observeSystem(k: { model: string; version: string }, tokens: number): void {
    this.f.system[sysKey(k)] = { at: this.now(), tokens };
    this.flush();
  }

  /** Is the system block likely cached (for the doc-open prewarm's dedupe)? */
  systemFresh(k: { model: string; version: string }): boolean {
    const s = this.f.system[sysKey(k)];
    return !!s && this.now() - s.at < SYSTEM_TTL_MS;
  }

  /** Input tokens this request most likely reads from cache, at most `inputTokens`. */
  expectedCached(k: { model: string; version: string; docHash: string; page: number }, inputTokens: number): number {
    const t = this.now();
    const p = this.f.pages[pageKey(k)];
    if (p && t - p.at < PAGE_TTL_MS) return Math.min(p.tokens, inputTokens);
    const s = this.f.system[sysKey(k)];
    if (s && t - s.at < SYSTEM_TTL_MS) return Math.min(s.tokens, inputTokens);
    return 0;
  }

  private flush() {
    if (!this.path) return;
    const t = this.now();
    for (const [k, o] of Object.entries(this.f.pages)) if (t - o.at > PAGE_TTL_MS) delete this.f.pages[k];
    for (const [k, o] of Object.entries(this.f.system)) if (t - o.at > SYSTEM_TTL_MS) delete this.f.system[k];
    try {
      mkdirSync(dirname(this.path), { recursive: true });
      const tmp = `${this.path}.${process.pid}.tmp`;
      writeFileSync(tmp, JSON.stringify(this.f));
      renameSync(tmp, this.path);
    } catch { /* stats are a hint; never fail a request over them */ }
  }
}

const sysKey = (k: { model: string; version: string }) => `${k.model}|${k.version}`;
const pageKey = (k: { model: string; version: string; docHash: string; page: number }) => `${k.model}|${k.version}|${k.docHash}|${k.page}`;

/** Usage for a request that ended without a usage report: cached input at the read rate, the rest as a 12h write. */
export function estimatedUsage(inputTokens: number, cachedTokens: number, outputTokens: number): Usage {
  const cached = Math.max(0, Math.min(cachedTokens, inputTokens));
  return { input_tokens: inputTokens, output_tokens: outputTokens, input_tokens_details: { cached_tokens: cached, cache_write_tokens: inputTokens - cached } };
}
