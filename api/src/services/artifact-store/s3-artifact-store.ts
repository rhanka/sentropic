import {
  deleteObject,
  getDocumentsBucketName,
  getObjectBodyStream,
  getObjectBytes,
  headObject,
  putObject,
} from '../storage-s3';
import { sha256Hex } from './checksum';
import type {
  ArtifactMetadata,
  ArtifactRef,
  ArtifactStorePort,
  PutArtifactInput,
  PutArtifactResult,
} from './port';
import { ArtifactChecksumMismatchError, ArtifactNotFoundError } from './port';

// S3 lowercases user metadata keys; keep ours lowercase so head() reads it back verbatim.
const CHECKSUM_METADATA_KEY = 'sha256';

/**
 * S3-compatible binding of {@link ArtifactStorePort}. Delegates raw transfer to
 * `storage-s3.ts` (preserving its MinIO auto-bucket-create behaviour) and layers
 * SHA-256 checksum persistence + retrieval on top.
 */
export class S3ArtifactStore implements ArtifactStorePort {
  async put(input: PutArtifactInput): Promise<PutArtifactResult> {
    const checksum = sha256Hex(input.body);
    if (input.expectedChecksum && input.expectedChecksum !== checksum) {
      throw new ArtifactChecksumMismatchError(input.expectedChecksum, checksum);
    }
    await putObject({
      bucket: input.bucket,
      key: input.key,
      body: input.body,
      contentType: input.contentType,
      metadata: { [CHECKSUM_METADATA_KEY]: checksum },
    });
    return {
      ref: { bucket: input.bucket, key: input.key },
      checksum,
      size: input.body.byteLength,
    };
  }

  async getBytes(ref: ArtifactRef): Promise<Uint8Array> {
    return getObjectBytes(ref).catch((err) => {
      throw asNotFound(err, ref);
    });
  }

  async getStream(ref: ArtifactRef): Promise<ReadableStream<Uint8Array>> {
    return getObjectBodyStream(ref).catch((err) => {
      throw asNotFound(err, ref);
    });
  }

  async head(ref: ArtifactRef): Promise<ArtifactMetadata> {
    const res = await headObject(ref).catch((err) => {
      throw asNotFound(err, ref);
    });
    return {
      contentType: res.contentType,
      contentLength: res.contentLength,
      checksum: res.metadata?.[CHECKSUM_METADATA_KEY],
    };
  }

  async delete(ref: ArtifactRef): Promise<void> {
    await deleteObject(ref);
  }

  defaultBucket(): string {
    return getDocumentsBucketName();
  }
}

/** Map S3 "missing object" errors to the port's {@link ArtifactNotFoundError}. */
function asNotFound(err: unknown, ref: ArtifactRef): Error {
  const e = err as { name?: string; Code?: string; $metadata?: { httpStatusCode?: number } };
  const code = e?.name || e?.Code;
  if (
    code === 'NoSuchKey' ||
    code === 'NotFound' ||
    code === 'NoSuchBucket' ||
    e?.$metadata?.httpStatusCode === 404
  ) {
    return new ArtifactNotFoundError(ref);
  }
  return err as Error;
}
