import {
  ByteQuota,
  collectResources,
  collectStyles,
  DEFAULT_LIMITS,
  parse,
  renderHtml,
  resolveDocument,
  type CodeFenceRenderer,
  type Decoder,
  type DecoderRegistry,
  type Diagnostic,
  type GrantSet,
  type HandlerRegistry,
  type ResolvedNode,
  type ResolvedResource,
  type ResourceNode,
  type StyleModel,
  type UriPolicy,
} from '@markdown2/core';

export interface PipelineOptions {
  registry: DecoderRegistry;
  grants: GrantSet;
  handlers: HandlerRegistry;
  uriPolicy?: UriPolicy;
  signal?: AbortSignal;
  /** Presentation for fenced code, such as the Monaco frames. */
  codeFence?: CodeFenceRenderer;
   /** Mark rendered blocks with their source line (`data-m2-line`), for editor/page sync. */
   sourceLines?: boolean;
}

export interface PipelineResult {
  resolved: ResolvedNode[];
  diagnostics: Diagnostic[];
  html: string;
  /** Every resource in the tree, by node id. */
  resources: Map<string, ResolvedResource>;
  /** Document stylesheets and their groups (style.md §5). */
  styles: StyleModel;
  /** Decoded-size quota after resolution; stylesheet `data:` URLs draw on what is left. */
  quota: ByteQuota;
}

/** Parse, decode and render. DOM-free, so it can move into a worker later. */
export async function runPipeline(src: string, o: PipelineOptions): Promise<PipelineResult> {
  const doc = parse(src);
  const diagnostics: Diagnostic[] = [...doc.diagnostics];
  const quota = new ByteQuota(DEFAULT_LIMITS.maxDecodedBytes);
  const resolved = await resolveDocument(doc, {
    registry: o.registry,
    grants: o.grants,
    diagnostics,
    quota,
    handledTypes: o.handlers.types('view'),
    ...(o.uriPolicy ? { uriPolicy: o.uriPolicy } : {}),
    ...(o.signal ? { signal: o.signal } : {}),
  });
  const html = await renderHtml(resolved, {
    handlers: o.handlers,
    ...(o.codeFence ? { codeFence: o.codeFence } : {}),
     ...(o.sourceLines ? { sourceLines: true } : {}),
  });
  const resources = new Map(collectResources(resolved).map((e) => [e.node.id, e] as const));
  const styles = collectStyles(resolved);
  diagnostics.push(...styles.diagnostics);
  return { resolved, diagnostics, html, resources, styles, quota };
}

export interface Gate {
  stage: number;
  decoder: Decoder;
}

/** Capability-gated stages of a node that have no grant yet. */
export function gatedStages(node: ResourceNode, registry: DecoderRegistry, grants: GrantSet): Gate[] {
  const out: Gate[] = [];
  node.resource.encoding.forEach((id, stage) => {
    const decoder = registry.get(id);
    if (decoder?.capability !== undefined && !grants.has(node, stage)) out.push({ stage, decoder });
  });
  return out;
}

/**
 * The next stage the user should grant. When every gated stage already holds a
 * grant but the node is still locked, one of the keys was rejected. Which one
 * is unknown, so all of this node's gated grants are revoked and the user
 * starts again from the outermost layer.
 */
export function nextGate(node: ResourceNode, registry: DecoderRegistry, grants: GrantSet): Gate | null {
  const pending = gatedStages(node, registry, grants);
  if (pending[0]) return pending[0];
  node.resource.encoding.forEach((id, stage) => {
    if (registry.get(id)?.capability !== undefined) grants.revoke(node, stage);
  });
  return gatedStages(node, registry, grants)[0] ?? null;
}

export function describeNode(node: ResourceNode): string {
  const a = node.resource.attributes;
  return a.get('title') ?? a.get('filename') ?? node.resource.type ?? '(untyped resource)';
}