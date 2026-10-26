import { encodeBase64 } from './base64.js';
import type { ResolvedNode } from './runtime.js';
import type { Document, DocNode, ResourceNode } from './types.js';

/**
 * Normalised tree for language-neutral conformance fixtures (plan §1).
 * Payloads are UTF-8 text when valid, otherwise base64 in `payloadBase64`.
 * Attribute keys are sorted so output is byte-stable.
 */
export type NormalisedNode =
  | { kind: 'prose'; text: string }
  | {
      kind: 'resource';
      id: string;
      rel: string;
      type: string | null;
      encoding: string[];
      attributes: Record<string, string>;
      token: string | null;
      syntax: string;
      payload?: string;
      payloadBase64?: string;
      error?: string;
      state?: string;
      children?: NormalisedNode[];
    };

function resourceBase(n: ResourceNode): Extract<NormalisedNode, { kind: 'resource' }> {
  const attributes: Record<string, string> = {};
  const entries = [...n.resource.attributes].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  for (const [k, v] of entries) attributes[k] = v;
  const out: Extract<NormalisedNode, { kind: 'resource' }> = {
    kind: 'resource',
    id: n.id,
    rel: n.rel,
    type: n.resource.type ?? null,
    encoding: [...n.resource.encoding],
    attributes,
    token: n.token,
    syntax: n.syntax,
  };
  try {
    out.payload = new TextDecoder('utf-8', { fatal: true }).decode(n.resource.payload);
  } catch {
    out.payloadBase64 = encodeBase64(n.resource.payload);
  }
  if (n.structuralError) out.error = n.structuralError;
  return out;
}

function prose(n: DocNode & { kind: 'prose' }): NormalisedNode {
  return { kind: 'prose', text: n.text };
}

/** Normalise a parse tree (no decoding). */
export function normaliseDocument(doc: Document): NormalisedNode[] {
  return doc.children.map((c) => (c.kind === 'prose' ? prose(c) : resourceBase(c)));
}

/** Normalise a resolved tree, including states, errors and nested documents. */
export function normaliseResolved(nodes: readonly ResolvedNode[]): NormalisedNode[] {
  return nodes.map((n) => {
    if (n.kind === 'prose') return prose(n);
    const out = resourceBase(n.node);
    out.state = n.result.state;
    if (n.result.error) out.error = n.result.error;
    if (n.children) out.children = normaliseResolved(n.children);
    return out;
  });
}

/** Stable JSON for fixture comparison. */
export function toFixtureJson(nodes: readonly NormalisedNode[]): string {
  return JSON.stringify(nodes, null, 2) + '\n';
}
