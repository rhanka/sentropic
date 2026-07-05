/**
 * ArtifactStorePort — object/artifact physical plane (SPEC_EVOL_DATA_ARCHITECTURE §3.5,
 * Axis E). A backend-neutral seam over binary artifact storage. The default binding wraps
 * `storage-s3.ts` (any S3-compatible endpoint); a local-FS binding serves dev/self-host.
 * The port adds checksum + metadata on top of the raw S3 calls. Multi-version retention
 * (S3 VersionId pass-through, get-by-version) is deferred to a follow-up — see BRANCH.md.
 */

/** Location of an artifact: a namespace (bucket) + a key (path within it). */
export interface ArtifactRef {
  bucket: string;
  key: string;
}

/** Metadata describing a stored artifact. */
export interface ArtifactMetadata {
  contentType?: string;
  /** Size in bytes. */
  contentLength?: number;
  /** Lowercase hex SHA-256 of the stored bytes (when known to the backend). */
  checksum?: string;
  /** Last modification time, when the backend reports it. */
  lastModified?: Date;
}

/** Input for a put operation. */
export interface PutArtifactInput extends ArtifactRef {
  body: Uint8Array | Buffer;
  contentType?: string;
  /**
   * Optional caller-supplied checksum (lowercase hex SHA-256). When present, the store
   * verifies the computed checksum matches before persisting and throws on mismatch.
   */
  expectedChecksum?: string;
}

/** Result of a successful put. */
export interface PutArtifactResult {
  ref: ArtifactRef;
  /** Lowercase hex SHA-256 computed over the written bytes. */
  checksum: string;
  /** Size in bytes written. */
  size: number;
}

/**
 * Backend-neutral artifact storage port. Implementations: `S3ArtifactStore` (prod/test,
 * wraps storage-s3) and `LocalFsArtifactStore` (dev/self-host).
 */
export interface ArtifactStorePort {
  /** Write bytes; computes + returns the SHA-256 checksum and size. */
  put(input: PutArtifactInput): Promise<PutArtifactResult>;
  /** Read the full object as bytes. */
  getBytes(ref: ArtifactRef): Promise<Uint8Array>;
  /** Read the object as a Web ReadableStream (for streaming responses). */
  getStream(ref: ArtifactRef): Promise<ReadableStream<Uint8Array>>;
  /** Fetch metadata without downloading the body. */
  head(ref: ArtifactRef): Promise<ArtifactMetadata>;
  /** Delete the object (idempotent: deleting a missing key resolves). */
  delete(ref: ArtifactRef): Promise<void>;
  /** The default namespace for app documents (today: DOC_STORAGE_BUCKET). */
  defaultBucket(): string;
}

/** Thrown when a requested artifact does not exist. */
export class ArtifactNotFoundError extends Error {
  constructor(public readonly ref: ArtifactRef) {
    super(`Artifact not found: ${ref.bucket}/${ref.key}`);
    this.name = 'ArtifactNotFoundError';
  }
}

/** Thrown when `expectedChecksum` does not match the computed checksum on put. */
export class ArtifactChecksumMismatchError extends Error {
  constructor(
    public readonly expected: string,
    public readonly actual: string
  ) {
    super(`Artifact checksum mismatch: expected ${expected}, got ${actual}`);
    this.name = 'ArtifactChecksumMismatchError';
  }
}
