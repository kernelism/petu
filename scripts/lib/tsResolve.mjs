// scripts/lib/tsResolve.mjs — lets plain Node (--experimental-strip-types) import the app's src/
// modules, which use Vite-style extensionless relative imports: a relative specifier that fails to
// resolve is retried with `.ts`, then `/index.ts`.  Use: node --import ./scripts/lib/tsResolve.mjs …
import { register } from 'node:module';

register('data:text/javascript,' + encodeURIComponent(`
export async function resolve(spec, ctx, next) {
  try { return await next(spec, ctx); } catch (e) {
    if (!/^\\.{1,2}\\//.test(spec) || /\\.[cm]?[jt]sx?$/.test(spec)) throw e;
    try { return await next(spec + '.ts', ctx); } catch { return next(spec + '/index.ts', ctx); }
  }
}`));
