// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CacheStats, estimatedUsage, PAGE_TTL_MS, SYSTEM_TTL_MS } from '../../server/cacheStats';

const k = { model: 'gpt-6.1-terra', version: 'p3.1', docHash: 'd', page: 2 };
const used = (cached: number, written: number, ttl12 = 0) => ({ input_tokens: 9000, output_tokens: 1, input_tokens_details: { cached_tokens: cached, cache_write_tokens: written, cache_write_tokens_details: { ttl_12h_tokens: ttl12 } } });

describe('CacheStats', () => {
  it('the next request on a page reads what the last one read + wrote; other pages read the system block', () => {
    let t = 0;
    const c = new CacheStats(null, () => t);
    expect(c.expectedCached(k, 9000)).toBe(0);
    c.observe(k, used(0, 7100, 4100), 4000);
    expect(c.expectedCached(k, 9000)).toBe(7100);
    expect(c.expectedCached({ ...k, page: 3 }, 9000)).toBe(4100);
    expect(c.expectedCached({ ...k, docHash: 'other' }, 9000)).toBe(4100);
    t = PAGE_TTL_MS + 1;
    expect(c.expectedCached(k, 9000)).toBe(4100);
    t = SYSTEM_TTL_MS + 1;
    expect(c.expectedCached(k, 9000)).toBe(0);
  });
  it('persists across a restart, and a corrupt file means nothing known', () => {
    const path = join(mkdtempSync(join(tmpdir(), 'cache-')), 'cache.json');
    new CacheStats(path, () => 1000).observeSystem(k, 4100);
    expect(new CacheStats(path, () => 2000).systemFresh(k)).toBe(true);
    writeFileSync(path, '{nope');
    expect(new CacheStats(path, () => 2000).systemFresh(k)).toBe(false);
  });
  it('estimatedUsage books the cached part as cached and the rest as a write', () => {
    expect(estimatedUsage(9000, 12000, 50)).toEqual({ input_tokens: 9000, output_tokens: 50, input_tokens_details: { cached_tokens: 9000, cache_write_tokens: 0 } });
    expect(estimatedUsage(9000, 4000, 0).input_tokens_details).toEqual({ cached_tokens: 4000, cache_write_tokens: 5000 });
  });
});
