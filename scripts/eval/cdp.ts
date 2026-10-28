// scripts/eval/cdp.ts — headless Chrome over raw CDP (the pattern of the scratchpad tools). No dependencies.
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { createServer } from 'node:net';

const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const freePort = (): Promise<number> => new Promise((res, rej) => {
  const s = createServer();
  s.once('error', rej);
  s.listen(0, '127.0.0.1', () => { const p = (s.address() as { port: number }).port; s.close(() => res(p)); });
});

export class Chrome {
  private ws!: WebSocket;
  private id = 0;
  private pending = new Map<number, (m: { result?: unknown; error?: { message: string } }) => void>();
  private bindings = new Map<string, (payload: string) => void>();
  readonly errors: string[] = [];
  private proc!: ChildProcess;
  private profile!: string;

  static async launch(o: { dir: string; width?: number; height?: number }): Promise<Chrome> {
    const c = new Chrome();
    // A port the OS says is free (a random pick could hand two parallel Chromes the same port, and the
    // second then drives the first one's tab: "Inspected target navigated or closed").
    const port = await freePort();
    c.profile = join(o.dir, `prof${port}`);
    mkdirSync(c.profile, { recursive: true });
    c.proc = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${port}`, `--window-size=${o.width ?? 1440},${o.height ?? 900}`,
      '--force-device-scale-factor=1', `--user-data-dir=${c.profile}`, '--no-first-run', 'about:blank'], { stdio: 'ignore' });
    let tabs: { type: string; webSocketDebuggerUrl: string }[] | undefined;
    for (let i = 0; i < 100 && !tabs; i++) { try { tabs = await (await fetch(`http://127.0.0.1:${port}/json`)).json() as typeof tabs; } catch { await sleep(100); } }
    if (!tabs) throw new Error('Chrome did not start');
    c.ws = new WebSocket(tabs.find((t) => t.type === 'page')!.webSocketDebuggerUrl);
    await new Promise<void>((r, j) => { c.ws.addEventListener('open', () => r()); c.ws.addEventListener('error', () => j(new Error('cdp socket'))); });
    c.ws.addEventListener('message', (m) => {
      const d = JSON.parse(String(m.data));
      if (d.id && c.pending.has(d.id)) { c.pending.get(d.id)!(d); c.pending.delete(d.id); }
      else if (d.method === 'Runtime.bindingCalled') c.bindings.get(d.params.name)?.(d.params.payload);
      else if (d.method === 'Runtime.exceptionThrown') c.errors.push(d.params.exceptionDetails.exception?.description ?? d.params.exceptionDetails.text);
    });
    await c.send('Runtime.enable'); await c.send('Page.enable');
    await c.send('Emulation.setFocusEmulationEnabled', { enabled: true });
    return c;
  }

  send<T = Record<string, unknown>>(method: string, params: object = {}): Promise<T> {
    return new Promise((resolve, reject) => {
      const i = ++this.id;
      this.pending.set(i, (m) => (m.error ? reject(new Error(`${method}: ${m.error.message}`)) : resolve((m.result ?? {}) as T)));
      this.ws.send(JSON.stringify({ id: i, method, params }));
    });
  }

  /** Evaluates an expression (awaiting promises) and returns its JSON value. */
  async eval<T = unknown>(expression: string): Promise<T> {
    const r = await this.send<{ result?: { value?: T }; exceptionDetails?: { exception?: { description?: string }; text: string } }>('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
    return r.result?.value as T;
  }

  async binding(name: string, fn: (payload: string) => void): Promise<void> {
    this.bindings.set(name, fn);
    await this.send('Runtime.addBinding', { name });
  }

  async goto(url: string): Promise<void> { await this.send('Page.navigate', { url }); }

  /** Image bytes of the viewport. */
  async shot(format: 'png' | 'jpeg' = 'png'): Promise<Buffer> {
    const r = await this.send<{ data: string }>('Page.captureScreenshot', { format, ...(format === 'jpeg' ? { quality: 85 } : {}) });
    return Buffer.from(r.data, 'base64');
  }

  async close(): Promise<void> {
    try { this.ws.close(); } catch { /* already closed */ }
    this.proc.kill();
    await sleep(100);
    try { rmSync(this.profile, { recursive: true, force: true }); } catch { /* best effort */ }
  }
}
