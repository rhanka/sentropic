/**
 * CMF-S1/CMF-S2 — structural object/blob bridge contract (MODULE_STORAGE).
 *
 * Neutral serialization of digest-addressed blobs: caller buffer cloned
 * before verification, sha256-of-bytes against the key digest before any I/O,
 * create-only writes, digest-verified reads, bounded pages with opaque
 * scope-bound integrity-protected continuations (CR-1/CR-2/CR-4), maintain
 * right for deletes (CR-5). Implemented by `@sentropic/artifacts`
 * (`composite-blob`, `db-blob`, `s3`, `local-blob`, `sqlite-blob`) and
 * consumed structurally — no runtime dependency from this package to
 * `@sentropic/artifacts`.
 */
import type { CommonBoundedPage } from './common-contract.js';

export type BlobKey = string;

export interface BoundedBlobKeys {
  readonly keys: BlobKey[];
  readonly continuation?: string;
}

export interface MaintainGrant {
  readonly scope: string;
  readonly reason: string;
}

export interface ArtifactBlobPort {
  putBlob(key: BlobKey, bytes: Uint8Array): Promise<{ created: boolean } | void>;
  getBlob(key: BlobKey): Promise<Uint8Array | undefined>;
  getBlobRange?(key: BlobKey, start: number, endInclusive: number): Promise<Uint8Array | undefined>;
  headBlob(key: BlobKey): Promise<{ bytes: number } | undefined>;
  listKeys(prefix: string, page: CommonBoundedPage): Promise<BoundedBlobKeys>;
  deleteBlob(key: BlobKey, grant: MaintainGrant): Promise<void>;
}

export interface ObjectBindingRef {
  readonly bindingId: string;
  readonly bucket: string;
  readonly qualificationRef: string;
}

export type ArtifactBlobPlacement =
  | { readonly mode: 'db' }
  | { readonly mode: 's3'; readonly object: ObjectBindingRef }
  | { readonly mode: 'db+s3'; readonly inlineMaxBytes: number; readonly object: ObjectBindingRef };
