// scripts/gate-beats/labels.ts — hand labels for the offline gate evaluation (step 1), made from the
// transcripts and the recorded frames (final.png / board.jpg) BEFORE running the gate, then frozen.
// A label names a defect and a phrase of the narration in the beat it belongs to. Only the two
// classes the gate's targets are defined on are labelled: fatal number/claim contradictions with the
// page or the engine's computed values, and layout collisions on the board (text overlapped by text
// or ink, kit pieces colliding, ink outside the board). Engine skips and malformed tags are not
// hand-labelled: they are mechanical facts taken from the recording.

export type DefectKind = 'number' | 'layout';
/** `adjudicated`: added after the first gate run, when a flag sent me back to the frame and the defect was real (reported separately). */
export type Label = { kind: DefectKind; anchor: string; note: string; adjudicated?: boolean };

const DEV = '2026-10-28-terra-none-p4.7-q2-ae05d5d6-2';

export const LABELS: Record<string, Label[]> = {
  [`${DEV}/D9`]: [
    { kind: 'number', anchor: 'eleven bring it below one percent', note: 'the table computes 0.012 for k = 11; narration says below 1% (judge fatal: wrong_fact, drawing_contradicts_narration)' },
  ],
  [`${DEV}/D16`]: [
    { kind: 'number', anchor: 'Harris gives the edge-like patch a lower score', note: 'Harris column computes 0.76 → 2.74 (higher for the edge-like patch); narration says lower (judge fatal)' },
  ],
  [`${DEV}/D12`]: [
    // One pre-registered note named both collisions; the beat rule puts them in two beats, so they are two labels.
    { kind: 'layout', anchor: 'might record images one and two', note: 'the two posting-list texts "image 1, image 3" and "image 1, image 2" touch and read as one line (judge defect: cluttered)' },
    { kind: 'layout', anchor: 'the list at word A', note: 'the W1→L1 line runs through the "word A" label' },
  ],
  [`${DEV}/D13`]: [
    { kind: 'layout', anchor: 'add the two changes', note: 'bar labels collide: "acrossdown", "downacross", "row-column"/"column-row" overprint (judge defect: cluttered)' },
  ],
  [`${DEV}/D17`]: [
    { kind: 'layout', anchor: 'Now the matches lie on the same row', note: 'the row line strikes through the "x0" label (missed by hand; confirmed on a zoomed frame after the gate flagged it)', adjudicated: true },
  ],
  ['2026-10-29-terra-none-ask-p4.11-q2-ae05d5d6/X1']: [
    { kind: 'layout', anchor: 'She pushes the cart forward', note: 'minor: the hand arrow\'s head runs into the "cart and equipment" label' },
  ],
};

/** Every answer the evaluation covers: the 20 judged dev answers and the 2026-10-29 think-plan runs (each one answer, X1). */
export const EVAL_RUNS = [DEV];
export const EXTRA_PREFIX = '2026-10-29-';
