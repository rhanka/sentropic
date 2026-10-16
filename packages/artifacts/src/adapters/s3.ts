/**
 * L-5b — S3 adapter: digest-addressed blob store (spec-v8 §9).
 *
 * Implements PublicationBlobStore over an injected S3 client and bucket.
 * Only keys under `artifacts/<scope>/blobs/sha256/<64 hex>` are accepted;
 * anything else (traversal, absolute paths, foreign prefixes, non-hex
 * digests) is refused before any network call. Absent objects read as
 * undefined; listing is prefix-scoped and sorted (orphan enumeration).
 * The client (endpoint, region, credentials, path style) is built by the
 * host and injected — this module never reads env or creates connections.
 */
import {
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  type S3Client,
} from '@aws-sdk/client-s3';
import type { PublicationBlobStore } from '../server/publication.js';

const BLOB_KEY_PATTERN = /^artifacts\/[A-Za-z0-9_-]+\/blobs\/sha256\/[0-9a-f]{64}$/;

export interface S3BlobStoreOptions {
  client: S3Client;
  bucket: string;
}

/** Reject anything but digest-addressed blob keys, before any I/O. */
function assertBlobKey(key: string): void {
  if (!BLOB_KEY_PATTERN.test(key)) {
    throw new Error(`invalid blob key (must be artifacts/<scope>/blobs/sha256/<hex>): ${key}`);
  }
}

/** Reject empty or escaping prefixes before any I/O. */
function assertPrefix(prefix: string): void {
  if (prefix.length === 0 || prefix.includes('..')) {
    throw new Error(`invalid blob prefix: ${prefix}`);
  }
}

/** Create an S3-backed blob store over an injected client (no env reads). */
export function createS3BlobStore(options: S3BlobStoreOptions): PublicationBlobStore {
  return {
    async putBlob(key: string, bytes: Uint8Array): Promise<void> {
      assertBlobKey(key);
      await options.client.send(
        new PutObjectCommand({ Bucket: options.bucket, Key: key, Body: bytes }),
      );
    },
    async getBlob(key: string): Promise<Uint8Array | undefined> {
      assertBlobKey(key);
      try {
        const out = await options.client.send(
          new GetObjectCommand({ Bucket: options.bucket, Key: key }),
        );
        if (out.Body === undefined) return undefined;
        const collected = await out.Body.transformToByteArray();
        return new Uint8Array(collected);
      } catch (error) {
        if (typeof error === 'object' && error !== null && 'name' in error) {
          const name = (error as { name?: unknown }).name;
          if (name === 'NoSuchKey' || name === 'NotFound') return undefined;
        }
        throw error;
      }
    },
    async listKeys(prefix: string): Promise<string[]> {
      assertPrefix(prefix);
      const keys: string[] = [];
      let token: string | undefined;
      do {
        const out = await options.client.send(
          new ListObjectsV2Command({ Bucket: options.bucket, Prefix: prefix, ContinuationToken: token }),
        );
        for (const entry of out.Contents ?? []) {
          if (entry.Key !== undefined) keys.push(entry.Key);
        }
        token = out.IsTruncated === true ? out.NextContinuationToken : undefined;
      } while (token !== undefined);
      return keys.sort();
    },
  };
}
