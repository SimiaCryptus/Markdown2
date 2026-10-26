export type DecodeState = 'decoded' | 'locked' | 'unsupported' | 'failed';

export type ErrorCode =
  | 'unterminated-resource'
  | 'unterminated-frontmatter'
  | 'malformed-opener'
  | 'missing-type'
  | 'duplicate-attribute'
  | 'uri-not-first'
  | 'limit-exceeded'
  | 'decode-error'
  | 'invalid-utf-8'
  | 'key-rejected';

export type DiagnosticCode = ErrorCode | 'wrapper-unclosed';

export interface Diagnostic {
  code: DiagnosticCode;
  message: string;
  line: number; // 0-based source line
  nodeId?: string;
}

export interface Resource {
  /** Raw declared string, never normalised. */
  type: string | undefined;
  /** Lower-cased decoder ids, in decoding order. */
  encoding: readonly string[];
  /** Prefix-stripped, exact payload bytes. */
  payload: Uint8Array;
  /** Attribute names lower-cased. */
  attributes: ReadonlyMap<string, string>;
}

export interface ResourceNode {
  kind: 'resource';
  id: string;
  rel: string;
  resource: Resource;
  token: string | null;
  syntax: 'block' | 'frontmatter' | 'wrapped';
  structuralError?: ErrorCode;
  startLine: number;
  endLine: number;
}

export interface ProseNode {
  kind: 'prose';
  text: string;
  startLine: number;
}

export type DocNode = ResourceNode | ProseNode;

export interface Document {
  children: DocNode[];
  diagnostics: Diagnostic[];
}

export interface Limits {
  maxDepth: number;
  maxResources: number;
  maxDecodedBytes: number;
}

/** Documented default limits (§6.3). */
export const DEFAULT_LIMITS: Limits = Object.freeze({
  maxDepth: 16,
  maxResources: 10_000,
  maxDecodedBytes: 64 * 1024 * 1024,
});
