#!/usr/bin/env node
/**
 * Copy X_ITE's distribution into public/vendor/x_ite.
 *
 * X_ITE loads its components, fonts and shaders relative to its own script
 * URL, so it is served as-is from this app's origin instead of being bundled.
 * The X3D sandbox frame (sandbox/x3d.html) loads /vendor/x_ite/x_ite.min.js.
 */
import { cpSync, existsSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const src = fileURLToPath(new URL('../node_modules/x_ite/dist/', import.meta.url));
const dest = fileURLToPath(new URL('../public/vendor/x_ite/', import.meta.url));

if (!existsSync(src)) {
  console.warn('[vendor-x_ite] x_ite is not installed; X3D scenes will show their source only.');
  process.exit(0);
}
rmSync(dest, { recursive: true, force: true });
cpSync(src, dest, {
  recursive: true,
  // Archives and source maps are not needed at runtime.
  filter: (p) => !p.endsWith('.zip') && !p.endsWith('.map'),
});
console.log('[vendor-x_ite] copied X_ITE to public/vendor/x_ite');