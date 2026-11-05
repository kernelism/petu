// src/calc/sandbox.ts — runs a prepared <calc> where it can compute and nothing else.
/**
 * Each run gets a fresh Web Worker (no DOM, its own realm) built from WORKER_SOURCE. Before it reads
 * the program, the worker takes away everything that reaches outside: network and storage APIs,
 * nested workers, string evaluation (eval, the Function constructors of every function kind, timers
 * that take strings), and its own postMessage (kept privately for the one reply). Math.random is
 * seeded by the calc's id and Date.now is fixed, so a replay, a step back and the gate's shadow run
 * all see the numbers the student saw. A run that takes longer than `ms` is terminated (an endless
 * loop costs one worker, never the tab). Exported functions are dropped (only values cross back). prepare.ts's source check is the first fence; this is the second.
 *
 * WORKER_SOURCE is plain script text so the tests can run the same lockdown in node:vm.
 */
import { CalcError, checkValues, type CalcResult, type Prepared } from './prepare';

export const CALC_MS = 800;

export const WORKER_SOURCE = String.raw`(function () {
  "use strict";
  var G = self, F = Function, post = G.postMessage.bind(G);
  var deny = ['fetch', 'XMLHttpRequest', 'WebSocket', 'WebSocketStream', 'EventSource', 'WebTransport', 'importScripts',
    'indexedDB', 'caches', 'BroadcastChannel', 'Worker', 'SharedWorker', 'navigator', 'RTCPeerConnection',
    'setTimeout', 'setInterval', 'queueMicrotask', 'requestAnimationFrame', 'eval', 'Function', 'postMessage',
    'close', 'WebAssembly', 'Atomics', 'SharedArrayBuffer', 'FileReader', 'FileReaderSync', 'Request', 'Response',
    'crypto', 'storage', 'performance', 'Notification', 'location', 'onmessage', 'addEventListener', 'Proxy', 'Reflect'];
  function strip(name) {
    for (var o = G; o; o = Object.getPrototypeOf(o)) {
      var d = Object.getOwnPropertyDescriptor(o, name);
      if (!d) continue;
      try { delete o[name]; } catch (e) {}
      if (Object.getOwnPropertyDescriptor(o, name)) { try { Object.defineProperty(o, name, { value: undefined, writable: false, configurable: false }); } catch (e) {} }
    }
  }
  function thrower() { throw new TypeError('not available in a calc'); }
  var kinds = [function () {}, async function () {}, function* () {}, async function* () {}];
  var seed = 1;
  function rand() {
    seed = (seed + 0x6d2b79f5) | 0;
    var t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  function run(msg) {
    var h = 2166136261;
    for (var i = 0; i < msg.id.length; i++) { h ^= msg.id.charCodeAt(i); h = Math.imul(h, 16777619); }
    seed = h | 0;
    var fn;
    try { fn = F(msg.body); } catch (e) { post({ ok: false, error: 'does not parse: ' + (e && e.message) }); return; }
    lock();
    // A helper the program exported (export const box = i => …) is not a number anyone says: left out, so the rest still crosses.
    try { var v = fn(), out = {}; for (var k in v) if (typeof v[k] !== 'function') out[k] = v[k]; post({ ok: true, values: out }); }
    catch (e) { post({ ok: false, error: String(e && e.message || e) }); }
  }
  function lock() {
    for (var i = 0; i < deny.length; i++) strip(deny[i]);
    for (var j = 0; j < kinds.length; j++) {
      var p = Object.getPrototypeOf(kinds[j]);
      try { Object.defineProperty(p, 'constructor', { value: thrower, writable: false, configurable: false }); } catch (e) {}
    }
    try { Object.defineProperty(Math, 'random', { value: rand, writable: false, configurable: false }); } catch (e) {}
    try { Object.defineProperty(Date, 'now', { value: function () { return 0; }, writable: false, configurable: false }); } catch (e) {}
    try { Object.freeze(Object.prototype); Object.freeze(Array.prototype); Object.freeze(Function.prototype); } catch (e) {}
  }
  G.onmessage = function (ev) { G.onmessage = null; run(ev.data); };
})();`;

let workerUrl: string | null = null;

/** Runs `p` in a fresh worker. Resolves its checked exports; rejects with a CalcError (parse, throw, timeout, bad value). */
export function runCalc(p: Prepared, ms = CALC_MS): Promise<CalcResult> {
  if (typeof Worker === 'undefined') return Promise.reject(new CalcError('calc needs a browser worker'));
  workerUrl ??= URL.createObjectURL(new Blob([WORKER_SOURCE], { type: 'text/javascript' }));
  const w = new Worker(workerUrl);
  return new Promise<CalcResult>((resolve, reject) => {
    const timer = setTimeout(() => { w.terminate(); reject(new CalcError(`calc ${p.id} ran past ${ms} ms (an endless loop?)`)); }, ms);
    const done = () => { clearTimeout(timer); w.terminate(); };
    w.onmessage = (ev: MessageEvent<{ ok: boolean; values?: unknown; error?: string }>) => {
      done();
      if (!ev.data?.ok) { reject(new CalcError(`calc ${p.id}: ${ev.data?.error ?? 'failed'}`)); return; }
      try { resolve({ id: p.id, values: checkValues(p.id, ev.data.values) }); } catch (e) { reject(e); }
    };
    w.onerror = (ev) => { ev.preventDefault?.(); done(); reject(new CalcError(`calc ${p.id}: ${ev.message || 'the worker failed (out of memory?)'}`)); };
    w.postMessage({ id: p.id, body: p.body });
  });
}
