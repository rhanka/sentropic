/** Atomic memory composition shared by transport and content journeys. */
import { randomUUID } from 'node:crypto';
import { createHttpArtifactApp, type HttpAppDeps } from '../../src/http.js';
import { createArtifactsToolExecutor } from '../../src/mcp-core.js';
import { compileArtifactsProfile, RADAR_ARTIFACTS_PROFILE, type ArtifactProviderProfile } from '../../src/profile/index.js';
import { createRadarKeyDerivation } from '../../src/server/command-identity.js';
import { createArtifactCommitCoordinator } from '../../src/server/commit/coordinator.js';
import type { ArtifactHostFailureMapper } from '../../src/server/failures.js';
import type { CommitBarrierObserver } from '../../src/testing.js';
import type { ArtifactInvocationContext, CommitExecutor, FinalizeConnection,
  FinalizeTxClient, StoredCommitReceipt } from '../../src/server/commit/types.js';
import { accessModeOf, applyModeTransition, createMemoryAclStore,
  PLATFORM_PRINCIPAL, PUBLIC_PRINCIPAL, type AccessEvent } from '../../src/server/access.js';
import { createMemoryRefcountStore } from '../../src/server/gc.js';
import { createLifecycleService, createMemoryLifecycleStore } from '../../src/server/lifecycle.js';
import { createMemoryIntentStore } from '../../src/server/object-intents.js';
import { createMemoryKv, type PrincipalDirectoryPort, type SharingPolicyPort } from '../../src/server/ports.js';
import type { ArtifactReaderStore } from '../../src/server/reader-store.js';
import { createMemorySourceStore } from '../../src/server/sources.js';
import type { DeleteConfirmationContext } from '../../src/server/management.js';
import { createMemoryBlobStore, createMemoryStateStore, type ReleaseRecord,
  type PublicationService } from '../../src/server/publication.js';
import { createMemoryIdempotencyKv, createIdempotencyStore } from '../../src/server/idempotency.js';
import { createMemoryStaging, createMemoryUploadSessionStore, createMemoryUploadSigner,
  type UploadSessionStore, type StagingStore } from '../../src/server/uploads.js';

