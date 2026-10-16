/**
 * L-5b — publication with intents-first commit (spec-v8 §9).
 *
 * Every commit records a `commit-release` intent before any external object
 * operation, writes blobs under digest-addressed keys, verifies final bytes
 * by read-back (digest first, then size) before the release is marked ready,
 * and CAS-promotes the current pointer. A failed step leaves the intent
 * pending and nothing visible; a lost CAS race is an explicit conflict (the
 * loser's blobs stay addressable orphans for L-5c GC, never a visible
 * release). Repeating a request with the same idempotency key returns the
 * one stored release. State and blob stores are ports; the memory doubles
 * serve unit tests and the Postgres/S3 adapters serve integration.
 */
import { createHash } from 'node:crypto';
import { canonicalManifest, manifestDigest } from '../codecs.js';
import type { JsonValue } from '../contracts.js';
import type { IntentStore } from './object-intents.js';
import type { IdempotencyStore } from './idempotency.js';

export interface ReleaseRecord {
  releaseId: string;
  artifactId: string;
  manifestDigest: string;
  manifest: string;
  state: 'ready';
  createdAt: string;
}

export interface PublicationStateStore {
  putRelease(release: ReleaseRecord): Promise<void>;
  getRelease(releaseId: string): Promise<ReleaseRecord | undefined>;
  getCurrentReleaseId(artifactId: string): Promise<string | undefined>;
  compareAndSwapCurrent(artifactId: string, expected: string | null, next: string): Promise<boolean>;
}

export interface PublicationBlobStore {
  putBlob(key: string, bytes: Uint8Array): Promise<void>;
  getBlob(key: string): Promise<Uint8Array | undefined>;
}

/** In-memory state-store double for unit tests (synchronous CAS). */
export function createMemoryStateStore(): PublicationStateStore {
  const releases = new Map<string, ReleaseRecord>();
  const current = new Map<string, string>();
  return {
    putRelease(release: ReleaseRecord): Promise<void> {
      releases.set(release.releaseId, release);
      return Promise.resolve();
    },
    getRelease(releaseId: string): Promise<ReleaseRecord | undefined> {
      return Promise.resolve(releases.get(releaseId));
    },
    getCurrentReleaseId(artifactId: string): Promise<string | undefined> {
      return Promise.resolve(current.get(artifactId));
    },
    compareAndSwapCurrent(artifactId: string, expected: string | null, next: string): Promise<boolean> {
      const actual = current.get(artifactId) ?? null;
      if (actual !== expected) return Promise.resolve(false);
      current.set(artifactId, next);
      return Promise.resolve(true);
    },
  };
}

/** In-memory blob-store double for unit tests. */
export function createMemoryBlobStore(): PublicationBlobStore {
  const blobs = new Map<string, Uint8Array>();
  const store: PublicationBlobStore = {
    putBlob(key: string, bytes: Uint8Array): Promise<void> {
      blobs.set(key, bytes);
      return Promise.resolve();
    },
    getBlob(key: string): Promise<Uint8Array | undefined> {
      return Promise.resolve(blobs.get(key));
    },
  };
  return store;
}

export interface PublicationFileInput {
  path: string;
  mimeType: string;
  bytes: Uint8Array;
}

export interface PublishInput {
  ownerId: string;
  storageScopeId: string;
  artifactId: string;
  profile: Record<string, JsonValue | undefined>;
  files: PublicationFileInput[];
  idempotencyKey?: string;
  paramsHash?: string;
}

export interface PublishResult {
  releaseId: string;
  manifest: string;
}

function shaHex(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

export interface PublicationService {
  publish(input: PublishInput): Promise<PublishResult>;
  getCurrent(artifactId: string): Promise<{ releaseId: string; manifest: string } | undefined>;
}

/** Create a publication service over injected stores (no driver imports). */
export function createPublicationService(deps: {
  state: PublicationStateStore;
  blobs: PublicationBlobStore;
  intents: IntentStore;
  idempotency?: IdempotencyStore;
}): PublicationService {
  async function commitOnce(input: PublishInput): Promise<PublishResult> {
    const releaseId = crypto.randomUUID();
    const entries = input.files.map((file) => {
      const hex = shaHex(file.bytes);
      return {
        entry: { path: file.path, digest: `sha256:${hex}`, size: file.bytes.length, mimeType: file.mimeType },
        key: `artifacts/${input.storageScopeId}/blobs/sha256/${hex}`,
        bytes: file.bytes,
      };
    });
    const body = {
      schemaVersion: 'artifacts/v1',
      artifactId: input.artifactId,
      storageScopeId: input.storageScopeId,
      ownerId: input.ownerId,
      profile: input.profile,
      files: entries.map((e) => e.entry),
    };
    const digest = manifestDigest(body);
    const manifest = canonicalManifest({ ...body, digest });
    const intent = await deps.intents.record('commit-release', {
      artifactId: input.artifactId,
      releaseId,
      manifestDigest: digest,
      blobKeys: entries.map((e) => e.key),
    });
    for (const { key, bytes } of entries) {
      await deps.blobs.putBlob(key, bytes);
    }
    for (const { key, bytes } of entries) {
      const stored = await deps.blobs.getBlob(key);
      if (stored === undefined || shaHex(stored) !== shaHex(bytes)) {
        throw new Error(`publication digest mismatch for ${key}: read-back failed`);
      }
      if (stored.length !== bytes.length) {
        throw new Error(`publication size mismatch for ${key}: read-back failed`);
      }
    }
    await deps.state.putRelease({
      releaseId,
      artifactId: input.artifactId,
      manifestDigest: digest,
      manifest,
      state: 'ready',
      createdAt: new Date().toISOString(),
    });
    const expected = (await deps.state.getCurrentReleaseId(input.artifactId)) ?? null;
    const won = await deps.state.compareAndSwapCurrent(input.artifactId, expected, releaseId);
    if (!won) {
      await deps.intents.markFailed(intent.intentId, 'commit race lost: explicit conflict');
      throw new Error(`publication conflict for ${input.artifactId}: concurrent commit won`);
    }
    await deps.intents.complete(intent.intentId);
    return { releaseId, manifest };
  }

  return {
    async publish(input: PublishInput): Promise<PublishResult> {
      if (input.idempotencyKey !== undefined && deps.idempotency !== undefined) {
        const { result } = await deps.idempotency.execute(
          input.idempotencyKey,
          input.paramsHash ?? '',
          () => commitOnce(input),
        );
        return result;
      }
      return commitOnce(input);
    },
    async getCurrent(artifactId: string): Promise<{ releaseId: string; manifest: string } | undefined> {
      const releaseId = await deps.state.getCurrentReleaseId(artifactId);
      if (releaseId === undefined) return undefined;
      const release = await deps.state.getRelease(releaseId);
      if (release === undefined) return undefined;
      return { releaseId: release.releaseId, manifest: release.manifest };
    },
  };
}
