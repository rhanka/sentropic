/**
 * The verb contract (SPEC_EVOL_RESOURCE_FS §3.3, RF2/RF5/RF6).
 *
 * The universal floor is `list`/`stat`/`read`/`grep`; `edit` is CAS-guarded write;
 * `invoke` is the side-effecting seam (distinct from write, RF3). Every provider
 * carries the FULL verb set so adding a verb never forces a v2 break — unimplemented
 * verbs return a typed `unsupported` error (see ResourceProviderBase). `watch` is
 * deferred to ARCH-21b and added on the base (non-breaking) when it lands.
 */

import type { ResourceRef, ScopeMap } from './ref.js';

/** A node in a list result: its ref, display path alias, and summary metadata. */
export interface ResourceNode {
  readonly ref: ResourceRef;
  /** Display alias, never identity. */
  readonly path: string;
  /** Leaf display name. */
  readonly name: string;
  readonly nodeType: 'dir' | 'resource';
  /** Equals `ref.type` for resources; the mount/kind for dirs. */
  readonly resourceType: string;
  readonly description?: string;
  readonly etag?: string;
}

export interface ListArgs {
  /** Page size; the provider caps it. */
  readonly limit?: number;
  /** Stable opaque page token from a prior `list`. */
  readonly pageToken?: string;
  /** Max recursion depth; default 1 (root `ls` never fans out synchronously). */
  readonly maxDepth?: number;
}

export interface ListResult {
  readonly entries: ReadonlyArray<ResourceNode>;
  /** Present when more pages exist; opaque + stable. */
  readonly nextPageToken?: string;
}

export interface StatResult {
  readonly ref: ResourceRef;
  readonly path: string;
  readonly nodeType: 'dir' | 'resource';
  readonly resourceType: string;
  readonly etag?: string;
  readonly size?: number;
  readonly contentType?: string;
}

export interface ReadArgs {
  /** Max bytes returned; over-budget reads are truncated with a summary. */
  readonly maxBytes?: number;
}

/** Provenance tag (RF6): read content is DATA tagged with origin, never instructions. */
export interface Provenance {
  readonly provider: string;
  readonly trust: 'first-party' | 'external';
  /** e.g. the MCP server name or catalog source id. */
  readonly origin?: string;
}

export interface ReadResult {
  readonly ref: ResourceRef;
  /** Text projection (binary content is base64 with a binary contentType). */
  readonly content: string;
  readonly contentType: string;
  readonly provenance: Provenance;
  readonly etag?: string;
  readonly truncated: boolean;
  /** Present when the read was truncated / over budget. */
  readonly summary?: string;
}

export interface GrepArgs {
  readonly query: string;
  readonly limit?: number;
}

export interface GrepHit {
  readonly ref: ResourceRef;
  readonly path: string;
  readonly score?: number;
  readonly snippet?: string;
}

export interface GrepResult {
  readonly hits: ReadonlyArray<GrepHit>;
}

export interface EditArgs {
  /** Optimistic CAS token from the prior `read`. */
  readonly etag?: string;
  readonly content: string;
  readonly contentType?: string;
}

export interface EditResult {
  readonly ref: ResourceRef;
  readonly etag: string;
}

export interface InvokeArgs {
  readonly args: Record<string, unknown>;
  /** Threaded at the invoke seam to make retries idempotent (RF anti-goal #5). */
  readonly idempotencyKey?: string;
}

export interface InvokeResult {
  readonly status: 'completed' | 'accepted';
  /** Inline result when `completed`. */
  readonly result?: unknown;
  /** A `/proc/jobs/<id>` handle when `accepted` (async). */
  readonly handle?: ResourceRef;
}

/** Typed, LLM-legible error codes (§3.3 error envelope + RF5 deny-as-missing). */
export type ResourceErrorCode =
  | 'not_found' // = deny-as-missing (no existence oracle)
  | 'denied'
  | 'provider_unavailable'
  | 'cas_conflict'
  | 'too_large'
  | 'invalid_args'
  | 'not_searchable'
  | 'unsupported' // verb not supported by this provider/type
  | 'ambiguous_alias'; // a path alias resolves to more than one ref

export class ResourceError extends Error {
  constructor(
    readonly code: ResourceErrorCode,
    message: string,
    readonly ref?: ResourceRef
  ) {
    super(message);
    this.name = 'ResourceError';
  }
}

/** Floor + side-effecting/observability verbs. `watch` lands in ARCH-21b. */
export type ResourceVerb = 'list' | 'stat' | 'read' | 'grep' | 'edit' | 'invoke';

/** The server-derived principal an authz projector evaluates a request against. */
export interface ResourcePrincipal {
  readonly scope: ScopeMap;
  /** Availability/role/membership context evaluated by the authz projector. */
  readonly context?: Record<string, unknown>;
}

/**
 * A mount provider over a subtree (SPEC_EVOL_RESOURCE_FS §3.2). Implementations
 * extend `ResourceProviderBase` and override only the verbs they support; the base
 * defaults every other verb to a typed `unsupported` error.
 */
export interface ResourceProvider {
  /** Provider id, e.g. 'catalog' or 'mcp:<server>'. */
  readonly provider: string;
  /** Root mount segments this provider owns, e.g. ['tools','skills','agents','workflows','canvas'] or ['mcp']. */
  readonly mounts: ReadonlyArray<string>;

  list(ref: ResourceRef, args: ListArgs, principal: ResourcePrincipal): Promise<ListResult>;
  stat(ref: ResourceRef, principal: ResourcePrincipal): Promise<StatResult>;
  read(ref: ResourceRef, args: ReadArgs, principal: ResourcePrincipal): Promise<ReadResult>;
  grep(ref: ResourceRef, args: GrepArgs, principal: ResourcePrincipal): Promise<GrepResult>;
  edit(ref: ResourceRef, args: EditArgs, principal: ResourcePrincipal): Promise<EditResult>;
  invoke(ref: ResourceRef, args: InvokeArgs, principal: ResourcePrincipal): Promise<InvokeResult>;
  /**
   * Resolve a path (segments relative to root, e.g. ['skills','foo']) within this
   * provider's mounts to a canonical ref (RF1 alias resolution), or null if unknown.
   */
  resolvePath(segments: ReadonlyArray<string>, principal: ResourcePrincipal): Promise<ResourceRef | null>;
}
