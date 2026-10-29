// The live gate's invariants over every recorded answer (.petu/eval/runs), with random injected
// faults and no repair: nothing released contains an action the (recorded) board skipped or the
// session parser could not parse (I2); released text is the stream's units in order, each whole
// or stripped of failed page pointing, never changed after release (I1/I3).
import { describe, expect, it } from 'vitest';
import { listRuns, loadRun, runsDir, type Recording } from '../../scripts/gate-beats/recordings';
import { replayGate } from '../../scripts/gate-beats/liveReplay';
import { tokenize, type Tag } from '../../src/gate/segment';
import { ScriptParser } from '../../src/script/parser';
import { NEW_INK } from '../../src/gate/segment';
import type { GateEvent } from '../../src/gate/events';

function rng(seed: number) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 32; }; }

/** Every distinct recorded script (replays repeat their source's chunks). */
function recordings(): Recording[] {
  const root = runsDir();
  const seen = new Set<string>();
  const out: Recording[] = [];
  for (const run of listRuns(root)) {
    let recs: Recording[] = [];
    try { recs = loadRun(run, root); } catch { continue; }
    for (const r of recs) { if (seen.has(r.script)) continue; seen.add(r.script); out.push(r); }
  }
  return out;
}

/** Tags the session parser drops as malformed in `text`. */
function malformed(text: string): string[] {
  const bad: string[] = [];
  const warn = console.warn;
  console.warn = (...a: unknown[]) => { if (String(a[0]).includes('malformed')) bad.push(String(a[1])); };
  try { const p = new ScriptParser(); p.push(text); p.end(); } finally { console.warn = warn; }
  return bad;
}

const recs = recordings();

describe('live gate invariants over recorded answers', () => {
  it.skipIf(!recs.length)(`I1–I3 hold for ${recs.length} recorded scripts with random &gatefail, repair off`, async () => {
    const r = rng(20261029);
    let units = 0, drops = 0, injected = 0;
    for (const rec of recs) {
      // Random faults: each stage-2 unit (up to 30) and opener chunk with probability 0.15.
      const keys = [...Array.from({ length: 30 }, (_, i) => String(i)), ...Array.from({ length: 6 }, (_, i) => `o${i}`)];
      const gatefail = keys.filter(() => r() < 0.15).join(',');
      const res = await replayGate(rec, { gatefail });
      const gates = res.events.filter((e): e is GateEvent => e.t === 'gate');
      units += res.stats.units; drops += res.stats.drops;
      const releasedText = res.released.map((x) => x.text).join('');
      // I2: no released tag was skipped by the board (recorded) or is unparsable by the session parser.
      for (const piece of res.released) {
        for (const t of tokenize(piece.text)) {
          if (t.kind !== 'tag') continue;
          expect(res.skippedBodies.has((t as Tag).body), `${res.label}: released a skipped tag {{${(t as Tag).body}}}`).toBe(false);
        }
      }
      expect(malformed(releasedText), `${res.label}: released an unparsable tag`).toEqual([]);
      // I2 with injected faults: a faulted unit is dropped or released without its first ink tag.
      const faulted = new Set(gatefail.split(',').filter(Boolean));
      for (const e of gates) {
        if (!faulted.has(e.k) || e.action !== 'release') continue;
        const original = gates.find((g) => g.k === e.k);
        const firstInk = tokenize(original?.text ?? '').find((t) => t.kind === 'tag' && (t as Tag).action && NEW_INK.has((t as Tag).action!.kind)) as Tag | undefined;
        if (firstInk) { injected++; expect(e.result, `${res.label} ${e.k}: a faulted unit released whole`).toBe('strip'); }
      }
      // I1/I3: the released stream is the units released, in order, each exactly as checked; nothing else.
      const relEvents = gates.filter((e) => e.action === 'release');
      expect(res.released.length).toBe(relEvents.length);
      res.released.forEach((p, i) => expect(p.text.trim()).toBe(relEvents[i].text));
      // Unit keys are released in increasing order (no unit overtakes an earlier one).
      const order = relEvents.map((e) => (e.k.startsWith('o') ? -100 + Number(e.k.slice(1)) : Number(e.k)));
      expect([...order].sort((a, b) => a - b)).toEqual(order);
      // Released text is a subsequence of the stream (strips only remove tags).
      const stream = rec.script.replace(/\{\{[^}]*\}\}/g, '').replace(/\s+/g, ' ');
      const rel = releasedText.replace(/\{\{[^}]*\}\}/g, '').replace(/\s+/g, ' ').trim();
      let pos = 0;
      for (const w of rel.split(' ').filter(Boolean)) { const at = stream.indexOf(w, pos); expect(at, `${res.label}: "${w}" not in the stream in order`).toBeGreaterThanOrEqual(0); pos = at + w.length; }
    }
    expect(units).toBeGreaterThan(0);
    console.info(`[invariant] ${recs.length} scripts, ${units} units, ${drops} drops, ${injected} injected faults checked`);
  }, 300_000);
});
