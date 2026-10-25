// Fresh-store host for the packed probe, using only installed public exports.
import { randomUUID } from 'node:crypto';
import { createHttpArtifactApp } from '@sentropic/artifacts/http';
import { compileArtifactsProfile, RADAR_ARTIFACTS_PROFILE, createRadarKeyDerivation } from '@sentropic/artifacts/mcp-core';
import { createArtifactCommitCoordinator } from '@sentropic/artifacts/server/commit-contract';
import { createMemoryAclStore } from '@sentropic/artifacts/server/access';
import { createLifecycleService, createMemoryLifecycleStore } from '@sentropic/artifacts/server/lifecycle';
import { createMemoryIntentStore } from '@sentropic/artifacts/server/object-intents';
import { createMemoryKv } from '@sentropic/artifacts/server/ports';
import { createMemoryBlobStore, createMemoryStateStore } from '@sentropic/artifacts/server/publication';
import { createMemoryRefcountStore } from '@sentropic/artifacts/server/gc';

export function createProbeHost() {
  const profile = compileArtifactsProfile(RADAR_ARTIFACTS_PROFILE);
  const receipts = new Map(), bindings = new Map(), writes = new Map();
  const state = createMemoryStateStore(), blobs = createMemoryBlobStore(), acls = createMemoryAclStore();
  const lifecycle = createLifecycleService(createMemoryLifecycleStore(), () => '2026-01-01T00:00:00Z', state);
  const intents = createMemoryIntentStore();
  const getCurrent = async (id) => {
    const releaseId = await state.getCurrentReleaseId(id);
    return releaseId === undefined ? undefined : state.getRelease(releaseId);
  };
  const coordinator = createArtifactCommitCoordinator({ executor: {
    async ensureCoordinationRow() {},
    async beginFinalization() {
      const pending = [];
      const connection = {
        async query() { return { rows: [], rowCount: 0 }; },
        async beginReadCommitted() {}, async lockOperationKey() {},
        async readReceipt(scope, key) { return receipts.get(`${scope}/${key}`); },
        async insertReceipt(receipt) { pending.push(async () => receipts.set(`${receipt.scopeId}/${receipt.internalKey}`, receipt)); },
        async commit() { for (const write of pending) await write(); },
        async rollback() { pending.length = 0; }, release() { writes.delete(connection); },
      };
      writes.set(connection, pending);
      return connection;
    },
  }, policy: { createParticipant: (_client, transactionId) => ({
    async readRevision() { return 'rev-1'; }, async checkApproval() { return { approved: true }; },
    async reserveQuota() { return { reserved: true }; },
    mintFence: (policyRevision, invocationId) => ({ fenceId: randomUUID(), transactionId, invocationId, policyRevision }),
  }) } });
  let guardCalls = 0;
  const invocation = () => ({ invocationId: randomUUID(), actorId: 'owner-1', storageScopeId: 'scope-1',
    authorizeCommit: async (context, tx) => {
      guardCalls += 1;
      return { allowed: true, fence: tx.participant.mintFence(context.policyRevision, context.invocationId) };
    },
  });
  const app = createHttpArtifactApp({ profile, coordinator, acls, lifecycle,
    derivation: createRadarKeyDerivation({ storageScopeId: 'scope-1', actorIds: ['owner-1'] }),
    legacyRecords: createMemoryKv(),
    ensureHost: {
      async readPolicyRevision() { return 'rev-1'; }, async lockBinding() {}, async abandonAttempt() {},
      async resolveBinding(client, input) {
        const key = `${input.ownerId}/${input.bindingName}`;
        if (bindings.has(key)) return { artifactId: bindings.get(key), created: false };
        const artifactId = randomUUID();
        writes.get(client).push(async () => {
          bindings.set(key, artifactId);
          await acls.putArtifactAcl(artifactId, { ownerId: input.ownerId, storageScopeId: input.storageScopeId,
            isPublic: false, withdrawn: false, grants: [] });
          await lifecycle.register(artifactId, input.ownerId);
        });
        return { artifactId, created: true };
      },
    },
    publication: { blobs, intents, refs: createMemoryRefcountStore(), getCurrent,
      createUnitWriter: (client) => ({
        async readAuthorization(id) { return { state: await lifecycle.stateOf(id), acl: await acls.getArtifactAcl(id) }; },
        async putRelease(release) { writes.get(client).push(() => state.putRelease(release)); },
        async promoteCurrentLatestWins(id, releaseId) { writes.get(client).push(async () => {
          await state.compareAndSwapCurrent(id, await state.getCurrentReleaseId(id) ?? null, releaseId);
        }); },
        async completeIntent(id) { writes.get(client).push(() => intents.complete(id)); },
        async putSource() {}, async registerBlob() {}, async addReleaseRef() {},
      }),
    },
  });
  return { app, profile, invocation, getCurrent, blobs, acls, lifecycle, guardCalls: () => guardCalls };
}
