import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const here = (p: string): string => fileURLToPath(new URL(p, import.meta.url));

/**
 * Sandboxed frames have an opaque origin ("null"), so their module scripts are
 * CORS requests. Local servers allow localhost and "null"; production gets the
 * same through a CloudFront response headers policy.
 */
const cors = { origin: [/^https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/, 'null'] };

/**
 * The app consumes @markdown2/core from source. Core is DOM-free ESM, so no
 * separate build or workspace link is needed for this barebones milestone.
 */
export default defineConfig({
  resolve: {
    alias: {
      '@markdown2/core': here('../../packages/core/src/index.ts'),
    },
  },
  server: { fs: { allow: ['../..'] }, cors },
  preview: { cors },
  worker: { format: 'es' },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 8000,
    rollupOptions: {
      input: {
        main: here('./index.html'),
        code: here('./sandbox/code.html'),
        mermaid: here('./sandbox/mermaid.html'),
        gchart: here('./sandbox/gchart.html'),
         x3d: here('./sandbox/x3d.html'),
      },
    },
  },
  test: { include: ['test/**/*.test.ts'] },
});