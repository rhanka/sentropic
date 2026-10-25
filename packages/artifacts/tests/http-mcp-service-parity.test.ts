/**
 * L-5c — HTTP/MCP service parity, part 1: ensure + publish (spec-v8 §9 5c).
 * The transport-free HTTP app delegates to the same services as direct
 * calls (401 anonymous, 403 denied, 404 absent, 409 conflict, 422 failed
 * verification, 400 invalid). Artifacts are addressed by server UUID; only
 * ensure takes a binding.
 */
import { describe, expect, it } from 'vitest';
import { createHttpArtifactApp, type HttpRequest } from '../src/http.js';
import { randomUUID } from 'node:crypto';
import { compileArtifactsProfile, RADAR_ARTIFACTS_PROFILE } from '../src/profile/index.js';
import { createRadarKeyDerivation } from '../src/server/command-identity.js';
import { createArtifactCommitCoordinator } from '../src/server/commit/coordinator.js';
import type { ArtifactInvocationContext, CommitExecutor, FinalizeConnection,
  FinalizeTxClient, StoredCommitReceipt } from '../src/server/commit/types.js';
import { createMemoryRefcountStore } from '../src/server/gc.js';
import { createArtifactsToolExecutor } from '../src/mcp-core.js';

function atomicTransport() {
  const profile = compileArtifactsProfile(RADAR_ARTIFACTS_PROFILE);
  const receipts = new Map<string, StoredCommitReceipt>();
  const bindings = new Map<string, string>();
  const releases = new Map<string, { releaseId: string; manifest: string }>();
  const writes = new Map<FinalizeTxClient, (() => Promise<void>)[]>();
  const acls = createMemoryAclStore();
  const lifecycle = createLifecycleService(createMemoryLifecycleStore(), () => '2026-01-01T00:00:00Z');
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
  const invocation = (actorId = 'alice'): ArtifactInvocationContext => Object.freeze({
    invocationId: randomUUID(), actorId, storageScopeId: 'scope-l6',
    authorizeCommit: async (context, tx) => {
      guardCalls += 1;
      return allowed ? { allowed: true, fence: tx.participant.mintFence(context.policyRevision, context.invocationId) }
        : { allowed: false, reason: 'revoked', status: 403, publicCode: 'access_denied', retriable: false };
    },
  });
  const app = createHttpArtifactApp({ profile, coordinator,
    publicationUrls: (artifactId, releaseId) => ({
      stableUrl: `https://artifacts.test/a/${artifactId}`,
      pinnedUrl: `https://artifacts.test/a/${artifactId}/r/${releaseId}`,
    }),
    derivation: createRadarKeyDerivation({ storageScopeId: 'scope-l6', actorIds: ['alice', 'bob', 'issuer|alice'] }),
    legacyRecords: createMemoryKv(),
    acls, lifecycle,
    ensureHost: {
      async readPolicyRevision() { return 'rev-1'; }, async lockBinding() {}, async abandonAttempt() {},
      async resolveBinding(client, input) {
        const key = `${input.ownerId}/${input.bindingName}`;
        const existing = bindings.get(key);
        const artifactId = existing ?? randomUUID();
        writes.get(client)!.push(async () => {
          bindings.set(key, artifactId);
          await acls.putArtifactAcl(artifactId, { ownerId: input.ownerId, storageScopeId: input.storageScopeId,
            isPublic: false, withdrawn: false, grants: [] });
          await lifecycle.register(artifactId, input.ownerId);
        });
        return { artifactId, created: existing === undefined };
      },
    },
    publication: {
      blobs: createMemoryBlobStore(), intents: createMemoryIntentStore(), refs: createMemoryRefcountStore(),
      async getCurrent(artifactId) { return releases.get(artifactId); },
      createUnitWriter: (client) => ({
        async readAuthorization(artifactId) { return { state: await lifecycle.stateOf(artifactId), acl: await acls.getArtifactAcl(artifactId) }; },
        async putRelease(release) { writes.get(client)!.push(async () => { releases.set(release.artifactId, release); }); },
        async putSource() {}, async registerBlob() {}, async promoteCurrentLatestWins() {},
        async addReleaseRef() {}, async completeIntent() {},
      }),
    },
  });
  const mcp = createArtifactsToolExecutor({ app, profile });
  const http = (path: string, body: unknown, context = invocation()) => app.execute({
    method: 'POST', path, body, actorId: context.actorId, storageScopeId: context.storageScopeId,
  }, context);
  return { app, mcp, http, invocation, receipts, releases, bindings,
    deny: () => { allowed = false; }, allow: () => { allowed = true; }, guardCalls: () => guardCalls };
}

