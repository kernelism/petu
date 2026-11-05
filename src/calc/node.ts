// src/calc/node.ts — runs a calc in node (node:vm), for the eval harness and tests, which have no Web
// Worker. The same prepared body and the same lockdown (sandbox.ts WORKER_SOURCE) as the browser, with
// vm's timeout. Never imported by browser code.
import vm from 'node:vm';
import { CalcError, checkValues, prepareCalc, type CalcResult } from './prepare';
import { CALC_MS, WORKER_SOURCE } from './sandbox';

export function runCalcNode(id: string, code: string, ms = CALC_MS): Promise<CalcResult> {
  try {
    const p = prepareCalc(id, code);
    let reply: { ok: boolean; values?: unknown; error?: string } | null = null;
    const ctx: Record<string, unknown> = { postMessage: (m: typeof reply) => { reply = m; } };
    ctx.self = ctx;
    vm.createContext(ctx);
    vm.runInContext(WORKER_SOURCE, ctx);
    ctx.msg = { id: p.id, body: p.body };
    vm.runInContext('self.onmessage({ data: msg })', ctx, { timeout: ms });
    const r = reply as { ok: boolean; values?: unknown; error?: string } | null;
    if (!r?.ok) throw new CalcError(`calc ${id}: ${r?.error ?? 'failed'}`);
    return Promise.resolve({ id, values: checkValues(id, structuredClone(r.values)) });
  } catch (e) {
    return Promise.reject(e instanceof CalcError ? e : new CalcError(`calc ${id}: ${(e as Error).message}`));
  }
}
