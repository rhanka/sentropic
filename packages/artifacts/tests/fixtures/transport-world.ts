/** Atomic memory composition shared by transport and content journeys. */
import { randomUUID } from 'node:crypto';
import { createHttpArtifactApp } from '../../src/http.js';
import { createArtifactsToolExecutor } from '../../src/mcp-core.js';
import { compileArtifactsProfile, RADAR_ARTIFACTS_PROFILE } from '../../src/profile/index.js';
import { createRadarKeyDerivation } from '../../src/server/command-identity.js';
import { createArtifactCommitCoordinator } from '../../src/server/commit/coordinator.js';
import type { ArtifactInvocationContext, CommitExecutor, FinalizeConnection,
  FinalizeTxClient, StoredCommitReceipt } from '../../src/server/commit/types.js';
import { createMemoryAclStore } from '../../src/server/access.js';
import { createMemoryRefcountStore } from '../../src/server/gc.js';
import { createLifecycleService, createMemoryLifecycleStore } from '../../src/server/lifecycle.js';
import { createMemoryIntentStore } from '../../src/server/object-intents.js';
import { createMemoryKv } from '../../src/server/ports.js';
import { createMemoryBlobStore, createMemoryStateStore, type ReleaseRecord,
  type PublicationService } from '../../src/server/publication.js';

export function createTransportWorld(actors = ['alice', 'bob', 'issuer|alice'], scope = 'scope-l6') {
  const profile = compileArtifactsProfile(RADAR_ARTIFACTS_PROFILE);
  const receipts = new Map<string, StoredCommitReceipt>();
  const bindings = new Map<string, string>();
  const releases = new Map<string, ReleaseRecord>();
  const writes = new Map<FinalizeTxClient, (() => Promise<void>)[]>();
  const acls = createMemoryAclStore();
  const state = createMemoryStateStore();
  const blobs = createMemoryBlobStore();
  const legacyRecords = createMemoryKv();
  const intents = createMemoryIntentStore();
  const lifecycle = createLifecycleService(createMemoryLifecycleStore(), () => '2026-01-01T00:00:00Z', state);
  let allowed = true;
  let guardCalls = 0;
  const executor: CommitExecutor = {
    async ensureCoordinationRow() {},
    async beginFinalization() {
      const pending: (() => Promise<void>)[] = [];
      const connection: FinalizeConnection = {
        async query() { return { rows: [], rowCount: 0 }; },
        async beginReadCommitted() {}, async lockOperationKey() {},
        async readReceipt(scope, key) { return receipts.get(`${scope}/${key}`); },
        async insertReceipt(receipt) { pending.push(async () => { receipts.set(`${receipt.scopeId}/${receipt.internalKey}`, receipt); }); },
        async commit() { for (const write of pending) await write(); },
        async rollback() { pending.length = 0; }, release() { writes.delete(connection); },
      };
      writes.set(connection, pending);
      return connection;
    },
  };
  const coordinator = createArtifactCommitCoordinator({ executor, policy: {
    createParticipant: (_client, transactionId) => ({
      async readRevision() { return 'rev-1'; }, async checkApproval() { return { approved: true }; },
      async reserveQuota() { return { reserved: true }; },
      mintFence: (policyRevision, invocationId) => ({ fenceId: randomUUID(), transactionId, invocationId, policyRevision }),
    }),
  } });
  const invocation = (actorId = actors[0]): ArtifactInvocationContext => Object.freeze({
    invocationId: randomUUID(), actorId, storageScopeId: scope,
    authorizeCommit: async (context, tx) => {
      guardCalls += 1;
      return allowed ? { allowed: true, fence: tx.participant.mintFence(context.policyRevision, context.invocationId) }
        : { allowed: false, reason: 'revoked', status: 403, publicCode: 'access_denied', retriable: false };
    },
  });
  const publication: PublicationService = {
    publish: async () => { throw new Error('use the guarded control app'); },
    getRelease: (releaseId) => state.getRelease(releaseId),
    async getCurrent(artifactId) {
      const releaseId = await state.getCurrentReleaseId(artifactId);
      return releaseId === undefined ? undefined : state.getRelease(releaseId);
    },
  };
  const app = createHttpArtifactApp({ profile, coordinator,
    publicationUrls: (artifactId, releaseId) => ({ stableUrl: `https://artifacts.test/a/${artifactId}`,
      pinnedUrl: `https://artifacts.test/a/${artifactId}/r/${releaseId}` }),
    derivation: createRadarKeyDerivation({ storageScopeId: scope, actorIds: actors }),
    legacyRecords, acls, lifecycle,
    ensureHost: {
      async readPolicyRevision() { return 'rev-1'; }, async lockBinding() {}, async abandonAttempt() {},
      async resolveBinding(client, input) {
        const key = `${input.ownerId}/${input.bindingName}`;
        const existing = bindings.get(key);
        if (existing) return { artifactId: existing, created: false };
        const artifactId = randomUUID();
        writes.get(client)!.push(async () => {
          bindings.set(key, artifactId);
          await acls.putArtifactAcl(artifactId, { ownerId: input.ownerId, storageScopeId: input.storageScopeId,
            isPublic: false, withdrawn: false, grants: [] });
          await lifecycle.register(artifactId, input.ownerId);
        });
        return { artifactId, created: true };
      },
    },
    publication: {
      blobs, intents, refs: createMemoryRefcountStore(), getCurrent: publication.getCurrent,
      createUnitWriter: (client) => ({
        async readAuthorization(artifactId) { return { state: await lifecycle.stateOf(artifactId), acl: await acls.getArtifactAcl(artifactId) }; },
        async putRelease(release) { writes.get(client)!.push(async () => {
          releases.set(release.artifactId, release); await state.putRelease(release);
        }); },
        async promoteCurrentLatestWins(artifactId, releaseId) { writes.get(client)!.push(async () => {
          await state.compareAndSwapCurrent(artifactId, await state.getCurrentReleaseId(artifactId) ?? null, releaseId);
        }); },
        async completeIntent(id) { writes.get(client)!.push(() => intents.complete(id)); },
        async putSource() {}, async registerBlob() {}, async addReleaseRef() {},
      }),
    },
  });
  const mcp = createArtifactsToolExecutor({ app, profile });
  const http = (path: string, body: unknown, context = invocation()) => app.execute({
    method: 'POST', path, body, actorId: context.actorId, storageScopeId: context.storageScopeId,
  }, context);
  return { app, mcp, http, invocation, receipts, releases, bindings, profile, publication, acls, lifecycle, blobs, legacyRecords,
    deny: () => { allowed = false; }, allow: () => { allowed = true; }, guardCalls: () => guardCalls };
}
