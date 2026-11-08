import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const here = (p: string): string => fileURLToPath(new URL(p, import.meta.url));

/**
 * Library build. Produces, in dist/ (deployed to /lib/ in the bucket):
 *
 * - markdown2.js      ES module (code-split: `age` loads only when a key is used)
 * - markdown2.umd.js  classic script, global `markdown2`
 * - index.html        the example page (from public/), which imports ./markdown2.js
 *
 * @markdown2/core is consumed from source, as in the PWA.
 */
export default defineConfig({
  base: './',
  resolve: {
    alias: { '@markdown2/core': here('../../packages/core/src/index.ts') },
  },
  server: { fs: { allow: ['../..'] } },
  build: {
    target: 'es2022',
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: true,
    copyPublicDir: true,
    lib: {
      entry: here('./src/index.ts'),
      name: 'markdown2',
      formats: ['es', 'umd'],
      fileName: (format) => (format === 'es' ? 'markdown2.js' : 'markdown2.umd.js'),
    },
    rollupOptions: {
      output: { chunkFileNames: 'chunks/[name]-[hash].js' },
    },
  },
});