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
import { assertArtifactAccess } from './authorization.js';
import { evaluateAccess, type AccessAction, type ArtifactAcl } from './access.js';

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

export interface LifecycleService {
  stateOf(artifactId: string): Promise<ArtifactState>;
  canRead(
    artifact: { artifactId: string; state: ArtifactState },
    acl: ArtifactAcl,
    actorId: string,
    action?: AccessAction,
    isApproved?: (principalId: string) => boolean,
  ): boolean;
  withdraw(artifactId: string, actorId: string): Promise<void>;
  restore(artifactId: string, actorId: string): Promise<void>;
  deleteArtifact(artifactId: string, actorId: string): Promise<void>;
  purge(
    artifactId: string,
    actorId: string,
    blobDigests: string[],
  ): Promise<{ artifactId: string; purgedReleases: string[]; blobDigests: string[] }>;
  promote(
    artifactId: string,
    actorId: string,
    releaseId: string,
    expectedCurrent: string,
  ): Promise<{ releaseId: string }>;
  renew(artifactId: string, actorId: string): Promise<{ renewedAt: string }>;
}

/** Create a lifecycle service over an injected store (mutations owner-only). */
export function createLifecycleService(
  store: LifecycleStore,
  clock: () => string = () => new Date().toISOString(),
): LifecycleService {
  async function ownerOf(artifactId: string): Promise<string> {
    const owner = await store.getOwner(artifactId);
    if (owner === undefined) throw new Error(`unknown artifact: ${artifactId}`);
    return owner;
  }

  async function assertOwner(artifactId: string, actorId: string): Promise<void> {
    assertArtifactAccess({ actorUserId: actorId, artifactOwnerId: await ownerOf(artifactId), action: 'mutate' });
  }

  return {
    async stateOf(artifactId: string): Promise<ArtifactState> {
      return store.getArtifactState(artifactId);
    },
    canRead(
      artifact: { artifactId: string; state: ArtifactState },
      acl: ArtifactAcl,
      actorId: string,
      action: AccessAction = 'read',
      isApproved: (principalId: string) => boolean = () => false,
    ): boolean {
      if (artifact.state === 'deleted' || artifact.state === 'purged') return false;
      if (artifact.state === 'withdrawn') return actorId === acl.ownerId;
      return evaluateAccess(acl, actorId, action, isApproved);
    },
    async withdraw(artifactId: string, actorId: string): Promise<void> {
      await assertOwner(artifactId, actorId);
      const state = await store.getArtifactState(artifactId);
      if (state === 'purged') throw new Error(`cannot withdraw purged artifact: terminal ${artifactId}`);
      if (state === 'deleted') throw new Error(`cannot withdraw deleted artifact: ${artifactId}`);
      if (state === 'withdrawn') throw new Error(`already withdrawn: ${artifactId}`);
      await store.setArtifactState(artifactId, 'withdrawn');
    },
    async restore(artifactId: string, actorId: string): Promise<void> {
      await assertOwner(artifactId, actorId);
      const state = await store.getArtifactState(artifactId);
      if (state === 'purged') throw new Error(`cannot restore purged artifact: terminal ${artifactId}`);
      if (state === 'active') throw new Error(`already active: ${artifactId}`);
      await store.setArtifactState(artifactId, 'active');
    },
    async deleteArtifact(artifactId: string, actorId: string): Promise<void> {
      await assertOwner(artifactId, actorId);
      const state = await store.getArtifactState(artifactId);
      if (state === 'purged') throw new Error(`cannot delete purged artifact: terminal ${artifactId}`);
      if (state === 'deleted') throw new Error(`already deleted: ${artifactId}`);
      await store.setArtifactState(artifactId, 'deleted');
    },
    async purge(artifactId: string, actorId: string, blobDigests: string[]) {
      await assertOwner(artifactId, actorId);
      const state = await store.getArtifactState(artifactId);
      if (state !== 'deleted') {
        throw new Error(`can only purge a deleted artifact: ${artifactId} is ${state}`);
      }
      const releases = await store.listArtifactReleases(artifactId);
      for (const releaseId of releases) {
        await store.setReleaseState(releaseId, 'purged');
      }
      await store.setArtifactState(artifactId, 'purged');
      return { artifactId, purgedReleases: releases, blobDigests: [...blobDigests] };
    },
    async promote(artifactId: string, actorId: string, releaseId: string, expectedCurrent: string) {
      await assertOwner(artifactId, actorId);
      const state = await store.getArtifactState(artifactId);
      if (state !== 'active') throw new Error(`cannot promote on ${state} artifact: ${artifactId}`);
      const releases = await store.listArtifactReleases(artifactId);
      if (!releases.includes(releaseId)) throw new Error(`unknown release: ${releaseId}`);
      if ((await store.getReleaseState(releaseId)) === 'purged') {
        throw new Error(`cannot promote purged release: ${releaseId}`);
      }
      const current = await store.getCurrent(artifactId);
      if (current !== expectedCurrent) {
        throw new Error(`promotion conflict for ${artifactId}: expected ${expectedCurrent}`);
      }
      await store.setCurrent(artifactId, releaseId);
      if (current !== undefined && current !== releaseId) {
        await store.setReleaseState(current, 'retired');
      }
      await store.setReleaseState(releaseId, 'active');
      return { releaseId };
    },
    async renew(artifactId: string, actorId: string) {
      await assertOwner(artifactId, actorId);
      const state = await store.getArtifactState(artifactId);
      if (state === 'deleted') throw new Error(`cannot renew deleted artifact: ${artifactId}`);
      if (state === 'purged') throw new Error(`cannot renew purged artifact: terminal ${artifactId}`);
      const renewedAt = clock();
      await store.setRenewedAt(artifactId, renewedAt);
      return { renewedAt };
    },
  };
}
