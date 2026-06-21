/**
 * ResourceRef — the canonical address of a resource (SPEC_EVOL_RESOURCE_FS §3.1, RF1).
 *
 * The ref is IDENTITY; display paths are aliases (an un-invalidated dentry cache in
 * the model's memory). Every list/read echoes the ref + etag so verbs accept the ref
 * form and renames never silently break a remembered path. The `res://` URI is the
 * equivalent string form (provider/type/id only — scope + etag are runtime context).
 */

/**
 * Binding-defined scope map (DD10). The Sentropic binding = `{tenantId, workspaceId}`.
 * SERVER-VERIFIED against the request principal — never trusted from the caller.
 */
export interface ScopeMap {
  readonly tenantId?: string;
  readonly workspaceId?: string;
  readonly [key: string]: string | undefined;
}

export interface ResourceRef {
  /** Mount provider: 'catalog' | 'mcp:<server>' | 'context' | 'proc' | ... */
  readonly provider: string;
  /** Binding-defined scope; server-verified, never client-trusted. */
  readonly scope: ScopeMap;
  /** Resource type within the provider: 'tool' | 'skill' | 'file' | 'job' | ... */
  readonly type: string;
  /** Stable provider id (the inode). For MCP resources this is the server's opaque uri verbatim. */
  readonly id: string;
  /** Version/CAS token echoed by `read`, required by `edit`. */
  readonly etag?: string;
}

/**
 * Format the addressing identity of a ref as a `res://` URI. Scope and etag are
 * runtime context, NOT part of the stable addressing string.
 */
export function formatRef(ref: Pick<ResourceRef, 'provider' | 'type' | 'id'>): string {
  return `res://${encodeURIComponent(ref.provider)}/${encodeURIComponent(ref.type)}/${encodeURIComponent(ref.id)}`;
}

/**
 * Parse a `res://provider/type/id` URI back into the addressing triple. The scope is
 * supplied by the dispatcher from the request principal (never decoded from the URI).
 * Throws on a malformed URI.
 */
export function parseRef(uri: string, scope: ScopeMap): ResourceRef {
  const m = /^res:\/\/([^/]+)\/([^/]+)\/(.+)$/.exec(uri);
  if (!m) {
    throw new Error(`invalid res:// uri: ${uri}`);
  }
  return {
    provider: decodeURIComponent(m[1]),
    type: decodeURIComponent(m[2]),
    id: decodeURIComponent(m[3]),
    scope,
  };
}

/** Structural ref equality on the addressing identity (provider/type/id). */
export function refIdentityEquals(a: ResourceRef, b: ResourceRef): boolean {
  return a.provider === b.provider && a.type === b.type && a.id === b.id;
}
