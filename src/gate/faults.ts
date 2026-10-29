// src/gate/faults.ts — `&gatefail=` (design §5.4): injected gate faults for tests, replays and the
// gallery. `2,4:late,o1:skip` → unit 2 skip, unit 4 late, opener sentence 1 skip. A key alone means
// `skip`. Keys: a stage-2 unit index (`0`, `1`…) or an opener unit (`o0`, `o1`…).
import type { FaultMode, Faults } from './events';

const MODES = new Set<FaultMode>(['skip', 'late', 'bad', 'ok']);

export function parseFaults(spec: string | null | undefined): Faults {
  const out: Faults = new Map();
  for (const part of (spec ?? '').split(',')) {
    const [rawKey, rawMode] = part.trim().split(':');
    const key = rawKey?.trim().toLowerCase();
    if (!key || !/^o?\d+$/.test(key)) continue;
    const mode = (rawMode?.trim().toLowerCase() || 'skip') as FaultMode;
    if (MODES.has(mode)) out.set(key.replace(/^(o?)0+(\d)/, '$1$2'), mode);
  }
  return out;
}
