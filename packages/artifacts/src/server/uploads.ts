/**
 * L-5b — bounded uploads (spec-v8 §9).
 *
 * Uploads stage bytes under a bounded prefix with a strict size budget and
 * sequential offsets. Commit verifies the staged bytes against the declared
 * SHA-256 digest and size before returning a blob reference; false
 * hashes/sizes, over-budget appends, out-of-order offsets and any write
 * after commit are refused fail-closed. Staging is ephemeral: sessions live
 * in memory and never become visible releases (publication owns durability
 * via object intents). The byte store is injected; the memory double serves
 * unit tests and the S3 adapter serves the L-5b integration proof.
 */
import { createHash } from 'node:crypto';

export interface BlobRef {
  digest: string;
  size: number;
}

export interface StagingStore {
  write(uploadId: string, bytes: Uint8Array): Promise<void>;
  read(uploadId: string): Promise<Uint8Array>;
  discard(uploadId: string): Promise<void>;
}

/** In-memory StagingStore double for unit tests. */
export function createMemoryStaging(): StagingStore {
  const staged = new Map<string, Uint8Array>();
  return {
    write(uploadId: string, bytes: Uint8Array): Promise<void> {
      staged.set(uploadId, bytes);
      return Promise.resolve();
    },
    read(uploadId: string): Promise<Uint8Array> {
      const bytes = staged.get(uploadId);
      if (bytes === undefined) throw new Error(`unknown upload: ${uploadId}`);
      return Promise.resolve(bytes);
    },
    discard(uploadId: string): Promise<void> {
      staged.delete(uploadId);
      return Promise.resolve();
    },
  };
}

export interface BeginUploadInput {
  mimeType: string;
  maxSize?: number;
}

export interface UploadServiceOptions {
  maxUploadBytes: number;
}

interface Session {
  committed: boolean;
  maxSize: number;
  size: number;
}

export interface UploadService {
  begin(input: BeginUploadInput): Promise<{ uploadId: string }>;
  append(uploadId: string, offset: number, chunk: Uint8Array): Promise<{ size: number }>;
  commit(uploadId: string, expected: BlobRef): Promise<BlobRef>;
}

/** Create an upload service over an injected staging store (no S3 imports). */
export function createUploadService(
  staging: StagingStore,
  options: UploadServiceOptions,
  ids: () => string = () => crypto.randomUUID(),
): UploadService {
  const sessions = new Map<string, Session>();
  return {
    async begin(input: BeginUploadInput): Promise<{ uploadId: string }> {
      const uploadId = ids();
      sessions.set(uploadId, {
        committed: false,
        maxSize: input.maxSize ?? options.maxUploadBytes,
        size: 0,
      });
      await staging.write(uploadId, new Uint8Array(0));
      return { uploadId };
    },
    async append(uploadId: string, offset: number, chunk: Uint8Array): Promise<{ size: number }> {
      const session = sessions.get(uploadId);
      if (session === undefined) throw new Error(`unknown upload: ${uploadId}`);
      if (session.committed) throw new Error(`upload already committed: ${uploadId}`);
      if (offset !== session.size) {
        throw new Error(`upload offset mismatch for ${uploadId}: expected ${session.size}, got ${offset}`);
      }
      if (session.size + chunk.length > session.maxSize) {
        throw new Error(`upload budget exceeded for ${uploadId}: max ${session.maxSize} bytes`);
      }
      const current = await staging.read(uploadId);
      const next = new Uint8Array(current.length + chunk.length);
      next.set(current, 0);
      next.set(chunk, current.length);
      await staging.write(uploadId, next);
      session.size = next.length;
      return { size: session.size };
    },
    async commit(uploadId: string, expected: BlobRef): Promise<BlobRef> {
      const session = sessions.get(uploadId);
      if (session === undefined) throw new Error(`unknown upload: ${uploadId}`);
      if (session.committed) throw new Error(`upload already committed: ${uploadId}`);
      const bytes = await staging.read(uploadId);
      if (bytes.length !== expected.size) {
        throw new Error(`upload size mismatch for ${uploadId}: staged ${bytes.length}, declared ${expected.size}`);
      }
      const actual = `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
      if (actual !== expected.digest) {
        throw new Error(`upload digest mismatch for ${uploadId}: staged ${actual}`);
      }
      session.committed = true;
      return { digest: actual, size: bytes.length };
    },
  };
}
