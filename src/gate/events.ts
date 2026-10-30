// src/gate/events.ts — the live commit gate's contract (design 2026-10-29 "Live commit gate" §3/§6),
// shared by the gate (src/gate/live.ts), the repair client (src/agent/repair.ts), the server
// (server/repair.ts, through src/agent/protocol.ts) and the eval (scripts/eval/*). Types only.

/** How the gate checks: one sentence at a time (no repairs), or whole beats (repairs allowed). */
export type GateMode = 'sentence' | 'beat';
/** `&gate=`: off (raw stream plays), shadow (checked and logged, everything plays), live (enforced), audit (dev scripts: enforced, any flag is a gallery failure). */
export type GateSetting = 'off' | 'shadow' | 'live' | 'audit';

/** One problem a check found ("check: detail"); `hint` is the fix the repair note suggests. */
export type GateFlag = { check: string; detail: string; hint?: string };

/**
 * A unit's verdict and what the gate did with it. `k` is the unit key: `o0`, `o1`… for opener
 * sentences, `0`, `1`… for stage-2 units (the same keys `&gatefail=` names). `ms`: the check's cost;
 * `bufferedMs`: checked narration still to play when the verdict came (clock.endsAt − now).
 */
export type GateEvent = {
  t: 'gate';
  k: string;
  unit: 'opener' | 'sentence' | 'beat';
  result: 'pass' | 'strip' | 'fail';
  /** `cut`: not checked and never played: past the answer's length budget (src/agent/pacing.ts), the answer closed at a beat boundary. */
  action: 'release' | 'repair' | 'drop' | 'cut';
  flags: GateFlag[];
  notes: string[];
  ms: number;
  bufferedMs: number;
  mode: GateMode;
  /** The unit's text as checked (a dropped unit's text is shown struck through in ?debug). */
  text?: string;
  /** Spoken words in the unit (droppedWords sums them over drops). */
  words?: number;
  /** Tags removed by a strip (their source text). */
  stripped?: string[];
  /** This unit is a repair's replacement (re-checked once; a fail drops it). */
  repaired?: boolean;
  /** ms from the gate's start (the answer's Enter, as far as the gate knows). */
  at?: number;
};

/**
 * A repair's progress for unit `k` (stage 2 only). sent → ok (the replacement arrived) | late (past
 * the deadline: aborted, the unit dropped) | fail (the replacement failed its re-check) | refused
 * (the server said no: 404/429/400/cap) | error (network, upstream).
 */
export type RepairEvent = {
  t: 'repair';
  k: string;
  phase: 'sent' | 'ok' | 'late' | 'fail' | 'refused' | 'error';
  ms: number;
  usd?: number;
  text?: string;
};

export type GateLogEvent = GateEvent | RepairEvent;

/** What the repair note (server/prompt/repair.ts, `repairNote`) is written from: design §6. */
export type RepairReport = {
  /** The failed unit, verbatim (tags included). */
  beat: string;
  problems: GateFlag[];
  /** The board now, per section: the failed unit's section in full (`items`), the others as counts. */
  board: { section: string; count: number; items?: { id: string; kind: string; label?: string }[] }[];
  /** Named constants, lowercase. */
  consts: Record<string, number>;
  /** Named readouts ({{find}} ids). */
  finds: string[];
  /** Ids the buffered (later) text names that no committed tag creates: the replacement should create them. */
  later: string[];
  /** The last ≤ 12 committed words: the replacement continues right after them. */
  tail: string;
  /** The replacement's word budget (the unit's words + 10). */
  maxWords: number;
};

/** The body of POST /api/repair (minus reqId and phase, which the RepairFn's maker binds). */
export type RepairRequest = {
  /** The stage-2 unit index. */
  k: number;
  /** Stage-2 text released so far (the opener is already in the original tail). */
  committed: string;
  /** The failed unit, verbatim. */
  beat: string;
  report: RepairReport;
  /** ms the server may take before the client gives up (the client aborts at the deadline anyway). */
  deadlineMs: number;
};

/** A repair's outcome. `ok: false` with `reason` 'refused' (404/429/400/cap) or 'error'; an abort rejects or resolves with 'error'. */
export type RepairResult =
  | { ok: true; text: string; usd?: number }
  | { ok: false; reason: 'refused' | 'error'; detail?: string; usd?: number };

/** Asks the model for a replacement unit. Injected into the gate (makeRepair, fakeRepair, recordedRepair). */
export type RepairFn = (req: RepairRequest, signal: AbortSignal) => Promise<RepairResult>;

/** `&gatefail=K[:mode]`: per unit key, an injected fault (design §5.4). */
export type FaultMode = 'skip' | 'late' | 'bad' | 'ok';
export type Faults = Map<string, FaultMode>;
