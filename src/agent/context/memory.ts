// src/agent/context/memory.ts — session memory for the scout (design §2.4): one append-only SESSION
// block, one line per finished answer (the question, the pages it taught from, the board objects it
// left). Append-only means turn N+1's block starts with turn N's, so with a cache breakpoint at its end
// every turn reads the earlier memory from cache. Past MAX_TURNS the oldest half is rolled into one line.

export type Turn = { question: string; page: number; pages: number[]; board: string[] };

export const MAX_TURNS = 20;
const Q_CHARS = 100;
const squash = (s: string) => s.replace(/\s+/g, ' ').trim();
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** Board objects a script leaves: `sketch side`, `grid g`, `bars v`, … (tag name + id), first use only. */
export function boardObjects(script: string): string[] {
  const out: string[] = [];
  for (const m of script.matchAll(/\{\{\s*([a-z]+)\b[^}]*?\bid=([\w-]+)/gi)) {
    const kind = m[1].toLowerCase();
    if (['emph', 'move', 'fade', 'step', 'sweep', 'set', 'col', 'band', 'dist', 'level'].includes(kind)) continue;
    const s = `${kind} ${m[2]}`;
    if (!out.includes(s) && out.length < 8) out.push(s);
  }
  return out;
}

export class SessionMemory {
  private lines: string[] = [];
  private rolled = '';
  private n = 0;

  add(t: Turn): void {
    this.n++;
    const pages = [...new Set([t.page, ...t.pages])].map((p) => `p${p}`).join(' ');
    this.lines.push(`${this.n}. (on p${t.page}) "${clip(squash(t.question), Q_CHARS)}" → taught ${pages}${t.board.length ? `; board: ${t.board.join(', ')}` : ''}`);
    if (this.lines.length > MAX_TURNS) {
      const old = this.lines.splice(0, MAX_TURNS / 2);
      const pagesOf = old.flatMap((l) => [...l.matchAll(/\bp(\d+)\b/g)].map((m) => Number(m[1])));
      const span = [...new Set(pagesOf)].sort((a, b) => a - b).slice(0, 30).map((p) => `p${p}`).join(' ');
      this.rolled = `${this.rolled ? `${this.rolled}; ` : ''}${old.length} earlier answers on ${span}`;
    }
  }

  /** The SESSION block ('' before the first answer). */
  text(): string {
    if (!this.lines.length && !this.rolled) return '';
    return ['SESSION (this student\'s earlier answers on this document, oldest first)', ...(this.rolled ? [`earlier: ${this.rolled}`] : []), ...this.lines].join('\n');
  }

  reset(): void { this.lines = []; this.rolled = ''; this.n = 0; }
}
