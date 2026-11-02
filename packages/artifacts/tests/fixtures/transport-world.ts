/** Atomic memory composition shared by transport and content journeys. */
import { randomUUID } from 'node:crypto';
import { createHttpArtifactApp } from '../../src/http.js';
import { createArtifactsToolExecutor } from '../../src/mcp-core.js';
import { compileArtifactsProfile, RADAR_ARTIFACTS_PROFILE } from '../../src/profile/index.js';
import { createRadarKeyDerivation } from '../../src/server/command-identity.js';
import { createArtifactCommitCoordinator } from '../../src/server/commit/coordinator.js';
import type { ArtifactHostFailureMapper } from '../../src/server/failures.js';
import type { CommitBarrierObserver } from '../../src/testing.js';
import type { ArtifactInvocationContext, CommitExecutor, FinalizeConnection,
  FinalizeTxClient, StoredCommitReceipt } from '../../src/server/commit/types.js';
import { createMemoryAclStore } from '../../src/server/access.js';
import { createMemoryRefcountStore } from '../../src/server/gc.js';
import { createLifecycleService, createMemoryLifecycleStore } from '../../src/server/lifecycle.js';
import { createMemoryIntentStore } from '../../src/server/object-intents.js';
import { createMemoryKv } from '../../src/server/ports.js';
import { createMemorySourceStore } from '../../src/server/sources.js';
import type { DeleteConfirmationContext } from '../../src/server/management.js';
import { createMemoryBlobStore, createMemoryStateStore, type ReleaseRecord,
  type PublicationService } from '../../src/server/publication.js';

