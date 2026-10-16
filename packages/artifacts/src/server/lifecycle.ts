/**
 * L-5c — lifecycle: withdraw/restore/delete/purge, promote/rollback, renew.
 *
 * Part 1: states and the store port. Artifact states run active → withdrawn
 * → active (restore) or → deleted → active (undo) → purged (terminal);
 * releases run active → retired (supplanted) → purged (cascade). `retired`
 * is also derivable (exists but not current); the stored flag lets the
 * Postgres adapter answer without joining the current pointer. Like
 * production (ensureArtifact before any lifecycle step), artifacts register
 * with their owner first. Part 2 adds the service.
 */
export type ArtifactState = 'active' | 'withdrawn' | 'deleted' | 'purged';
export type ReleaseState = 'active' | 'retired' | 'purged';

export interface LifecycleStore {
  register(artifactId: string, ownerId: string): Promise<void>;
  getOwner(artifactId: string): Promise<string | undefined>;
  getArtifactState(artifactId: string): Promise<ArtifactState>;
  setArtifactState(artifactId: string, state: ArtifactState): Promise<void>;
  getRenewedAt(artifactId: string): Promise<string | undefined>;
  setRenewedAt(artifactId: string, renewedAt: string): Promise<void>;
  addRelease(artifactId: string, releaseId: string): Promise<void>;
  listArtifactReleases(artifactId: string): Promise<string[]>;
  getReleaseState(releaseId: string): Promise<ReleaseState>;
  setReleaseState(releaseId: string, state: ReleaseState): Promise<void>;
  getCurrent(artifactId: string): Promise<string | undefined>;
  setCurrent(artifactId: string, releaseId: string): Promise<void>;
}

interface ArtifactEntry {
  ownerId: string;
  state: ArtifactState;
  renewedAt?: string;
  releases: string[];
  current?: string;
}

/** In-memory LifecycleStore double for unit tests (plus a test setup alias). */
export function createMemoryLifecycleStore(): LifecycleStore & {
  setRelease(artifactId: string, releaseId: string): Promise<void>;
} {
  const artifacts = new Map<string, ArtifactEntry>();
  const releaseStates = new Map<string, ReleaseState>();
  const store: LifecycleStore & {
    setRelease(artifactId: string, releaseId: string): Promise<void>;
  } = {
    async register(artifactId: string, ownerId: string): Promise<void> {
      const entry = artifacts.get(artifactId);
      if (entry !== undefined) {
        if (entry.ownerId !== ownerId) throw new Error(`owner mismatch for ${artifactId}`);
        return;
      }
      artifacts.set(artifactId, { ownerId, state: 'active', releases: [] });
    },
    async getOwner(artifactId: string): Promise<string | undefined> {
      return artifacts.get(artifactId)?.ownerId;
    },
    async getArtifactState(artifactId: string): Promise<ArtifactState> {
      return artifacts.get(artifactId)?.state ?? 'active';
    },
    async setArtifactState(artifactId: string, state: ArtifactState): Promise<void> {
      const entry = artifacts.get(artifactId);
      if (entry === undefined) throw new Error(`unknown artifact: ${artifactId}`);
      entry.state = state;
    },
    async getRenewedAt(artifactId: string): Promise<string | undefined> {
      return artifacts.get(artifactId)?.renewedAt;
    },
    async setRenewedAt(artifactId: string, renewedAt: string): Promise<void> {
      const entry = artifacts.get(artifactId);
      if (entry === undefined) throw new Error(`unknown artifact: ${artifactId}`);
      entry.renewedAt = renewedAt;
    },
    async addRelease(artifactId: string, releaseId: string): Promise<void> {
      const entry = artifacts.get(artifactId);
      if (entry === undefined) throw new Error(`unknown artifact: ${artifactId}`);
      if (!entry.releases.includes(releaseId)) entry.releases.push(releaseId);
      if (!releaseStates.has(releaseId)) releaseStates.set(releaseId, 'active');
    },
    async listArtifactReleases(artifactId: string): Promise<string[]> {
      return [...(artifacts.get(artifactId)?.releases ?? [])];
    },
    async getReleaseState(releaseId: string): Promise<ReleaseState> {
      return releaseStates.get(releaseId) ?? 'active';
    },
    async setReleaseState(releaseId: string, state: ReleaseState): Promise<void> {
      releaseStates.set(releaseId, state);
    },
    async getCurrent(artifactId: string): Promise<string | undefined> {
      return artifacts.get(artifactId)?.current;
    },
    async setCurrent(artifactId: string, releaseId: string): Promise<void> {
      const entry = artifacts.get(artifactId);
      if (entry === undefined) throw new Error(`unknown artifact: ${artifactId}`);
      entry.current = releaseId;
    },
    async setRelease(artifactId: string, releaseId: string): Promise<void> {
      await store.addRelease(artifactId, releaseId);
    },
  };
  return store;
}
