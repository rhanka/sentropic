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
  DeleteObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  type S3Client,
} from '@aws-sdk/client-s3';
import type { BlobKeyPage, BlobKeyPageResult, PublicationBlobStore } from '../server/publication.js';
import { assertBlobPrefix } from '../server/blob-prefix.js';
import { cloneBlobBytes, verifyBytesForKey, verifyStoredBytesForKey } from '../server/blob-bridge.js';

/** Per-call fetch cap: one page never materializes more than this (S3 MaxKeys bound). */
const PAGE_FETCH_CAP = 1000;

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

/** Create an S3-backed blob store over an injected client (no env reads). */
export function createS3BlobStore(options: S3BlobStoreOptions): PublicationBlobStore {
  const store: PublicationBlobStore = {
    async putBlob(key: string, bytes: Uint8Array): Promise<void> {
      // CR-1: clone before verification, then verify before any I/O.
      const snapshot = cloneBlobBytes(bytes);
      verifyBytesForKey(key, snapshot);
      try {
        await options.client.send(
          new PutObjectCommand({ Bucket: options.bucket, Key: key, Body: snapshot, IfNoneMatch: '*' }),
        );
      } catch (error) {
        // Create-only: the key already exists. Settle by read-back — identical
        // bytes are idempotent (verified digest match), different bytes fail
        // closed without overwrite.
        if (typeof error === 'object' && error !== null && 'name' in error &&
          (error as { name?: unknown }).name === 'PreconditionFailed') {
          const stored = await store.getBlob(key);
          if (stored !== undefined) {
            verifyStoredBytesForKey(key, stored);
            return;
          }
        }
        throw error;
      }
      const stored = await store.getBlob(key);
      if (stored === undefined) throw new Error(`blob missing after write: ${key}`);
      verifyStoredBytesForKey(key, stored);
    },
    async getBlob(key: string): Promise<Uint8Array | undefined> {
      assertBlobKey(key);
      try {
        const out = await options.client.send(
          new GetObjectCommand({ Bucket: options.bucket, Key: key }),
        );
        if (out.Body === undefined) return undefined;
        const collected = await out.Body.transformToByteArray();
        // CR-2: digest and length verified before serving bytes as verified.
        return verifyStoredBytesForKey(key, new Uint8Array(collected));
      } catch (error) {
        if (typeof error === 'object' && error !== null && 'name' in error) {
          const name = (error as { name?: unknown }).name;
          if (name === 'NoSuchKey' || name === 'NotFound') return undefined;
        }
        throw error;
      }
    },
    async getBlobRange(key: string, start: number, endInclusive: number): Promise<Uint8Array | undefined> {
      assertBlobKey(key);
      if (!Number.isSafeInteger(start) || !Number.isSafeInteger(endInclusive) || start < 0 ||
        endInclusive < start) {
        return undefined;
      }
      try {
        const out = await options.client.send(
          new GetObjectCommand({ Bucket: options.bucket, Key: key,
            Range: `bytes=${start}-${endInclusive}` }),
        );
        if (out.Body === undefined) return undefined;
        const collected = await out.Body.transformToByteArray();
        return new Uint8Array(collected);
      } catch (error) {
        if (typeof error === 'object' && error !== null && 'name' in error) {
          const name = (error as { name?: unknown }).name;
          if (name === 'NoSuchKey' || name === 'NotFound' || name === 'InvalidRange') return undefined;
        }
        throw error;
      }
    },
    async listKeys(prefix: string): Promise<string[]> {
      assertBlobPrefix(prefix);
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
    async deleteBlob(key: string): Promise<void> {
      assertBlobKey(key);
      await options.client.send(new DeleteObjectCommand({ Bucket: options.bucket, Key: key }));
    },
    async listKeysPaged(prefix: string, page: BlobKeyPage): Promise<BlobKeyPageResult> {
      assertBlobPrefix(prefix);
      if (!Number.isSafeInteger(page.maxItems) || page.maxItems < 1) throw new Error('invalid blob page maxItems');
      if (page.startAfter !== undefined) {
        if (!page.startAfter.startsWith(prefix)) {
          throw new Error(`invalid blob page resume key: ${page.startAfter}`);
        }
        assertBlobKey(page.startAfter);
      }
      // Keyset resume: one bounded ListObjectsV2 from the resume key (no
      // full-prefix load). The caller replays byte-trimmed tails by key.
      const maxKeys = Math.min(page.maxItems + 1, PAGE_FETCH_CAP);
      const out = await options.client.send(
        new ListObjectsV2Command({ Bucket: options.bucket, Prefix: prefix,
          StartAfter: page.startAfter ?? prefix, MaxKeys: maxKeys }),
      );
      const keys = (out.Contents ?? []).flatMap((entry) => entry.Key === undefined ? [] : [entry.Key])
        .filter((key) => key.startsWith(prefix))
        .sort();
      return {
        keys: keys.slice(0, page.maxItems),
        hasMore: out.IsTruncated === true || keys.length > page.maxItems,
      };
    },
  };
  return store;
}
