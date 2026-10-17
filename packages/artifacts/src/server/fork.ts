/**
 * L-5c — private forks (spec-v8 §9 5c).
 *
 * A fork creates a private independent artifact under a fresh server UUID:
 * manifest content is copied, the ACL is not (the forker becomes sole
 * owner), blobs stay shared through reference counting, and provenance
 * records the origin release. Forking a deleted or purged artifact is
 * refused; a fork never resurrects its parent and the parent's later
 * lifecycle never disables the fork. Storage is a port; the memory double
 * serves unit tests.
 */
export type ForkableState = 'active' | 'withdrawn' | 'deleted' | 'purged';

export interface ForkRecord {
  artifactId: string;
  ownerId: string;
  releaseId: string;
  manifest: string;
  state: ForkableState;
  readerIds: string[];
  blobDigests: string[];
}

export interface ForkStore {
  get(artifactId: string): Promise<ForkRecord | undefined>;
  put(record: ForkRecord): Promise<void>;
  setState(artifactId: string, state: ForkableState): Promise<void>;
  addRef(digest: string): Promise<void>;
}

export interface ForkService {
  fork(input: { actorId: string; artifactId: string }): Promise<{
    artifactId: string;
    ownerId: string;
    origin: { artifactId: string; releaseId: string };
  }>;
  setState(artifactId: string, state: ForkableState): Promise<void>;
  /** Track a parent record so hosts can sync the source of truth (no-op read). */
  track(record: ForkRecord): Promise<void>;
}

/** In-memory ForkStore double for unit tests (also exposes test readers). */
export function createMemoryForkStore() {
  const records = new Map<string, ForkRecord>();
  const refcounts = new Map<string, number>();
  const store: ForkStore & {
    seed(record: ForkRecord): void;
    refcount(digest: string): number;
    readers(artifactId: string): string[];
  } = {
    seed(record: ForkRecord): void {
      records.set(record.artifactId, { ...record, readerIds: [...record.readerIds] });
      for (const digest of record.blobDigests) {
        refcounts.set(digest, (refcounts.get(digest) ?? 0) + 1);
      }
    },
    refcount(digest: string): number {
      return refcounts.get(digest) ?? 0;
    },
    readers(artifactId: string): string[] {
      return [...(records.get(artifactId)?.readerIds ?? [])];
    },
    get(artifactId: string): Promise<ForkRecord | undefined> {
      return Promise.resolve(records.get(artifactId));
    },
    put(record: ForkRecord): Promise<void> {
      records.set(record.artifactId, record);
      return Promise.resolve();
    },
    setState(artifactId: string, state: ForkableState): Promise<void> {
      const record = records.get(artifactId);
      if (record === undefined) throw new Error(`unknown artifact: ${artifactId}`);
      record.state = state;
      return Promise.resolve();
    },
    addRef(digest: string): Promise<void> {
      refcounts.set(digest, (refcounts.get(digest) ?? 0) + 1);
      return Promise.resolve();
    },
  };
  return store;
}

/** Create a fork service over an injected store (no driver imports). */
export function createForkService(
  store: ForkStore,
  ids: () => string = () => crypto.randomUUID(),
): ForkService {
  return {
    async fork(input: { actorId: string; artifactId: string }) {
      const parent = await store.get(input.artifactId);
      if (parent === undefined) throw new Error(`unknown artifact: ${input.artifactId}`);
      if (parent.state === 'deleted' || parent.state === 'purged') {
        throw new Error(`cannot fork ${parent.state} artifact: ${input.artifactId}`);
      }
      const artifactId = ids();
      await store.put({
        artifactId,
        ownerId: input.actorId,
        releaseId: parent.releaseId,
        manifest: parent.manifest,
        state: 'active',
        readerIds: [],
        blobDigests: [...parent.blobDigests],
      });
      for (const digest of parent.blobDigests) {
        await store.addRef(digest);
      }
      return {
        artifactId,
        ownerId: input.actorId,
        origin: { artifactId: parent.artifactId, releaseId: parent.releaseId },
      };
    },
    async setState(artifactId: string, state: ForkableState): Promise<void> {
      await store.setState(artifactId, state);
    },
    async track(record: ForkRecord): Promise<void> {
      await store.put(record);
    },
  };
}
