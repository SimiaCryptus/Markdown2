import type { ResolvedNode, ResolvedResource } from '../src/index.js';

/** Narrow a resolved node to a resource, failing the test otherwise. */
export function asResource(n: ResolvedNode | undefined): ResolvedResource {
  if (n?.kind !== 'resource') throw new Error(`expected a resource node, got ${n?.kind ?? 'nothing'}`);
  return n;
}
