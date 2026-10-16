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
import type { JsonValue } from '../contracts.js';

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
