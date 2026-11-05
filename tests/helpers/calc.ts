// tests/helpers/calc.ts — a script's calc programs run as the sandbox would (src/calc/sandbox.ts runs the
// same prepared body in a Web Worker; tests have none, so node:vm).
import vm from 'node:vm';
import { prepareCalc } from '../../src/calc/prepare';
import { calcNumbers, type CalcTable } from '../../src/calc/stream';

/** Every `<calc id="…">…</calc>` in a raw script, run: its numbers by lowercase calc id. */
export function calcsOf(script: string): Map<string, CalcTable> {
  const out = new Map<string, CalcTable>();
  for (const m of script.matchAll(/<calc id="(\w+)">([\s\S]*?)<\/calc>/g)) {
    const p = prepareCalc(m[1], m[2]);
    out.set(m[1].toLowerCase(), calcNumbers(vm.runInNewContext(`(function(){${p.body}})()`)));
  }
  return out;
}
