import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

/**
 * The app consumes @markdown2/core from source. Core is DOM-free ESM, so no
 * separate build or workspace link is needed for this barebones milestone.
 */
export default defineConfig({
  resolve: {
    alias: {
      '@markdown2/core': fileURLToPath(new URL('../../packages/core/src/index.ts', import.meta.url)),
    },
  },
  server: { fs: { allow: ['../..'] } },
  build: { target: 'es2022' },
  test: { include: ['test/**/*.test.ts'] },
});