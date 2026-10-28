// scripts/gallery/serve.ts — `node --experimental-strip-types scripts/gallery/serve.ts <port>`: the repo's
// Vite dev server, plus fs.allow for node_modules' real path (a git worktree symlinks node_modules to the
// main checkout, and Vite would otherwise refuse KaTeX's fonts with 403).
import { realpathSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer, searchForWorkspaceRoot } from 'vite';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const port = Number(process.argv[2]);
const server = await createServer({
  root: ROOT, logLevel: 'error', clearScreen: false,
  server: { port, strictPort: true, host: '127.0.0.1', fs: { allow: [searchForWorkspaceRoot(ROOT), realpathSync(join(ROOT, 'node_modules'))] } },
});
await server.listen();
console.log('ready');
