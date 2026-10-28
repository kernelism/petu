// server/sse.ts
import type { Usage } from './prices';

/** Splits a Responses API SSE byte stream into JSON events (`data:` lines; `[DONE]` ignored). */
export class SseParser {
  private buf = '';
  push(text: string): unknown[] {
    this.buf += text.replace(/\r\n/g, '\n');
    const out: unknown[] = [];
    let i: number;
    while ((i = this.buf.indexOf('\n\n')) >= 0) {
      const ev = this.buf.slice(0, i);
      this.buf = this.buf.slice(i + 2);
      const data = ev.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trimStart()).join('\n');
      if (!data || data === '[DONE]') continue;
      try { out.push(JSON.parse(data)); } catch { /* a torn or non-JSON event: skip */ }
    }
    return out;
  }
}

export type Upstream =
  | { t: 'text'; d: string }
  /** The terminal event: `complete` false for `response.incomplete` (cut short upstream). */
  | { t: 'usage'; usage: Usage; status: string; complete: boolean }
  | { t: 'error'; message: string }
  | { t: 'note'; message: string };

/**
 * Turns Responses events into script text. Only the FIRST message item is the script: some models
 * stream a `commentary`-phase message and then a `final_answer` message with (nearly) the same
 * script, seconds later; streaming the first and dropping the rest keeps the answer single and the
 * start fast. Dropped items are reported (`note`) so the eval can count them. Exception: when the
 * first message is `commentary` and a `final_answer` message is added before the commentary has
 * streamed any text, the final answer becomes the script (the commentary is dropped).
 */
export class ResponseEvents {
  private script: string | null = null;
  private scriptPhase: string | undefined;
  private started = false;
  private dropped = new Map<string, number>();
  handle(e: any): Upstream[] {
    switch (e?.type) {
      case 'response.output_item.added':
        if (e.item?.type === 'message') {
          if (this.script == null) { this.script = e.item.id; this.scriptPhase = e.item.phase; }
          else if (e.item.id !== this.script) {
            if (!this.started && this.scriptPhase === 'commentary' && e.item.phase === 'final_answer') {
              this.dropped.set(this.script, 0);
              this.script = e.item.id;
              this.scriptPhase = e.item.phase;
            } else this.dropped.set(e.item.id, 0);
          }
        }
        return [];
      case 'response.output_text.delta': {
        if (this.script == null) this.script = e.item_id; // no item.added seen: take the first text
        if (e.item_id === this.script) { const d = String(e.delta ?? ''); if (d) this.started = true; return [{ t: 'text', d }]; }
        this.dropped.set(e.item_id, (this.dropped.get(e.item_id) ?? 0) + String(e.delta ?? '').length);
        return [];
      }
      case 'response.completed':
      case 'response.incomplete': {
        const notes: Upstream[] = [...this.dropped].map(([id, n]) => ({ t: 'note', message: `dropped extra message ${id.slice(-6)} (${n} chars)` }));
        const why = e.response?.incomplete_details?.reason;
        return [...notes, { t: 'usage', usage: e.response?.usage, status: `${e.response?.status ?? e.type}${why ? ` (${why})` : ''}`, complete: e.type === 'response.completed' }];
      }
      case 'response.failed':
        return [{ t: 'error', message: e.response?.error?.message ?? 'response failed' }];
      case 'error':
        return [{ t: 'error', message: e.message ?? e.error?.message ?? 'stream error' }];
      default:
        return [];
    }
  }
}
