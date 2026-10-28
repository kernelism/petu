/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { petuApi } from './server/plugin';

export default defineConfig({
  plugins: [react(), petuApi()],
  server: {
    port: 5180,
    watch: { ignored: ['**/.petu/**'] },
    // Vite's defaults plus the ledger, eval runs and tokens under .petu/.
    fs: { deny: ['.env', '.env.*', '*.{crt,pem}', '**/.git/**', '**/.petu/**'] },
  },
  test: { environment: 'jsdom', setupFiles: ['./vitest.setup.ts'], include: ['tests/**/*.test.ts'] },
});
