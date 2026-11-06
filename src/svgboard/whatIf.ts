// src/svgboard/whatIf.ts — "what if the kernel were …?" without the model (teaching-engine proposal §3.4 and
// Phase 3: the data-literal inspector). Once the answer is paused or over, the student clicks a weight of an
// engine window's kernel, types another, and the window redraws at the step it is on: its outputs, its frame
// and its working recompute at once. The edit lives in the board's scope.whatIf, which only the window's
// drawing reads (slide.ts): the answer's numbers, what the voice says, the gate and the recording stay as
// they were. "↺ back to the answer", drawn in the window (slide.ts), resets it; playing on resets every what-if.
import { boardOf, refreshData, type SvgBoard } from './render';
import { matrix } from './slide';

/** A weight as the student may type it: 2, -0.5, 1/9. Null when it is not a number. */
export function readWeight(s: string): number | null {
  const t = s.trim().replace(/−/g, '-');
  const f = /^(-?\d*\.?\d+)\s*\/\s*(\d*\.?\d+)$/.exec(t);
  const v = f ? Number(f[1]) / Number(f[2]) : t === '' ? NaN : Number(t);
  return Number.isFinite(v) ? v : null;
}

/** The window an element is part of, its id (the scope's key) and the kernel it was written with. */
function windowOf(cell: Element, b: SvgBoard): { win: Element; id: string; kernel: number[][] } | null {
  const win = cell.closest('[data-slide][data-kernel]');
  const id = (win?.getAttribute('data-name') ?? win?.getAttribute('id') ?? '').toLowerCase();
  if (!win || !id) return null;
  try { return { win, id, kernel: b.scope.whatIf?.get(id) ?? matrix(win.getAttribute('data-kernel')!, b.scope, 'data-kernel') }; } catch { return null; }
}

/** Sets weight (r, c) of a window's kernel to `v` and redraws the board. */
export function setWeight(b: SvgBoard, id: string, kernel: number[][], r: number, c: number, v: number): void {
  const k = kernel.map((row) => row.slice());
  if (!k[r] || k[r][c] == null) return;
  k[r][c] = v;
  (b.scope.whatIf ??= new Map()).set(id, k);
  refreshData(b);
}

/** Drops a board's what-ifs (one window's, or all) and redraws. True when there was one. */
export function clearWhatIf(b: SvgBoard, id?: string): boolean {
  const m = b.scope.whatIf;
  if (!m?.size || (id && !m.has(id))) return false;
  if (id) m.delete(id); else m.clear();
  refreshData(b);
  return true;
}

/** Every board in `root` (the desk) back to the answer as given. */
export function clearAllWhatIf(root: ParentNode): void {
  for (const svg of Array.from(root.querySelectorAll('svg[data-svgboard]'))) { const b = boardOf(svg); if (b) clearWhatIf(b); }
}

/**
 * Listens for clicks on kernel weights (data-kcell) inside `root`. `canEdit`: the answer is paused or over
 * (a what-if never runs under a playing answer). Returns the detach function.
 */
export function attachWhatIf(root: HTMLElement, canEdit: () => boolean): () => void {
  let input: HTMLInputElement | null = null;
  const close = () => { input?.remove(); input = null; };
  const onClick = (e: MouseEvent) => {
    const back = (e.target as Element | null)?.closest?.('[data-whatif-reset]');
    if (back && root.contains(back)) {
      const b = boardOf(back), w = b && windowOf(back, b);
      if (b && w) { e.preventDefault(); e.stopPropagation(); clearWhatIf(b, w.id); }
      return;
    }
    const cell = (e.target as Element | null)?.closest?.('[data-kcell]');
    if (!cell || !root.contains(cell) || !canEdit()) return;
    const b = boardOf(cell);
    const w = b && windowOf(cell, b);
    if (!b || !w) return;
    const [r, c] = cell.getAttribute('data-kcell')!.split(',').map(Number);
    e.preventDefault();
    e.stopPropagation();
    close();
    const box = (cell.tagName.toLowerCase() === 'rect' ? cell : cell.previousElementSibling ?? cell).getBoundingClientRect();
    input = document.createElement('input');
    input.className = 'whatif-input';
    input.value = String(+w.kernel[r][c].toPrecision(4));
    input.setAttribute('aria-label', `kernel weight, row ${r + 1}, column ${c + 1}`);
    Object.assign(input.style, { position: 'fixed', left: `${Math.round(box.left)}px`, top: `${Math.round(box.top)}px`, width: `${Math.max(48, Math.round(box.width))}px`, height: `${Math.round(box.height)}px`, zIndex: '41', textAlign: 'center', font: '15px system-ui, sans-serif', border: '2px solid #7c3aed', borderRadius: '4px', background: '#fff' });
    const commit = () => {
      if (!input) return;
      const v = readWeight(input.value);
      close();
      if (v == null || v === w.kernel[r][c]) return;
      setWeight(b, w.id, w.kernel, r, c, v);
    };
    input.addEventListener('keydown', (k) => { k.stopPropagation(); if (k.key === 'Enter') commit(); else if (k.key === 'Escape') close(); });
    input.addEventListener('blur', commit);
    document.body.appendChild(input);
    input.focus();
    input.select();
  };
  root.addEventListener('click', onClick, true);
  return () => { root.removeEventListener('click', onClick, true); close(); };
}
