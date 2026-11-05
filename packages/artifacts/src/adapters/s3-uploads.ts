/**
 * Files parity LOT 1 — S3 adapter for upload staging + presigned PUT signer.
 *
 * StagingStore over an injected S3 client and bucket: only keys under
 * `artifacts/<scope>/staging/<uuid>` are accepted (assertStagingKey/assertStagingPrefix
 * refuse anything else before any network call), mirroring adapters/s3.ts.
 *
 * UploadSignerPort over `@aws-sdk/s3-request-presigner`: the signature binds
 * content-type and the EXACT Content-Length (a SigV4 presigned PUT cannot
 * carry a content-length range — review finding 3), and nothing else. No
 * checksum header is signed or announced: the digest is declared at commit
 * and strict S3 implementations (OVH) refuse presigned PUTs carrying unsigned
 * `x-amz-*` headers. The returned headers are exactly the signed set. The
 * client (endpoint, region, credentials, path style) is built by the host and
 * injected — this module never reads env or connects.
 */
import {
  DeleteObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  type S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import {
  assertStagingKey,
  assertStagingPrefix,
  type StagingStore,
  type UploadSignerPort,
} from '../server/uploads.js';

export interface S3StagingStoreOptions {
  client: S3Client;
  bucket: string;
}

/** Create an S3-backed staging store over an injected client (no env reads). */
export function createS3StagingStore(options: S3StagingStoreOptions): StagingStore {
  return {
    async put(key: string, bytes: Uint8Array): Promise<void> {
      assertStagingKey(key);
      await options.client.send(
        new PutObjectCommand({ Bucket: options.bucket, Key: key, Body: bytes }),
      );
    },
    async get(key: string): Promise<Uint8Array | undefined> {
      assertStagingKey(key);
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
    async delete(key: string): Promise<void> {
      assertStagingKey(key);
      await options.client.send(new DeleteObjectCommand({ Bucket: options.bucket, Key: key }));
    },
    async listKeys(prefix: string): Promise<string[]> {
      assertStagingPrefix(prefix);
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

export interface S3UploadSignerOptions {
  client: S3Client;
  bucket: string;
}

/**
 * Create a presigned-PUT signer over an injected client. The signature binds
 * content-type + exact content-length (declared size) and nothing else; the
 * returned headers are exactly the signed set (no `x-amz-*` header).
 */
export function createS3UploadSigner(options: S3UploadSignerOptions): UploadSignerPort {
  return {
    async signPut(input) {
      assertStagingKey(input.key);
      if (!Number.isSafeInteger(input.contentLength) || input.contentLength < 0) {
        throw new Error('invalid signed content-length');
      }
      const command = new PutObjectCommand({
        Bucket: options.bucket,
        Key: input.key,
        ContentType: input.contentType,
        ContentLength: input.contentLength,
      });
      const url = await getSignedUrl(options.client, command, {
        expiresIn: input.expiresInSeconds,
      });
      return {
        url,
        method: 'PUT',
        headers: {
          'content-type': input.contentType,
          'content-length': String(input.contentLength),
        },
        expiresAt: new Date(Date.now() + input.expiresInSeconds * 1000).toISOString(),
      };
    },
  };
}