export function createTransportWorld(actors = ['alice', 'bob', 'issuer|alice'], scope = 'scope-l6',
  options: { mapHostError?: ArtifactHostFailureMapper; testObserver?: CommitBarrierObserver; parity?: boolean } = {}) {
  const profile = compileArtifactsProfile(options.parity ? { ...RADAR_ARTIFACTS_PROFILE,
    selectedCapabilities: [...RADAR_ARTIFACTS_PROFILE.selectedCapabilities, 'artifacts_get_source', 'artifacts_set_access', 'artifacts_delete'],
    operations: [...RADAR_ARTIFACTS_PROFILE.operations,
      { operation: 'get_source', limits: {}, defaults: {} },
      { operation: 'set_access', limits: { idempotencyKeyMaxUnits: 256 }, defaults: {} },
      { operation: 'delete', limits: { idempotencyKeyMaxUnits: 256 }, defaults: {} }],
  } : RADAR_ARTIFACTS_PROFILE);
  const receipts = new Map<string, StoredCommitReceipt>();
  const bindings = new Map<string, string>();
  const releases = new Map<string, ReleaseRecord>();
  const writes = new Map<FinalizeTxClient, (() => Promise<void>)[]>();
  const acls = createMemoryAclStore();
  const state = createMemoryStateStore();
  const blobs = createMemoryBlobStore();
  const legacyRecords = createMemoryKv();
  const intents = createMemoryIntentStore();
  const lifecycleStore = createMemoryLifecycleStore();
  const lifecycle = createLifecycleService(lifecycleStore, () => '2026-01-01T00:00:00Z', state);
  const sources = createMemorySourceStore();
  const confirmations = new Map<string, { context: DeleteConfirmationContext; approved: boolean; expired?: boolean }>();
  let allowed = true;
  let approved = true;
  let guardCalls = 0;
  const quotaReservations: number[] = [];
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
  const coordinator = createArtifactCommitCoordinator({ ...options, executor, policy: {
    createParticipant: (_client, transactionId) => ({
      async readRevision() { return 'rev-1'; }, async checkApproval() { return { approved }; },
      async reserveQuota({ bytes }) { quotaReservations.push(bytes); return { reserved: true }; },
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
  const app = createHttpArtifactApp({ ...options, profile, coordinator,
    publicationUrls: (artifactId, releaseId) => ({ stableUrl: `https://artifacts.test/a/${artifactId}`,
      pinnedUrl: `https://artifacts.test/a/${artifactId}/r/${releaseId}` }),
    derivation: createRadarKeyDerivation({ storageScopeId: scope, actorIds: actors }),
    legacyRecords, acls, lifecycle, sources, isApprovedAccount: (id) => actors.includes(id),
    management: {
      confirmation: {
        async request(context) {
          const confirmationRef = randomUUID();
          confirmations.set(confirmationRef, { context, approved: false });
          return { confirmationRef, managementUrl: `https://control.test/${context.artifactId}`, expiresAt: '2026-11-02T00:00:00Z' };
        },
        async consume(client, context, ref) {
          const proof = confirmations.get(ref);
          if (proof?.expired) return 'expired';
          if (!proof?.approved || JSON.stringify(context) !== JSON.stringify(proof.context)) return 'invalid';
          writes.get(client)!.push(async () => { confirmations.delete(ref); });
          return 'valid';
        },
      },
      createUnit(client) {
        return {
          async lock() {},
          async read(id) {
            const acl = await acls.getArtifactAcl(id);
            return acl ? { acl, state: await lifecycle.stateOf(id), terminal: await lifecycleStore.isTerminal(id),
              currentReleaseId: (await publication.getCurrent(id))?.releaseId ?? null } : undefined;
          },
          async setAccess(id, principalId, action, updatedAt) {
            const acl = (await acls.getArtifactAcl(id))!;
            const grants = action === 'revoke' ? acl.grants.filter((g) => g.principalId !== principalId)
              : acl.grants.some((g) => g.principalId === principalId) ? acl.grants : [...acl.grants, { principalId, grant: 'read' as const }];
            writes.get(client)!.push(() => acls.putArtifactAcl(id, { ...acl, isPublic: false, grants, updatedAt }));
            return { grants, updatedAt };
          },
          async delete(id) { writes.get(client)!.push(() => lifecycleStore.markTerminal(id)); },
        };
      },
    },
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
            bindingName: input.bindingName, createdAt: '2026-01-01T00:00:00Z', isPublic: false, withdrawn: false, grants: [] });
          await lifecycle.register(artifactId, input.ownerId);
        });
        return { artifactId, created: true };
      },
    },
    publication: {
      blobs, intents, refs: createMemoryRefcountStore(), getCurrent: publication.getCurrent, getRelease: publication.getRelease,
      createUnitWriter: (client) => ({
        async readAuthorization(artifactId) { return { state: await lifecycle.stateOf(artifactId), acl: await acls.getArtifactAcl(artifactId) }; },
        async putRelease(release) { writes.get(client)!.push(async () => {
          releases.set(release.artifactId, release); await state.putRelease(release);
        }); },
        async promoteCurrentLatestWins(artifactId, releaseId) { writes.get(client)!.push(async () => {
          await state.compareAndSwapCurrent(artifactId, await state.getCurrentReleaseId(artifactId) ?? null, releaseId);
        }); },
        async completeIntent(id) { writes.get(client)!.push(() => intents.complete(id)); },
        async putSource(id, source) { writes.get(client)!.push(() => sources.putSource(id, source)); }, async registerBlob() {}, async addReleaseRef() {},
      }),
    },
  });
  const mcp = createArtifactsToolExecutor({ ...options, app, profile });
  const http = (path: string, body: unknown, context = invocation()) => app.execute({
    method: 'POST', path, body, actorId: context.actorId, storageScopeId: context.storageScopeId,
  }, context);
  return { app, mcp, http, invocation, receipts, releases, bindings, profile, publication, acls, lifecycle, blobs, legacyRecords, quotaReservations,
    approveConfirmation: (ref: string) => { const proof = confirmations.get(ref); if (proof) proof.approved = true; },
    expireConfirmation: (ref: string) => { const proof = confirmations.get(ref); if (proof) proof.expired = true; },
    executor, suspend: () => { approved = false; },
    deny: () => { allowed = false; }, allow: () => { allowed = true; }, guardCalls: () => guardCalls };
}
