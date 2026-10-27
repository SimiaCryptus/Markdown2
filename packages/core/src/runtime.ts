import { ByteQuota, DecoderRegistry, type UriPolicy } from './decoders.js';
import { parse } from './parser.js';
import { decodeResource, GrantSet, type StateResult } from './state.js';
import {
  DEFAULT_LIMITS,
  type Diagnostic,
  type Document,
  type Limits,
  type ProseNode,
  type ResourceNode,
} from './types.js';

export const DID_YOU_MEAN: Readonly<Record<string, string>> = {
  'image/jpg': 'image/jpeg',
  'text/json': 'application/json',
  'image/svg': 'image/svg+xml',
  'text/yaml': 'application/yaml',
  'application/x-yaml': 'application/yaml',
  'text/x-markdown': 'text/markdown',
  'text/mermaid': 'text/vnd.mermaid',
  'text/x-graphviz': 'text/vnd.graphviz',
  'text/graphviz': 'text/vnd.graphviz',
};

/** Media type essence; comparison stays exact, no content is inspected. */
export function typeEssence(type: string | undefined): string | undefined {
  return type?.split(';')[0]?.trim().toLowerCase();
}

export interface ResolvedResource {
  kind: 'resource';
  node: ResourceNode;
  result: StateResult;
  /** Present for decoded text/markdown resources. */
  children?: ResolvedNode[];
  fallback?: Fallback;
}
export type ResolvedNode = ProseNode | ResolvedResource;

export interface Fallback {
  label: string | undefined;
  type: string | undefined;
  encoding: string;
  state: StateResult['state'];
  error?: string;
  size: number;
  suggestion?: string;
}

export interface ResolveOptions {
  registry?: DecoderRegistry;
  grants?: GrantSet;
  uriPolicy?: UriPolicy;
  limits?: Partial<Limits>;
  /** Exact type strings that have a handler. */
  handledTypes?: ReadonlySet<string>;
  signal?: AbortSignal;
  /** Sink for diagnostics raised while resolving (nested parses, rejected keys, decode errors). */
  diagnostics?: Diagnostic[];
  /** Decoded-size quota. Pass one to share it with later consumers such as stylesheet `data:` URLs. */
  quota?: ByteQuota;
}
/**
 * Handler lookup (spec-issues #10): compare the lower-cased essence for
 * case-insensitivity per RFC 6838. No content is inspected.
 */
export function hasHandler(handled: ReadonlySet<string>, type: string | undefined): boolean {
  const essence = typeEssence(type);
  if (essence === undefined) return false;
  for (const t of handled) if (typeEssence(t) === essence) return true;
  return false;
}

export function fallbackFor(node: ResourceNode, result: StateResult): Fallback {
  const essence = typeEssence(node.resource.type);
  // Own keys only: a type such as "constructor" must not hit Object.prototype.
  const suggestion = essence !== undefined && Object.hasOwn(DID_YOU_MEAN, essence) ? DID_YOU_MEAN[essence] : undefined;
  return {
    label: node.resource.attributes.get('title') ?? node.resource.attributes.get('filename'),
    type: node.resource.type,
    encoding: node.resource.encoding.join(' '),
    state: result.state,
    ...(result.error ? { error: result.error } : {}),
    size: result.bytes?.length ?? node.resource.payload.length,
    ...(suggestion ? { suggestion } : {}),
  };
}

export async function resolveDocument(doc: Document, opts: ResolveOptions = {}): Promise<ResolvedNode[]> {
  const limits = { ...DEFAULT_LIMITS, ...opts.limits };
  const ctx = {
    registry: opts.registry ?? new DecoderRegistry(),
    grants: opts.grants ?? new GrantSet(),
    quota: opts.quota ?? new ByteQuota(limits.maxDecodedBytes),
    counter: { resources: doc.children.filter((c) => c.kind === 'resource').length },
  };
  const handled = opts.handledTypes ?? new Set(['text/markdown']);
  const sink = opts.diagnostics;
  const report = (node: ResourceNode, code: Diagnostic['code'], message: string) =>
    sink?.push({ code, message, line: node.startLine, nodeId: node.id });

  const walk = async (d: Document, depth: number): Promise<ResolvedNode[]> => {
    const out: ResolvedNode[] = [];
    for (const child of d.children) {
      if (child.kind === 'prose') {
        out.push(child);
        continue;
      }
      let result = await decodeResource(child, {
        ...ctx,
        ...(opts.uriPolicy ? { uriPolicy: opts.uriPolicy } : {}),
        ...(opts.signal ? { signal: opts.signal } : {}),
      });
      const entry: ResolvedResource = { kind: 'resource', node: child, result };
      if (result.error === 'key-rejected') report(child, 'key-rejected', 'Key rejected; resource remains locked');
      else if (result.state === 'failed' && !child.structuralError && result.error) {
        report(child, result.error, `Decoding failed: ${result.error}`);
      }
      if (result.state === 'decoded' && typeEssence(child.resource.type) === 'text/markdown') {
        if (depth + 1 > limits.maxDepth) {
          result = { state: 'failed', error: 'limit-exceeded' };
          entry.result = result;
          report(child, 'limit-exceeded', 'Nesting depth limit exceeded');
        } else {
          let text: string | undefined;
          try {
            text = new TextDecoder('utf-8', { fatal: true }).decode(result.bytes);
          } catch {
            entry.result = { state: 'failed', error: 'invalid-utf-8' };
            report(child, 'invalid-utf-8', 'Nested text/markdown is not valid UTF-8');
          }
          if (text !== undefined) {
            const nested = parse(text, { idPrefix: `${child.id}/`, limits, counter: ctx.counter });
            sink?.push(...nested.diagnostics);
            entry.children = await walk(nested, depth + 1);
          }
        }
      }
      if (entry.result.state !== 'decoded' || !hasHandler(handled, child.resource.type)) {
        entry.fallback = fallbackFor(child, entry.result);
      }
      out.push(entry);
    }
    return out;
  };
  return walk(doc, 0);
}
/** Flatten a resolved tree into its resource entries, depth first. */
export function collectResources(nodes: readonly ResolvedNode[]): ResolvedResource[] {
  const out: ResolvedResource[] = [];
  for (const n of nodes) {
    if (n.kind !== 'resource') continue;
    out.push(n);
    if (n.children) out.push(...collectResources(n.children));
  }
  return out;
}
