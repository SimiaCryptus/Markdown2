import { existsSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const here = (p: string): string => fileURLToPath(new URL(p, import.meta.url));

/**
 * Tartlet (music sketches) is bundled from the sibling `tartlet/` folder in the
 * same repository, through relative paths: each `@tartlet/<pkg>` resolves to its
 * TypeScript source. No install, publish or workspace link is needed.
 */
const tartletPkgs = here('../../../tartlet/packages/');
const tartletAlias: Record<string, string> = existsSync(tartletPkgs)
  ? Object.fromEntries(
      readdirSync(tartletPkgs)
        .filter((name) => existsSync(`${tartletPkgs}${name}/src/index.ts`))
        .map((name) => [`@tartlet/${name}`, `${tartletPkgs}${name}/src/index.ts`]),
    )
  : {};

/**
 * DataCalculator (live calculators) is bundled the same way, from the sibling
 * `DataCalculator/` folder: `@datacalc/core` resolves to its TypeScript source.
 * It is DOM-free apart from its view layer and fetches nothing.
 */
const datacalcEntry = here('../../../DataCalculator/src/index.ts');
const datacalcAlias: Record<string, string> = existsSync(datacalcEntry) ? { '@datacalc/core': datacalcEntry } : {};

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
      ...tartletAlias,
      ...datacalcAlias,
    },
  },
  // Markdown2 root plus the repository root, which holds tartlet/ and DataCalculator/.
  server: { fs: { allow: ['../..', '../../..'] }, cors },
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
        graphviz: here('./sandbox/graphviz.html'),
        gchart: here('./sandbox/gchart.html'),
        x3d: here('./sandbox/x3d.html'),
        map: here('./sandbox/map.html'),
        plotly: here('./sandbox/plotly.html'),
        vega: here('./sandbox/vega.html'),
        tartlet: here('./sandbox/tartlet.html'),
        datacalc: here('./sandbox/datacalc.html'),
      },
    },
  },
  test: { include: ['test/**/*.test.ts'] },
});