export function createTransportWorld(actors = ['alice', 'bob', 'issuer|alice'], scope = 'scope-l6',
  options: { mapHostError?: ArtifactHostFailureMapper; testObserver?: CommitBarrierObserver;
    parity?: boolean; profile?: ArtifactProviderProfile; sharingPolicy?: SharingPolicyPort;
    actorIsAdmin?: (actorId: string, storageScopeId: string) => boolean | Promise<boolean>;
    /** G2: host principal directory; flows into appDeps via the options spread. */
    directory?: PrincipalDirectoryPort;
    /** Lot 1a: reader consent store; flows into appDeps via the options spread. */
    readerConsent?: ArtifactReaderStore } = {}) {
  const profile = compileArtifactsProfile(options.profile ?? (options.parity ? { ...RADAR_ARTIFACTS_PROFILE,
    selectedCapabilities: [...RADAR_ARTIFACTS_PROFILE.selectedCapabilities, 'artifacts_get_source', 'artifacts_set_access', 'artifacts_delete'],
    operations: [...RADAR_ARTIFACTS_PROFILE.operations.filter(op => op.operation !== 'get_source'),
      { operation: 'get_source', limits: {}, defaults: {} },
      { operation: 'delete', limits: { idempotencyKeyMaxUnits: 256 }, defaults: {} }],
  } : RADAR_ARTIFACTS_PROFILE));
  const receipts = new Map<string, StoredCommitReceipt>();
  const bindings = new Map<string, string>();
  const releases = new Map<string, ReleaseRecord>();
  const writes = new Map<FinalizeTxClient, (() => Promise<void>)[]>();
  const lockTails = new Map<string, Promise<void>>();
  const unlocks = new Map<FinalizeTxClient, (() => void)[]>();
  async function lock(client: FinalizeTxClient, key: string) {
    const previous = lockTails.get(key) ?? Promise.resolve();
    let unlock!: () => void;
    lockTails.set(key, new Promise<void>(resolve => { unlock = resolve; }));
    await previous;
    unlocks.get(client)!.push(unlock);
  }
  const acls = createMemoryAclStore();
  const state = createMemoryStateStore();
  const blobs = createMemoryBlobStore();
  const legacyRecords = createMemoryKv();
  const intents = createMemoryIntentStore();
  // Files parity LOT 1: memory upload ports (session ledger, staging, signer, idempotency).
  const uploadSessions: UploadSessionStore = createMemoryUploadSessionStore();
  const uploadStaging: StagingStore = createMemoryStaging();
  const uploadSigner = createMemoryUploadSigner();
  const uploadIdempotency = createIdempotencyStore(createMemoryIdempotencyKv());
  const lifecycleStore = createMemoryLifecycleStore();
  const lifecycle = createLifecycleService(lifecycleStore, () => '2026-01-01T00:00:00Z', state);
  const sources = createMemorySourceStore();
  const confirmations = new Map<string, { context: DeleteConfirmationContext; approved: boolean; expired?: boolean }>();
  let allowed = true;
  let approved = true;
  let guardCalls = 0;
  const quotaReservations: number[] = [];
  const accountStates = new Map<string, boolean>(actors.map((a) => [a, true]));
  const accessEvents: AccessEvent[] = [];
  const executor: CommitExecutor = {
    async ensureCoordinationRow() {},
    async beginFinalization() {
      const pending: (() => Promise<void>)[] = [];
      const connection: FinalizeConnection = {
        async query() { return { rows: [], rowCount: 0 }; },
        async beginReadCommitted() {}, async lockOperationKey(scope, key) { await lock(connection, `${scope}/${key}`); },
        async readReceipt(scope, key) { return receipts.get(`${scope}/${key}`); },
        async insertReceipt(receipt) { pending.push(async () => { receipts.set(`${receipt.scopeId}/${receipt.internalKey}`, receipt); }); },
        async commit() { for (const write of pending) await write(); },
        async rollback() { pending.length = 0; }, release() {
          for (const unlock of unlocks.get(connection) ?? []) unlock();
          unlocks.delete(connection); writes.delete(connection);
        },
      };
      writes.set(connection, pending);
      unlocks.set(connection, []);
      return connection;
    },
  };
  const coordinator = createArtifactCommitCoordinator({ ...options, executor, policy: {
    createParticipant: (client, transactionId) => ({
      async readRevision() { return 'rev-1'; }, async checkApproval() { return { approved }; },
      async reserveQuota({ bytes }) { writes.get(client)!.push(async () => { quotaReservations.push(bytes); }); return { reserved: true }; },
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
    listReleases: (artifactId) => state.listReleases(artifactId),
    async getCurrent(artifactId) {
      const releaseId = await state.getCurrentReleaseId(artifactId);
      return releaseId === undefined ? undefined : state.getRelease(releaseId);
    },
  };
  const appDeps: HttpAppDeps = { ...options, profile, coordinator,
    publicationUrls: (artifactId, releaseId) => ({ stableUrl: `https://${artifactId}.artifacts.test/`,
      versionUrl: `https://${releaseId}.artifacts.test/` }),
    derivation: createRadarKeyDerivation({ storageScopeId: scope, actorIds: actors }),
    legacyRecords, acls, lifecycle, sources,
    isApprovedAccount: (id) => accountStates.get(id) === true,
    sharingPolicy: options.sharingPolicy,
    actorIsAdmin: options.actorIsAdmin,
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
            const mode = accessModeOf(acl);
            if (principalId === PLATFORM_PRINCIPAL || principalId === PUBLIC_PRINCIPAL) {
              const transition = applyModeTransition(mode, action, principalId);
              writes.get(client)!.push(() => acls.putArtifactAcl(id, {
                ...acl, accessMode: transition.mode, isPublic: transition.mode !== 'restricted', updatedAt,
              }));
              return { grants: acl.grants, updatedAt, accessMode: transition.mode, changed: transition.changed };
            }
            const exists = acl.grants.some((g) => g.principalId === principalId);
            const grants = action === 'revoke' ? acl.grants.filter((g) => g.principalId !== principalId)
              : exists ? acl.grants : [...acl.grants, { principalId, grant: 'read' as const, createdAt: updatedAt }];
            writes.get(client)!.push(() => acls.putArtifactAcl(id, { ...acl, grants, updatedAt }));
            return { grants, updatedAt, accessMode: mode, changed: action === 'revoke' ? exists : !exists };
          },
          async recordEvent(event) { writes.get(client)!.push(async () => { accessEvents.push(event); }); },
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
      blobs, intents, refs: createMemoryRefcountStore(), getCurrent: publication.getCurrent,
      getRelease: publication.getRelease, listReleases: publication.listReleases,
      createUnitWriter: (client) => ({
        async lockCurrent(artifactId) {
          await lock(client, `artifact/${artifactId}`);
          const current = await publication.getCurrent(artifactId);
          return { currentReleaseId: current?.releaseId ?? null, currentDigest: current?.manifestDigest ?? null };
        },
        async updateMetadata(artifactId, metadata) {
          const acl = (await acls.getArtifactAcl(artifactId))!;
          const merged = { ...acl?.metadata, ...metadata };
          writes.get(client)!.push(async () => {
            const current = (await acls.getArtifactAcl(artifactId))!;
            await acls.putArtifactAcl(artifactId, { ...current, metadata: { ...current.metadata, ...metadata } });
          });
          return merged;
        },
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
    uploads: { sessions: uploadSessions, staging: uploadStaging, signer: uploadSigner.signer,
      idempotency: uploadIdempotency },
  };
  const app = createHttpArtifactApp(appDeps);
  const mcp = createArtifactsToolExecutor({ ...options, app, profile });
  const http = (path: string, body: unknown, context = invocation()) => app.execute({
    method: 'POST', path, body, actorId: context.actorId, storageScopeId: context.storageScopeId,
  }, context);
  return { app, mcp, http, invocation, receipts, releases, bindings, profile, publication, acls, lifecycle, lifecycleStore, state, blobs, legacyRecords, quotaReservations,
    accessEvents, uploadSessions, uploadStaging, uploadSigner,
    withProfile: (input: ArtifactProviderProfile) => createHttpArtifactApp({ ...appDeps, profile: compileArtifactsProfile(input) }),
    approveConfirmation: (ref: string) => { const proof = confirmations.get(ref); if (proof) proof.approved = true; },
    expireConfirmation: (ref: string) => { const proof = confirmations.get(ref); if (proof) proof.expired = true; },
    setAccountApproved: (id: string, value: boolean) => { accountStates.set(id, value); },
    executor, suspend: () => { approved = false; },
    deny: () => { allowed = false; }, allow: () => { allowed = true; }, guardCalls: () => guardCalls };
}