describe('L6 authorized HTTP/MCP parity', () => {
  const args = { bindingName: 'site', idempotencyKey: ' caller key ' };
  it('should replay ensure across transports with current authorization', async () => {
    const host = atomicTransport();
    const first = await host.http('/ensure', args);
    expect(first).toMatchObject({ ok: true, commitState: 'committed' });
    const replay = await host.mcp.execute({ tool: 'artifacts_ensure', args, invocation: host.invocation() });
    expect(replay).toMatchObject({ ok: true, replayed: true, result: { body: { replayed: true } } });
    expect(host.receipts.size).toBe(1);
    host.deny();
    expect(await host.http('/ensure', args)).toMatchObject({ ok: false, failure: { category: 'unauthorized_at_commit' } });
    expect(host.receipts.size).toBe(1);
  });
  it('should leave no success after denial and allow a fresh same-key attempt', async () => {
    const host = atomicTransport();
    host.deny();
    expect(await host.http('/ensure', args)).toMatchObject({ ok: false });
    expect(host.receipts.size).toBe(0);
    expect(host.bindings.size).toBe(0);
    host.allow();
    expect(await host.http('/ensure', args)).toMatchObject({ ok: true, replayed: false });
  });
  it('should keep canonical verified subjects distinct', async () => {
    const host = atomicTransport();
    await host.http('/ensure', args, host.invocation('alice'));
    const other = await host.mcp.execute({ tool: 'artifacts_ensure', args, invocation: host.invocation('issuer|alice') });
    expect(other).toMatchObject({ ok: true, replayed: false });
    expect(host.receipts.size).toBe(2);
  });
  it('should bind the request guard through publication and replay', async () => {
    const host = atomicTransport();
    const ensured = await host.http('/ensure', args);
    if (!ensured.ok) throw new Error('ensure failed');
    const artifactId = (ensured.result.body as { artifactId: string }).artifactId;
    const publish = { artifactId, idempotencyKey: 'publish', files: [{ path: 'index.html', mimeType: 'text/html', text: 'hi' }] };
    host.deny();
    expect(await host.http('/publish', publish)).toMatchObject({ ok: false, failure: { category: 'unauthorized_at_commit' } });
    expect(host.releases.size).toBe(0);
    expect(host.receipts.size).toBe(1);
    host.allow();
    const first = await host.http('/publish', publish);
    expect(first).toMatchObject({ ok: true, replayed: false });
    const replay = await host.mcp.execute({ tool: 'artifacts_publish', args: publish, invocation: host.invocation() });
    expect(replay).toMatchObject({ ok: true, replayed: true });
    if (!first.ok || !replay.ok) throw new Error('publish failed');
    expect(replay.result.body).toEqual(first.result.body);
    expect(first.result.body).toMatchObject({ artifactId,
      stableUrl: `https://artifacts.test/a/${artifactId}`, pinnedUrl: expect.stringContaining('/r/'),
      digest: expect.stringMatching(/^sha256:/),
    });
    expect(replay.result.body).not.toHaveProperty('replayed');
    expect(host.guardCalls()).toBeGreaterThan(0);
    expect(host.releases.size).toBe(1);
  });
  it.each(['bytes', 'path', 'mime', 'profile', 'order'])(
    'should conflict on changed %s through the other transport', async (change) => {
      const host = atomicTransport();
      const ensured = await host.http('/ensure', args);
      if (!ensured.ok) throw new Error('ensure failed');
      const artifactId = (ensured.result.body as { artifactId: string }).artifactId;
      const files = [
        { path: 'index.html', mimeType: 'text/html', text: 'hi' },
        { path: 'style.css', mimeType: 'text/css', text: 'body{}' },
      ];
      const publish = { artifactId, idempotencyKey: 'identity', files, profile: {} };
      expect(await host.http('/publish', publish)).toMatchObject({ ok: true });
      const changed = structuredClone(publish);
      if (change === 'bytes') changed.files[0].text = 'changed';
      if (change === 'path') changed.files[0].path = 'other.html';
      if (change === 'mime') changed.files[0].mimeType = 'application/json';
      if (change === 'profile') changed.profile = { variant: 'changed' };
      if (change === 'order') changed.files.reverse();
      expect(await host.mcp.execute({ tool: 'artifacts_publish', args: changed,
        invocation: host.invocation() })).toMatchObject({ ok: false, failure: {
        category: 'conflict', httpStatus: 409, retriable: false,
      } });
      expect(host.releases.size).toBe(1);
    },
  );
});
import { createArtifactService } from '../src/server/service.js';
import {
  createPublicationService,
  createMemoryStateStore,
  createMemoryBlobStore,
} from '../src/server/publication.js';
import { createMemoryIntentStore } from '../src/server/object-intents.js';
import { createIdempotencyStore, createMemoryIdempotencyKv } from '../src/server/idempotency.js';
import {
  createLifecycleService,
  createMemoryLifecycleStore,
} from '../src/server/lifecycle.js';
import { createForkService, createMemoryForkStore } from '../src/server/fork.js';
import { createMemoryAclStore } from '../src/server/access.js';
import { createMemorySourceStore } from '../src/server/sources.js';
import { createMemoryKv, createCryptoUuid } from '../src/server/ports.js';
import { defineParameters } from '../src/parameters.js';
