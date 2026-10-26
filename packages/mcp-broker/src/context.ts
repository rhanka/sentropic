/**
 * MCP-L5 Lot 1 — broker context seams.
 *
 * The broker no longer manufactures invocation identity: the in-memory
 * context factory and its options are deleted with no compatibility
 * fallback. Callers supply a verified host `StpConnectorContext` per call.
 * Only the injectable secret-resolver contract remains, as a type.
 */

/** Audited just-in-time secret accessor for a single call. Never logged. */
export type SecretResolver = (name: string) => Promise<string> | string;
