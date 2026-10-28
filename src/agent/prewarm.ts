// src/agent/prewarm.ts — warms the server's prompt cache for the visible page when the student
// shows intent to ask (ask bar focus, the 3rd typed character), so the answer's prefill is cached.
import type { AskContext } from './protocol';

/** The server's page-block cache lives 30 minutes; re-warm a little before it lapses. */
export const PREWARM_TTL_MS = 25 * 60_000;

/** Server reasons that won't change while it runs (server/openai.ts prewarm). */
const PERMANENT = /explicit cach|no key|no price/i;

type Deps = {
  /** An answer request is in flight: never compete with it. */
  inFlight(): boolean;
  /** Spend is blocked: the server would refuse anyway. */
  blocked(): boolean;
  fetch?: typeof fetch;
};

export class Prewarm {
  private sent = new Map<string, number>();
  private pending = false;
  /** The server answered `{ ok: false }` (no explicit caching for this model): stop asking. */
  private off = false;
  constructor(private d: Deps) {}

  /** At most once per (docHash, page) per 25 minutes; one at a time; failures are quiet. */
  async intent(docHash: string, page: number, getPrefix: () => Promise<AskContext>): Promise<void> {
    const key = `${docHash}:${page}`;
    const now = Date.now();
    const last = this.sent.get(key);
    if (this.off || this.pending || (last != null && now - last < PREWARM_TTL_MS)) return;
    if (this.d.inFlight() || this.d.blocked()) return;
    this.pending = true;
    try {
      let context: AskContext;
      try { context = await getPrefix(); } catch { return; }
      if (this.d.inFlight() || this.d.blocked()) return;
      this.sent.set(key, now);
      try {
        const r = await (this.d.fetch ?? fetch)('/api/prewarm', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ context }) });
        const body = r.ok ? ((await r.json().catch(() => null)) as { ok?: boolean; reason?: string } | null) : null;
        // `{ ok: false }` for good (no explicit caching, no key, no price): stop asking. Otherwise
        // (an upstream failure, a cap refusal) the page may be tried again later.
        if (body?.ok === false && PERMANENT.test(body.reason ?? '')) this.off = true;
        else if (!body?.ok) this.sent.delete(key);
      } catch {
        this.sent.delete(key);
      }
    } finally {
      this.pending = false;
    }
  }

  /** A new document. */
  reset(): void { this.sent.clear(); this.pending = false; }
}
