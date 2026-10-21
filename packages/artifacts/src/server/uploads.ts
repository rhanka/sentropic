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
  busy: boolean;
  maxSize: number;
  size: number;
}

export interface UploadService {
  begin(input: BeginUploadInput): Promise<{ uploadId: string }>;
  /** Check that the session is open and optionally validate its sequential offset before decoding. */
  remainingBytes(uploadId: string, offset?: number): number;
  append(uploadId: string, offset: number, chunk: Uint8Array): Promise<{ size: number }>;
  /** Validate the commit snapshot before consuming the session; rejected validation remains retryable. */
  commit(uploadId: string, expected: BlobRef, validate?: (bytes: Uint8Array) => void): Promise<BlobRef>;
}

/** Create an upload service over an injected staging store (no S3 imports). */
export function createUploadService(
  staging: StagingStore,
  options: UploadServiceOptions,
  ids: () => string = () => crypto.randomUUID(),
): UploadService {
  if (!Number.isSafeInteger(options.maxUploadBytes) || options.maxUploadBytes < 1) {
    throw new Error('invalid upload byte budget');
  }
  const sessions = new Map<string, Session>();
  function openSession(uploadId: string): Session {
    const session = sessions.get(uploadId);
    if (session === undefined) throw new Error(`unknown upload: ${uploadId}`);
    if (session.committed) throw new Error(`upload already committed: ${uploadId}`);
    if (session.busy) throw new Error(`upload conflict: operation in progress for ${uploadId}`);
    return session;
  }
  async function exclusive<T>(uploadId: string, run: (session: Session) => Promise<T>): Promise<T> {
    const session = openSession(uploadId);
    session.busy = true;
    try {
      return await run(session);
    } finally {
      session.busy = false;
    }
  }
  function remainingBytes(uploadId: string, offset?: number): number {
    const session = openSession(uploadId);
    if (offset !== undefined && (!Number.isSafeInteger(offset) || offset !== session.size)) {
      throw new Error(`upload offset mismatch for ${uploadId}: expected ${session.size}, got ${offset}`);
    }
    return session.maxSize - session.size;
  }
  return {
    remainingBytes,
    async begin(input: BeginUploadInput): Promise<{ uploadId: string }> {
      if (input.maxSize !== undefined && (!Number.isSafeInteger(input.maxSize) || input.maxSize < 1)) {
        throw new Error('invalid upload byte budget');
      }
      const uploadId = ids();
      sessions.set(uploadId, {
        committed: false,
        busy: false,
        maxSize: Math.min(input.maxSize ?? options.maxUploadBytes, options.maxUploadBytes),
        size: 0,
      });
      await staging.write(uploadId, new Uint8Array(0));
      return { uploadId };
    },
    async append(uploadId: string, offset: number, chunk: Uint8Array): Promise<{ size: number }> {
      const remaining = remainingBytes(uploadId, offset);
      return exclusive(uploadId, async (session) => {
        if (chunk.length > remaining) {
          throw new Error(`upload budget exceeded for ${uploadId}: max ${session.maxSize} bytes`);
        }
        const current = await staging.read(uploadId);
        const next = new Uint8Array(current.length + chunk.length);
        next.set(current, 0);
        next.set(chunk, current.length);
        await staging.write(uploadId, next);
        session.size = next.length;
        return { size: session.size };
      });
    },
    async commit(uploadId: string, expected: BlobRef, validate?: (bytes: Uint8Array) => void): Promise<BlobRef> {
      return exclusive(uploadId, async (session) => {
        const bytes = new Uint8Array(await staging.read(uploadId));
        validate?.(bytes);
        if (bytes.length !== expected.size) {
          throw new Error(`upload size mismatch for ${uploadId}: staged ${bytes.length}, declared ${expected.size}`);
        }
        const actual = `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
        if (actual !== expected.digest) {
          throw new Error(`upload digest mismatch for ${uploadId}: staged ${actual}`);
        }
        session.committed = true;
        return { digest: actual, size: bytes.length };
      });
    },
  };
}
