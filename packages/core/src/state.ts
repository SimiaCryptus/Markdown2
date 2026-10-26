import {
  DecodeError,
  KeyRejected,
  LimitExceeded,
  type ByteQuota,
  type Decoder,
  type DecoderRegistry,
  type UriPolicy,
} from './decoders.js';
import type { DecodeState, ErrorCode, ResourceNode } from './types.js';

function hashPayload(p: Uint8Array): string {
  let h = 0x811c9dc5;
  for (const b of p) h = Math.imul(h ^ b, 0x01000193) >>> 0;
  return `${p.length}:${h.toString(16)}`;
}

/**
 * Per-node, per-stage grants. Bound to the payload digest, so editing a
 * payload invalidates its grants. Never propagates to children.
 */
export class GrantSet {
  private readonly grants = new Map<string, Map<number, unknown>>();
  private key(node: ResourceNode): string {
    return `${node.id}#${hashPayload(node.resource.payload)}`;
  }
  grant(node: ResourceNode, stage: number, value: unknown = true): void {
    const k = this.key(node);
    let stages = this.grants.get(k);
    if (!stages) {
      stages = new Map();
      this.grants.set(k, stages);
    }
    stages.set(stage, value);
  }
  revoke(node: ResourceNode, stage: number): void {
    this.grants.get(this.key(node))?.delete(stage);
  }
  get(node: ResourceNode, stage: number): unknown {
    return this.grants.get(this.key(node))?.get(stage);
  }
  has(node: ResourceNode, stage: number): boolean {
    return this.grants.get(this.key(node))?.has(stage) ?? false;
  }
}

export interface BatchTarget {
  node: ResourceNode;
  stage: number;
}

/**
 * Scope of a batch grant (§5.5): every stage of every given node whose
 * decoder id equals `decoderId` and is not yet granted. Show this to the
 * user before calling {@link applyBatchGrant}.
 */
export function batchScope(nodes: Iterable<ResourceNode>, decoderId: string, grants: GrantSet): BatchTarget[] {
  const id = decoderId.toLowerCase();
  const out: BatchTarget[] = [];
  for (const node of nodes) {
    if (node.structuralError) continue;
    node.resource.encoding.forEach((d, stage) => {
      if (d === id && !grants.has(node, stage)) out.push({ node, stage });
    });
  }
  return out;
}

/**
 * Apply an explicit, user-confirmed batch grant as individual per-node
 * grants. Children that appear only after unlocking are never included
 * implicitly; the caller must recompute the scope and ask again.
 */
export function applyBatchGrant(grants: GrantSet, targets: readonly BatchTarget[], value: unknown = true): void {
  for (const t of targets) grants.grant(t.node, t.stage, value);
}

export interface StateResult {
  state: DecodeState;
  error?: ErrorCode;
  bytes?: Uint8Array;
}

export interface DecodeOptions {
  registry: DecoderRegistry;
  grants: GrantSet;
  uriPolicy?: UriPolicy;
  quota: ByteQuota;
  signal?: AbortSignal;
}

/** Look up every decoder in the stack; null if any is unknown. */
function resolveStack(registry: DecoderRegistry, enc: readonly string[]): Decoder[] | null {
  const out: Decoder[] = [];
  for (const id of enc) {
    const d = registry.get(id);
    if (!d) return null;
    out.push(d);
  }
  return out;
}

/** Steps 1–3 of §5.5 state precedence. Runs no decoder. */
export function staticState(node: ResourceNode, opts: Omit<DecodeOptions, 'quota'>): StateResult | 'runnable' {
  if (node.structuralError) return { state: 'failed', error: node.structuralError };
  const enc = node.resource.encoding;
  if (enc.indexOf('uri') > 0) return { state: 'failed', error: 'uri-not-first' };
  const stack = resolveStack(opts.registry, enc);
  if (!stack) return { state: 'unsupported' };
  for (const [s, d] of stack.entries()) {
    if (!d.capability) continue;
    if (opts.grants.has(node, s)) continue;
    if (d.id === 'uri' && opts.uriPolicy) {
      const uri = new TextDecoder().decode(node.resource.payload).trim();
      if (opts.uriPolicy.allows(uri)) continue;
    }
    return { state: 'locked' };
  }
  return 'runnable';
}

/** Full §5.5 evaluation, including runtime decode errors (step 4). */
export async function decodeResource(node: ResourceNode, opts: DecodeOptions): Promise<StateResult> {
  const st = staticState(node, opts);
  if (st !== 'runnable') return st;
  const stack = resolveStack(opts.registry, node.resource.encoding);
  if (!stack) return { state: 'unsupported' }; // unreachable: staticState already checked
  let bytes = node.resource.payload;
  try {
    for (const [s, d] of stack.entries()) {
      const ctx = {
        quota: opts.quota,
        ...(opts.signal ? { signal: opts.signal } : {}),
        ...(opts.uriPolicy ? { uriPolicy: opts.uriPolicy } : {}),
        ...(opts.grants.has(node, s) ? { grant: opts.grants.get(node, s) } : {}),
      };
      bytes = await d.decode(bytes, ctx);
    }
  } catch (e) {
    if (e instanceof LimitExceeded) return { state: 'failed', error: 'limit-exceeded' };
    if (e instanceof KeyRejected) return { state: 'locked', error: 'key-rejected' };
    if (e instanceof DecodeError) return { state: 'failed', error: e.code };
    return { state: 'failed', error: 'decode-error' };
  }
  return { state: 'decoded', bytes };
}
