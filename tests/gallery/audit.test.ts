import { describe, it, expect } from 'vitest';
import { auditGate, AUDIT_PREFIX } from '../../scripts/gallery/audit';
import { galleryStep } from '../../scripts/gallery/summary';
import { SCENES, audited } from '../../scripts/gallery/scenes';
import { SCRIPTS } from '../../src/demo/scripts';

const g = (o: object) => ({ t: 'gate', k: '0', unit: 'beat', result: 'pass', action: 'release', flags: [], notes: [], ms: 3, bufferedMs: 0, mode: 'beat', ...o });

describe('gate audit of dev scripts', () => {
  it('passes clean units and notes; fails flags, fails, drops and drift', () => {
    expect(auditGate([g({}), g({ notes: ['small-text: 9px'] }), { t: 'repair', k: '1', phase: 'sent', ms: 0 }])).toEqual([]);
    expect(auditGate(undefined)).toEqual([]);
    const out = auditGate([g({ k: '2', result: 'fail', action: 'drop', flags: [{ check: 'named', detail: '"point Z" has no element' }], text: 'Notice point Z' }),
      g({ k: '3', result: 'strip', flags: [{ check: 'tag', detail: 'skipped circle' }] }), g({ k: '4', notes: ['shadow drift: 4 px'] })]);
    expect(out).toEqual([
      `${AUDIT_PREFIX} unit 2 dropped; named: "point Z" has no element — "Notice point Z"`,
      `${AUDIT_PREFIX} unit 3 stripped; tag: skipped circle`,
      `${AUDIT_PREFIX} unit 4 flagged; shadow drift: 4 px`,
    ]);
  });
  it('an audit error fails the gallery step even with no pixel change', () => {
    const rows = [{ name: 'kit@end.chromium.1440x900', status: 'same' as const, pixels: 0, ratio: 0, box: null }];
    expect(galleryStep(rows, [], { ms: 1, baseline: 'b', sheet: 's', errors: [] }).ok).toBe(true);
    const r = galleryStep(rows, [], { ms: 1, baseline: 'b', sheet: 's', errors: [`kit.chromium.1440x900: ${AUDIT_PREFIX} unit 0 dropped`] });
    expect(r.ok).toBe(false);
    expect(r.detail).toContain(AUDIT_PREFIX);
  });
  it('dev scripts are audited, the gate demo is not; its scenes exist and name a real script', () => {
    const by = Object.fromEntries(SCENES.map((s) => [s.name, s]));
    expect(audited(by.kit)).toBe(true);
    expect(audited(by.demo1)).toBe(false);
    expect(audited(by.gate)).toBe(false);
    expect(by.gate.query).toBe('script=gate&gate=live');
    expect(by['gate-repair'].query).toBe('script=gate&gate=live&gatefail=2:skip&repair=fake&repairms=1500');
    expect(SCRIPTS.gate.repairs?.[2]).toMatch(/\{\{emph id=d\}\}/);
    // Beat 3 (unit 2) names Z; nothing creates a Z.
    expect(SCRIPTS.gate.script).toContain('Notice point Z');
    expect(SCRIPTS.gate.script).not.toMatch(/id=Z|"Z"/);
  });
});
