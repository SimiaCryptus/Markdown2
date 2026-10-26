import type { DocNode, ResourceNode } from './types.js';

/** Appendix A.1 baseline relationship tokens. */
export const BASELINE_RELS = ['inline', 'metadata', 'attachment', 'alternate', 'describedby'] as const;
export type BaselineRel = (typeof BASELINE_RELS)[number];

/** Baseline tokens plus `stylesheet`, defined by Markdown2 Style Sheets (style.md §2). */
export const KNOWN_RELS = [...BASELINE_RELS, 'stylesheet'] as const;
export type KnownRel = (typeof KNOWN_RELS)[number];

/**
 * Relationship used for rendering. Unknown and vendor tokens are preserved on
 * the node but render as `inline` (A.1). Comparison is case-insensitive, as
 * for link relations in RFC 8288 (spec-issues #12).
 */
export function effectiveRel(rel: string): KnownRel {
  const r = rel.toLowerCase();
  return KNOWN_RELS.find((b) => b === r) ?? 'inline';
}

/** Token for the styling tree: known tokens in canonical case, others as written. */
export function relToken(rel: string): string {
  const r = rel.toLowerCase();
  return KNOWN_RELS.find((b) => b === r) ?? rel;
}

export interface RelAssociation {
  kind: 'alternate' | 'describedby';
  nodeId: string;
  targetId: string;
}

export interface RelAnalysis {
  associations: RelAssociation[];
  /** `alternate`/`describedby` nodes without a valid target. Render them inline. */
  orphans: string[];
}

/**
 * Associate `alternate` and `describedby` nodes with their "preceding sibling
 * resource" (A.1) within one document level (spec-issues #5):
 *
 * - blank prose between the two does not break the association;
 * - non-blank prose or a `metadata` node does;
 * - `stylesheet` nodes are invisible and transparent (spec-issues #25);
 * - several alternates/descriptions may attach to the same target;
 * - an `alternate` or `describedby` node is never itself a target.
 *
 * Orphans are rendered rather than dropped (§2 principle 6).
 */
export function analyseRels(children: readonly DocNode[]): RelAnalysis {
  const associations: RelAssociation[] = [];
  const orphans: string[] = [];
  let previous: ResourceNode | null = null;
  for (const c of children) {
    if (c.kind === 'prose') {
      if (/\S/.test(c.text)) previous = null;
      continue;
    }
    const rel = effectiveRel(c.rel);
    if (rel === 'stylesheet') continue;
    if (rel === 'alternate' || rel === 'describedby') {
      if (previous) associations.push({ kind: rel, nodeId: c.id, targetId: previous.id });
      else orphans.push(c.id);
      continue;
    }
    previous = rel === 'metadata' ? null : c;
  }
  return { associations, orphans };
}
