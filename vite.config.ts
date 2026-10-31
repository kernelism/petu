/// <reference types="vitest/config" />
import { defineConfig, searchForWorkspaceRoot } from 'vite';
import { realpathSync } from 'node:fs';
import react from '@vitejs/plugin-react';
import { petuApi } from './server/plugin';

export default defineConfig({
  plugins: [react(), petuApi()],
  server: {
    port: 5180,
    watch: { ignored: ['**/.petu/**'] },
    // Vite's defaults plus the ledger, eval runs and tokens under .petu/.
    // A worktree whose node_modules is a symlink elsewhere (the bisect/integration worktrees) still
    // serves its fonts: the real node_modules joins the allow list (Vite's default root stays).
    fs: { allow: [searchForWorkspaceRoot(process.cwd()), realpathSync('node_modules')], deny: ['.env', '.env.*', '*.{crt,pem}', '**/.git/**', '**/.petu/**'] },
  },
  test: { environment: 'jsdom', setupFiles: ['./vitest.setup.ts'], include: ['tests/**/*.test.ts'] },
});
