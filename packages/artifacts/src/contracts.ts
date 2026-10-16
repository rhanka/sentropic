/**
 * L-5a — artifact domain contracts (spec-v8 §9).
 *
 * Generic, host-independent state: StorageScope, Artifact, Binding, Release,
 * File/BlobRef, Source, ACL, hostname reservation, Upload, BlobPin,
 * ObjectIntent and operation idempotency. Schema types are independent of
 * ORM rows; no server, driver or cluster-mesh imports; no eager storage
 * connections or DDL on import. Identities are server-allocated UUIDs.
 */

export const ARTIFACT_SCHEMA_VERSIONS = ['artifacts/v1'] as const;

export type ArtifactSchemaVersion = (typeof ARTIFACT_SCHEMA_VERSIONS)[number];

/** Refuse unknown schema versions (fail-closed on version skew). */
export function assertKnownSchemaVersion(version: unknown): asserts version is ArtifactSchemaVersion {
  if (!ARTIFACT_SCHEMA_VERSIONS.includes(version as ArtifactSchemaVersion)) {
    throw new Error(`unknown artifact schema version: ${String(version)}`);
  }
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** True for server-allocated UUID identities. */
export function isArtifactId(value: unknown): value is string {
  return typeof value === 'string' && UUID_PATTERN.test(value);
}

/** Allocate a server-side identity (UUID v4). */
export function createArtifactId(): string {
  return crypto.randomUUID();
}

/** Opaque storage scope isolating physical keys from org reindexing. */
export interface StorageScope {
  readonly storageScopeId: string;
  readonly createdAt: string;
}

/** An artifact: one logical view across releases. */
export interface Artifact {
  readonly id: string;
  readonly schemaVersion: ArtifactSchemaVersion;
  readonly storageScopeId: string;
  readonly ownerId: string;
  readonly createdAt: string;
  readonly deletedAt?: string;
}

/** A stable owner-scoped binding resolving to one artifact. */
export interface Binding {
  readonly binding: string;
  readonly artifactId: string;
  readonly ownerId: string;
}

/** An immutable release of an artifact's manifest + bytes. */
export interface Release {
  readonly id: string;
  readonly artifactId: string;
  readonly manifestDigest: string;
  readonly createdAt: string;
  readonly state: 'pending' | 'ready' | 'withdrawn' | 'purged';
}

/** A content blob referenced by digest. */
export interface BlobRef {
  readonly digest: string;
  readonly size: number;
  readonly mimeType: string;
}

/** Provenance of a release's sources. */
export type ArtifactSource =
  | { readonly kind: 'inline-original' }
  | { readonly kind: 'recipe'; readonly baseCommit: string; readonly recipe: string };

/** Object-level access grant. */
export interface AccessGrant {
  readonly artifactId: string;
  readonly subjectId: string;
  readonly rights: readonly ('read' | 'source-export' | 'write')[];
}

/** A bounded upload session staging bytes before commit. */
export interface Upload {
  readonly id: string;
  readonly artifactId: string;
  readonly prefix: string;
  readonly createdAt: string;
  readonly state: 'open' | 'committed' | 'aborted';
}

/** A pin retaining a blob against concurrent GC. */
export interface BlobPin {
  readonly digest: string;
  readonly artifactId: string;
  readonly reason: 'release' | 'fork' | 'upload';
}

/** Recorded intent before every external object operation. */
export interface ObjectIntent {
  readonly idempotencyKey: string;
  readonly artifactId: string;
  readonly operation: string;
  readonly recordedAt: string;
  readonly state: 'recorded' | 'applied' | 'failed';
}
