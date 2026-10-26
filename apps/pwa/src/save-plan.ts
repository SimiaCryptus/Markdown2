import { safeSaveName, type ResolvedResource } from '@markdown2/core';

export interface SavePlan {
  bytes: Uint8Array;
  /** Safe default name; never an active or unknown extension (§6.2). */
  name: string;
  /** Name requested by the document; use only after explicit confirmation. */
  requested?: string;
}

/** Plan a save. `decoded` is only possible for decoded resources. */
export function planSave(entry: ResolvedResource, form: 'raw' | 'decoded'): SavePlan | null {
  const { name, requested } = safeSaveName(entry.node, form);
  if (form === 'raw') return { bytes: entry.node.resource.payload, name };
  if (entry.result.state !== 'decoded' || entry.result.bytes === undefined) return null;
  return { bytes: entry.result.bytes, name, ...(requested !== undefined ? { requested } : {}) };
}