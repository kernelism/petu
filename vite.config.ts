/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { petuApi } from './server/plugin';

export default defineConfig({
  plugins: [react(), petuApi()],
  server: { port: 5180 },
  test: { environment: 'jsdom', setupFiles: ['./vitest.setup.ts'], include: ['tests/**/*.test.ts'] },
});
