import { and, eq, inArray, sql } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { createSessionContentRouter } from '../../src/routes/namespaces/session-content';
import { db } from '../../src/db/client';
import {
  sessionContentAdmissions,
  sessionContentAttempts,
  sessionContentGrants,
  sessionContentHistoryAuthorizations,
  sessionContentNamespaces,
  sessionContentObjects,
  sessionContentOfflineReceipts,
  sessionContentProjects,
  sessionContentPurgeJobs,
  sessionContentReservations,
  sessionContentTombstones,
  sessionWorkspaceBindings,
} from '../../src/db/control-schema';
import {
  tenantMemberships, tenants, users, workspaces, workspaceMemberships,
} from '../../src/db/schema';
import {
  createFakeContentAuthorityEpochPort,
  SessionContentError,
  SessionContentService,
  type SessionContentContext,
} from '../../src/services/cluster-mesh/session-content';
import { SessionWorkspaceService } from '../../src/services/cluster-mesh/session-workspace';
import { cleanupAuthData, createAuthenticatedUser, type TestUser } from '../utils/auth-helper';
import {
  createSessionContentFixture,
  type SessionContentFixture,
} from '../utils/session-content-fixture';

const TENANT_A = 'sess-content-tenant-a';
const TENANT_B = 'sess-content-tenant-b';

const basePolicy = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  projectId: 'sess-content-project-1',
  projectRevision: 0,
  tenantId: TENANT_A,
  workspaceId: 'sess-content-workspace-1',
  workspaceIncarnation: 1,
  ownerId: 'owner-placeholder',
  readers: ['owner-placeholder'],
  sourceIdentities: ['src-1'],
  sourceTrustVersions: ['tv-1'],
  channels: {
    'terminal.live': true,
    'terminal.cache': true,
    'native.mirror': true,
    'keyboard.control': false,
  },
  futureSessions: true,
  selectedSessionIds: [],
  namedHistories: [],
  retentionByChannel: {
    'terminal.cache': { mode: 'none' },
    'native.mirror': { mode: 'none' },
  },
  authorityEpoch: 'epoch-test-1',
  offlineReadAccepted: true,
  ...overrides,
});

const expectContentError = async (
  run: () => Promise<unknown>,
  code: SessionContentError['code'],
): Promise<void> => {
  try {
    await run();
  } catch (err) {
    expect(err).toBeInstanceOf(SessionContentError);
    expect((err as SessionContentError).code).toBe(code);
    return;
  }
  throw new Error(`expected SessionContentError ${code}`);
};

describe('session consent durable lifecycle', () => {
  let owner: TestUser;
  let other: TestUser;
  let outsider: TestUser;
  let workspaceId: string;
  let fixture: SessionContentFixture;
  let now: number;
  let fakeEpoch: ReturnType<typeof createFakeContentAuthorityEpochPort>;
  let service: SessionContentService;
  let ctx: SessionContentContext;

  const makeService = (
    quotasOrOptions?: Record<string, number> | {
      quotas?: Record<string, number>;
      publishHooks?: {
        afterUpload?: (key: string) => Promise<void>;
        beforePut?: (key: string) => Promise<void>;
      };
    },
  ): SessionContentService => {
    const options =
      quotasOrOptions && ('quotas' in quotasOrOptions || 'publishHooks' in quotasOrOptions)
        ? (quotasOrOptions as {
          quotas?: Record<string, number>;
          publishHooks?: {
            afterUpload?: (key: string) => Promise<void>;
            beforePut?: (key: string) => Promise<void>;
          };
        })
        : { quotas: quotasOrOptions as Record<string, number> | undefined };
    return new SessionContentService({
      nowMs: () => now,
      issuer: 'test-issuer',
      storage: {
        endpoint: fixture.config.endpoint,
        region: fixture.config.region,
        bucket: fixture.config.bucket,
        accessKeyId: fixture.config.accessKeyId,
        secretAccessKey: fixture.config.secretAccessKey,
      },
      epochs: fakeEpoch,
      quotas: options.quotas,
      publishHooks: options.publishHooks,
    });
  };

  const acceptProject = async (
    overrides: Record<string, unknown> = {},
    context: SessionContentContext = ctx,
  ) => {
    const policy = basePolicy({
      ownerId: context.ownerId,
      readers: [context.ownerId],
      workspaceId,
      ...overrides,
    });
    const prepared = service.prepareProject(policy);
    return service.acceptProject({ ...prepared, offlineReadAccepted: true }, context);
  };

  const adoptSession = async (sessionId: string, tenantId = TENANT_A): Promise<string> => {
    const adopting = new SessionWorkspaceService(undefined, null);
    const binding = await adopting.adopt({
      sessionId, tenantId, principalId: owner.id, workspaceId,
    });
    return binding.bindingId;
  };

  const refreshAck = async (
    sessionId: string,
    projectRevision: number,
    bindingVersion: number,
    nativeBoundarySeq = 0,
    overrides: Record<string, unknown> = {},
  ) => {
    const [grant] = await db
      .select()
      .from(sessionContentGrants)
      .where(eq(sessionContentGrants.sessionId, sessionId));
    const [project] = await db
      .select()
      .from(sessionContentProjects)
      .where(eq(sessionContentProjects.projectId, grant!.projectId));
    return service.acknowledgeGrantRefresh(sessionId, {
      projectRevision,
      bindingVersion,
      nativeBoundarySeq,
      sourceGeneration: grant!.sourceGeneration,
      d1Version: grant!.d1Version,
      policyDigest: project!.retentionDigest as string,
      ...overrides,
    }, ctx);
  };

  beforeEach(async () => {
    now = 1_700_000_000_000;
    fixture = createSessionContentFixture();
    await fixture.setup();
    fakeEpoch = createFakeContentAuthorityEpochPort();
    service = makeService();
    owner = await createAuthenticatedUser('editor');
    other = await createAuthenticatedUser('editor');
    outsider = await createAuthenticatedUser('editor');
    ctx = { tenantId: TENANT_A, principalId: owner.id, ownerId: owner.id };
    await db.insert(tenants).values([
      { id: TENANT_A, name: TENANT_A, status: 'active' },
      { id: TENANT_B, name: TENANT_B, status: 'active' },
    ]);
    await db.insert(tenantMemberships).values([
      { tenantId: TENANT_A, userId: owner.id, status: 'approved', role: 'admin' },
      { tenantId: TENANT_A, userId: other.id, status: 'approved', role: 'member' },
      { tenantId: TENANT_B, userId: outsider.id, status: 'approved', role: 'member' },
    ]);
    workspaceId = crypto.randomUUID();
    await db.insert(workspaces).values({
      id: workspaceId, ownerUserId: owner.id, name: 'Content project',
      type: 'code', tenantId: TENANT_A,
    });
    await db.insert(workspaceMemberships).values({
      workspaceId, userId: owner.id, role: 'admin',
    });
  });

  afterEach(async () => {
    await db.delete(sessionContentAttempts);
    await db.delete(sessionContentReservations);
    await db.delete(sessionContentObjects);
    await db.delete(sessionContentPurgeJobs);
    await db.delete(sessionContentHistoryAuthorizations);
    await db.delete(sessionContentGrants);
    await db.delete(sessionContentOfflineReceipts);
    await db.delete(sessionContentAdmissions);
    await db.delete(sessionContentTombstones);
    await db.delete(sessionContentNamespaces);
    await db.delete(sessionContentProjects);
    await db.delete(sessionWorkspaceBindings);
    await db.delete(workspaceMemberships).where(eq(workspaceMemberships.workspaceId, workspaceId));
    await db.delete(workspaces).where(eq(workspaces.id, workspaceId));
    await db.delete(tenantMemberships).where(
      inArray(tenantMemberships.userId, [owner.id, other.id, outsider.id]),
    );
    await db.delete(tenants).where(inArray(tenants.id, [TENANT_A, TENANT_B]));
    await cleanupAuthData();
    await fixture.cleanup();
  });

  const productContent = () => new Hono().route('/api/v1/auth/session/content',
    createSessionContentRouter({ content: service, websiteOrigin: 'http://localhost:5581' }));
  const browserHeaders = (user = owner) => ({ cookie: `session=${user.sessionToken}`,
    origin: 'http://localhost:5581', 'x-session-content': 'browser' });

  it('should expose product content metadata only to the current workspace member and owner', async () => {
    await adoptSession('product-content-owner');
    const router = productContent();
    const path = `/api/v1/auth/session/content/workspaces/${workspaceId}/sessions`;
    const response = await router.request(path, { headers: browserHeaders() });
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    const body = await response.json();
    expect(body).toMatchObject({ ownerId: owner.id, workspaceId, sourceVerified: false,
      credentials: [], eligibleSources: [], reason: 'unsupported_source' });
    expect(body.items).toMatchObject([{ sessionId: 'product-content-owner', liveAuthorized: false }]);
    const foreign = await router.request(path, { headers: browserHeaders(other) });
    expect(foreign.status).toBe(403);
    expect((await router.request(path)).status).toBe(401);
    expect((await router.request(path, { headers: { ...browserHeaders(), authorization: `Bearer ${owner.sessionToken}` } })).status).toBe(401);
    expect((await router.request(path, { headers: { ...browserHeaders(), origin: 'https://elsewhere.invalid' } })).status).toBe(403);
  });

  it('should refuse product content activation and attachment without reading an unverified source body', async () => {
    const router = productContent();
    for (const path of [`workspaces/${workspaceId}/attachments`, `workspaces/${workspaceId}/consent/prepare`,
      `workspaces/${workspaceId}/consent`, 'unknown/history-authorizations', 'unknown/keyboard/lease',
      'unknown/keyboard/prepare', 'unknown/keyboard/submissions']) {
      const response = await router.request(`/api/v1/auth/session/content/${path}`, {
        method: 'POST', headers: { ...browserHeaders(), 'content-type': 'application/json' },
        body: JSON.stringify({ ...basePolicy(), sourceVerified: true, human: true, bytes: 'forged' }),
      });
      expect(response.status).toBe(503);
      expect(await response.json()).toMatchObject({ error: 'unsupported_source', dispatch: 'not_attempted' });
    }
    expect((await db.select().from(sessionContentProjects))).toHaveLength(0);
    expect((await db.select().from(sessionWorkspaceBindings))).toHaveLength(0);
    expect(await fixture.listPhysical('')).toHaveLength(0);
    const source = await router.request('/api/v1/auth/session/content/unknown/source/segments', {
      method: 'POST', headers: browserHeaders(), body: 'never-source-authenticated-by-cookie',
    });
    expect(source.status).toBe(401);
    expect(await source.json()).toMatchObject({ error: 'source_auth_required' });
    const csrf = await router.request('/api/v1/auth/session/content/unknown/keyboard/submissions', {
      method: 'POST', headers: { cookie: `session=${owner.sessionToken}`, 'x-session-content': 'browser' },
    });
    expect(csrf.status).toBe(403);
  });

  it('should persist consent and survive service reinstantiation', async () => {
    const accepted = await acceptProject();
    expect(accepted.digest).toHaveLength(64);
    const restarted = makeService();
    const projects = await db
      .select()
      .from(sessionContentProjects)
      .where(eq(sessionContentProjects.projectId, accepted.projectId));
    expect(projects).toHaveLength(1);
    expect(projects[0]!.retentionDigest).toBe(accepted.digest);
    expect(projects[0]!.offlineReadAccepted).toBe(true);
    const receipts = await db
      .select()
      .from(sessionContentOfflineReceipts)
      .where(eq(sessionContentOfflineReceipts.projectId, accepted.projectId));
    expect(receipts).toHaveLength(1);
    expect(receipts[0]!.policyDigest).toBe(accepted.digest);
    void restarted;
  });

  it('should enforce CAS on project revision conflicts', async () => {
    await acceptProject();
    await expectContentError(
      () => acceptProject({ projectRevision: 5 }),
      'revision_conflict',
    );
    const amended = await service.amendProject(
      'sess-content-project-1',
      basePolicy({ ownerId: owner.id, readers: [owner.id], workspaceId }),
      ctx,
    );
    expect(amended.revision).toBe(1);
    await expectContentError(() => service.revokeProject('sess-content-project-1', {
      tenantId: TENANT_B, principalId: outsider.id, ownerId: outsider.id,
    }), 'cross_owner_refused');
    await expectContentError(() => service.revokeProject('sess-content-project-1', {
      tenantId: TENANT_A, principalId: 'ghost-principal', ownerId: owner.id,
    }), 'membership_required');
  });

  it('should refuse invalid, unsigned and altered retention maps', async () => {
    const cases: Array<{ retention: unknown; code: SessionContentError['code'] }> = [
      { retention: { 'terminal.cache': { mode: 'none' } }, code: 'unsigned_retention' },
      { retention: undefined, code: 'invalid_retention' },
      {
        retention: {
          'terminal.cache': { mode: 'duration', durationSeconds: 0 },
          'native.mirror': { mode: 'none' },
        },
        code: 'invalid_retention',
      },
      {
        retention: {
          'terminal.cache': { mode: 'duration', durationSeconds: -30 },
          'native.mirror': { mode: 'none' },
        },
        code: 'invalid_retention',
      },
      {
        retention: {
          'terminal.cache': { mode: 'duration', durationSeconds: 1.5 },
          'native.mirror': { mode: 'none' },
        },
        code: 'invalid_retention',
      },
      {
        retention: {
          'terminal.cache': { mode: 'duration', durationSeconds: Number.MAX_SAFE_INTEGER + 1 },
          'native.mirror': { mode: 'none' },
        },
        code: 'invalid_retention',
      },
      {
        retention: {
          'terminal.cache': { durationSeconds: 60 },
          'native.mirror': { mode: 'none' },
        },
        code: 'unsigned_retention',
      },
    ];
    for (const { retention, code } of cases) {
      await expectContentError(
        () => acceptProject({ retentionByChannel: retention }),
        code,
      );
    }
    const prepared = service.prepareProject(basePolicy({ ownerId: owner.id, readers: [owner.id] }));
    await expectContentError(
      () =>
        service.acceptProject(
          {
            ...prepared,
            policy: { ...prepared.policy, projectRevision: 99 },
            offlineReadAccepted: true,
          },
          ctx,
        ),
      'policy_digest_mismatch',
    );
    const state = await service.probeEmptyState(TENANT_A);
    expect(state.empty).toBe(true);
    expect(state.projects).toBe(0);
  });

  it('should derive grants with D1 binding fence and refuse mismatches', async () => {
    await acceptProject();
    const bindingId = await adoptSession('sess-content-s1');
    const bindings = await db
      .select()
      .from(sessionWorkspaceBindings)
      .where(eq(sessionWorkspaceBindings.sessionId, 'sess-content-s1'));
    const version = bindings[0]!.version;
    const derived = await service.deriveGrant({
      projectId: 'sess-content-project-1',
      sessionId: 'sess-content-s1',
      bindingId,
      bindingVersion: version,
      d1Version: version,
      d1Incarnation: 1,
      d1StartSeq: 0,
      workspaceId,
      sessionCreatedAt: now,
      sourceGeneration: 'gen-1',
      sourceTrustVersion: 'tv-1',
      nativeStartSeq: 0,
    }, ctx);
    expect(derived.version).toBe(1);
    await expectContentError(() => service.deriveGrant({
      projectId: 'sess-content-project-1',
      sessionId: 'sess-content-s1',
      bindingId,
      bindingVersion: version,
      d1Version: version,
      d1Incarnation: 1,
      d1StartSeq: 0,
      workspaceId,
      sessionCreatedAt: now,
      sourceGeneration: 'gen-1',
      sourceTrustVersion: 'tv-1',
      nativeStartSeq: 0,
    }, ctx), 'revision_conflict');
    await expectContentError(() => service.deriveGrant({
      projectId: 'sess-content-project-1',
      sessionId: 'sess-content-s2',
      bindingId: 'binding:stale',
      bindingVersion: 99,
      d1Version: 99,
      d1Incarnation: 1,
      d1StartSeq: 0,
      workspaceId,
      sessionCreatedAt: now,
      sourceGeneration: 'gen-1',
      sourceTrustVersion: 'tv-1',
      nativeStartSeq: 0,
    }, ctx), 'ineligible_session');
    await expectContentError(() => service.deriveGrant({
      projectId: 'sess-content-project-1',
      sessionId: 'sess-content-s1',
      bindingId,
      bindingVersion: version,
      d1Version: version,
      d1Incarnation: 1,
      d1StartSeq: 0,
      workspaceId,
      sessionCreatedAt: now,
      sourceGeneration: 'gen-9',
      sourceTrustVersion: 'tv-9',
      nativeStartSeq: 0,
    }, ctx), 'source_reauthorization_required');
  });

  it('should deny same-tenant non-owners, cross-tenant callers and revoked readers', async () => {
    await acceptProject();
    const bindingId = await adoptSession('sess-content-s1');
    const bindings = await db
      .select()
      .from(sessionWorkspaceBindings)
      .where(eq(sessionWorkspaceBindings.sessionId, 'sess-content-s1'));
    const input = {
      projectId: 'sess-content-project-1',
      sessionId: 'sess-content-s1',
      bindingId,
      bindingVersion: bindings[0]!.version,
      d1Version: bindings[0]!.version,
      d1Incarnation: 1,
      d1StartSeq: 0,
      workspaceId,
      sessionCreatedAt: now,
      sourceGeneration: 'gen-1',
      sourceTrustVersion: 'tv-1',
      nativeStartSeq: 0,
    };
    await service.deriveGrant(input, ctx);
    const memberCtx: SessionContentContext = {
      tenantId: TENANT_A, principalId: other.id, ownerId: other.id,
    };
    await expectContentError(() => service.deriveGrant({ ...input, sessionId: 'sess-content-s9' }, memberCtx), 'cross_owner_refused');
    await expectContentError(() => service.readCommitted('sess-content-s1', 'terminal.cache', memberCtx), 'cross_owner_refused');
    const outsiderCtx: SessionContentContext = {
      tenantId: TENANT_B, principalId: outsider.id, ownerId: outsider.id,
    };
    await expectContentError(() => service.readCommitted('sess-content-s1', 'terminal.cache', outsiderCtx), 'cross_owner_refused');
    await service.revokeGrant('sess-content-s1', ctx);
    await expectContentError(() => service.readCommitted('sess-content-s1', 'terminal.cache', ctx), 'grant_revoked');
    await expectContentError(() => service.reserveBeforeUpload('sess-content-s1', 'terminal.cache', { raw: 10, encoded: 10 }, 'k-late', ctx), 'grant_revoked');
  });

  it('should upload, publish and read committed bytes', async () => {
    await acceptProject();
    const bindingId = await adoptSession('sess-content-s1');
    const bindings = await db
      .select()
      .from(sessionWorkspaceBindings)
      .where(eq(sessionWorkspaceBindings.sessionId, 'sess-content-s1'));
    await service.deriveGrant({
      projectId: 'sess-content-project-1',
      sessionId: 'sess-content-s1',
      bindingId,
      bindingVersion: bindings[0]!.version,
      d1Version: bindings[0]!.version,
      d1Incarnation: 1,
      d1StartSeq: 0,
      workspaceId,
      sessionCreatedAt: now,
      sourceGeneration: 'gen-1',
      sourceTrustVersion: 'tv-1',
      nativeStartSeq: 0,
    }, ctx);
    const body = new TextEncoder().encode('live-terminal-bytes');
    const reserved = await service.reserveBeforeUpload(
      'sess-content-s1', 'terminal.cache', { raw: body.length, encoded: body.length }, 'k-1', ctx,
    );
    expect(reserved.duplicate).toBe(false);
    const published = await service.publishAfterUpload(reserved.reservationId, body, ctx);
    expect(published.expiresAt).toBeNull();
    const read = await service.readCommitted('sess-content-s1', 'terminal.cache', ctx);
    expect(new TextDecoder().decode(read)).toBe('live-terminal-bytes');
    const physical = await fixture.listPhysical('');
    expect(physical).toHaveLength(1);
    const usage = await service.accountUsage({ tenantId: TENANT_A });
    expect(usage.committedBytes).toBe(body.length);
    expect(usage.objectCount).toBe(1);
    const inventory = await service.listObjects(
      `scc:${TENANT_A}:${owner.id}:epoch-test-1`, null, 10, ctx,
    );
    expect(inventory.objects).toHaveLength(1);
    expect(inventory.nextCursor).toBeNull();
    await expectContentError(() => service.listObjects(
      `scc:${TENANT_B}:${outsider.id}:epoch-test-1`, null, 10, ctx,
    ), 'cross_prefix_refused');
    await fixture.assertAnonymousDenied(physical[0]!);
  });

  it('should deduplicate retries, conflict on changed bytes and charge unknown outcomes', async () => {
    await acceptProject();
    const bindingId = await adoptSession('sess-content-s1');
    const bindings = await db
      .select()
      .from(sessionWorkspaceBindings)
      .where(eq(sessionWorkspaceBindings.sessionId, 'sess-content-s1'));
    await service.deriveGrant({
      projectId: 'sess-content-project-1',
      sessionId: 'sess-content-s1',
      bindingId,
      bindingVersion: bindings[0]!.version,
      d1Version: bindings[0]!.version,
      d1Incarnation: 1,
      d1StartSeq: 0,
      workspaceId,
      sessionCreatedAt: now,
      sourceGeneration: 'gen-1',
      sourceTrustVersion: 'tv-1',
      nativeStartSeq: 0,
    }, ctx);
    const first = await service.reserveBeforeUpload(
      'sess-content-s1', 'terminal.cache', { raw: 8, encoded: 8 }, 'k-dup', ctx,
    );
    const retry = await service.reserveBeforeUpload(
      'sess-content-s1', 'terminal.cache', { raw: 8, encoded: 8 }, 'k-dup', ctx,
    );
    expect(retry.duplicate).toBe(true);
    expect(retry.reservationId).toBe(first.reservationId);
    await expectContentError(() => service.reserveBeforeUpload(
      'sess-content-s1', 'terminal.cache', { raw: 9, encoded: 9 }, 'k-dup', ctx,
    ), 'attempt_conflict');
    const unknown = await service.reserveBeforeUpload(
      'sess-content-s1', 'terminal.cache', { raw: 8, encoded: 8 }, 'k-unknown', ctx,
    );
    await service.markAttemptUnknown(unknown.reservationId, ctx);
    const usage = await service.accountUsage({ sessionId: 'sess-content-s1' });
    expect(usage.reservedBytes).toBe(16);
    const headBefore = await fixture.head('no-such-key');
    expect(headBefore).toBe('missing');
    await expectContentError(() => service.publishAfterUpload(
      unknown.reservationId, new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]), ctx,
    ), 'unknown_outcome');
  });

  it('should expire finite copies at their capture deadline without extension', async () => {
    await acceptProject({
      retentionByChannel: {
        'terminal.cache': { mode: 'duration', durationSeconds: 3600 },
        'native.mirror': { mode: 'none' },
      },
    });
    const bindingId = await adoptSession('sess-content-s1');
    const bindings = await db
      .select()
      .from(sessionWorkspaceBindings)
      .where(eq(sessionWorkspaceBindings.sessionId, 'sess-content-s1'));
    await service.deriveGrant({
      projectId: 'sess-content-project-1',
      sessionId: 'sess-content-s1',
      bindingId,
      bindingVersion: bindings[0]!.version,
      d1Version: bindings[0]!.version,
      d1Incarnation: 1,
      d1StartSeq: 0,
      workspaceId,
      sessionCreatedAt: now,
      sourceGeneration: 'gen-1',
      sourceTrustVersion: 'tv-1',
      nativeStartSeq: 0,
    }, ctx);
    const body = new TextEncoder().encode('finite-bytes');
    const reserved = await service.reserveBeforeUpload(
      'sess-content-s1', 'terminal.cache', { raw: body.length, encoded: body.length }, 'k-fin', ctx,
    );
    const published = await service.publishAfterUpload(reserved.reservationId, body, ctx);
    expect(published.expiresAt).toBe(now + 3_600_000);
    now += 3_600_000 + 1;
    await expectContentError(
      () => service.readCommitted('sess-content-s1', 'terminal.cache', ctx),
      'object_expired',
    );
    const mirrorReserved = await service.reserveBeforeUpload(
      'sess-content-s1', 'native.mirror', { raw: 4, encoded: 4 }, 'k-mirror', ctx,
    );
    const mirrorBody = new Uint8Array([9, 9, 9, 9]);
    const mirrorPublished = await service.publishAfterUpload(mirrorReserved.reservationId, mirrorBody, ctx);
    expect(mirrorPublished.expiresAt).toBeNull();
    const mirrorRead = await service.readCommitted('sess-content-s1', 'native.mirror', ctx);
    expect(mirrorRead).toEqual(mirrorBody);
    now += 10_000_000_000;
    const stillThere = await service.readCommitted('sess-content-s1', 'native.mirror', ctx);
    expect(stillThere).toEqual(mirrorBody);
  });

  it('should pause new capture at quota with prior objects preserved', async () => {
    service = makeService({ maxBytesPerSession: 32, maxBytesPerTenant: 48, maxObjectsPerSession: 8 });
    await acceptProject();
    const bindingId = await adoptSession('sess-content-s1');
    const bindings = await db
      .select()
      .from(sessionWorkspaceBindings)
      .where(eq(sessionWorkspaceBindings.sessionId, 'sess-content-s1'));
    await service.deriveGrant({
      projectId: 'sess-content-project-1',
      sessionId: 'sess-content-s1',
      bindingId,
      bindingVersion: bindings[0]!.version,
      d1Version: bindings[0]!.version,
      d1Incarnation: 1,
      d1StartSeq: 0,
      workspaceId,
      sessionCreatedAt: now,
      sourceGeneration: 'gen-1',
      sourceTrustVersion: 'tv-1',
      nativeStartSeq: 0,
    }, ctx);
    const first = await service.reserveBeforeUpload(
      'sess-content-s1', 'terminal.cache', { raw: 16, encoded: 16 }, 'k-q1', ctx,
    );
    await service.publishAfterUpload(first.reservationId, new Uint8Array(16), ctx);
    await expectContentError(() => service.reserveBeforeUpload(
      'sess-content-s1', 'terminal.cache', { raw: 17, encoded: 17 }, 'k-q2', ctx,
    ), 'quota_exceeded');
    const read = await service.readCommitted('sess-content-s1', 'terminal.cache', ctx);
    expect(read).toHaveLength(16);
    const concurrent = await Promise.all([0, 1, 2].map((index) =>
      service.reserveBeforeUpload(
        'sess-content-s1', 'native.mirror', { raw: 4, encoded: 4 }, `k-qc-${index}`, ctx,
      ),
    ));
    expect(concurrent).toHaveLength(3);
    const usage = await service.accountUsage({ sessionId: 'sess-content-s1' });
    expect(usage.committedBytes).toBe(16);
    expect(usage.reservedBytes).toBe(12);
  });

  it('should deny capture after membership withdrawal while retaining committed copies', async () => {
    await acceptProject();
    const bindingId = await adoptSession('sess-content-s1');
    const bindings = await db
      .select()
      .from(sessionWorkspaceBindings)
      .where(eq(sessionWorkspaceBindings.sessionId, 'sess-content-s1'));
    await service.deriveGrant({
      projectId: 'sess-content-project-1',
      sessionId: 'sess-content-s1',
      bindingId,
      bindingVersion: bindings[0]!.version,
      d1Version: bindings[0]!.version,
      d1Incarnation: 1,
      d1StartSeq: 0,
      workspaceId,
      sessionCreatedAt: now,
      sourceGeneration: 'gen-1',
      sourceTrustVersion: 'tv-1',
      nativeStartSeq: 0,
    }, ctx);
    const body = new TextEncoder().encode('retained-under-withdrawal');
    const reserved = await service.reserveBeforeUpload(
      'sess-content-s1', 'terminal.cache', { raw: body.length, encoded: body.length }, 'k-m1', ctx,
    );
    await service.publishAfterUpload(reserved.reservationId, body, ctx);
    await db.delete(tenantMemberships).where(
      and(eq(tenantMemberships.tenantId, TENANT_A), eq(tenantMemberships.userId, owner.id)),
    );
    await expectContentError(
      () => service.readCommitted('sess-content-s1', 'terminal.cache', ctx),
      'membership_required',
    );
    await expectContentError(() => service.reserveBeforeUpload(
      'sess-content-s1', 'terminal.cache', { raw: 4, encoded: 4 }, 'k-m2', ctx,
    ), 'membership_required');
    const usage = await service.accountUsage({ sessionId: 'sess-content-s1' });
    expect(usage.committedBytes).toBe(body.length);
    const handles = await service.listRetainedHandles(owner.id, TENANT_A);
    expect(handles).toHaveLength(1);
    expect(handles[0]!.retainedScopeId).toContain(bindingId);
    expect(handles[0]!.bytes).toBe(body.length);
    const router = productContent();
    const inventory = await router.request('/api/v1/auth/session/content/retained-content', { headers: browserHeaders() });
    expect(inventory.status).toBe(200);
    expect(await inventory.json()).toEqual({ items: handles });
    expect(Object.keys(handles[0]!).sort()).toEqual(['bindingId', 'bytes', 'retainedScopeId', 'status']);
    const cleanupPath = `/api/v1/auth/session/content/${bindingId}/consent?retainedScopeId=${encodeURIComponent(handles[0]!.retainedScopeId)}`;
    expect((await router.request(cleanupPath, { method: 'DELETE', headers: browserHeaders(other) })).status).toBe(404);
    expect((await router.request(cleanupPath.replace(bindingId, 'wrong-binding'), { method: 'DELETE', headers: browserHeaders() })).status).toBe(404);
    expect((await fixture.listPhysical('')).length).toBe(1);
    const foreignHandles = await service.listRetainedHandles(other.id, TENANT_A);
    expect(foreignHandles).toHaveLength(0);
    const purged = await service.requestRetainedPurge(handles[0]!.retainedScopeId, owner.id);
    expect(purged.deletedObjects).toBe(1);
    expect(purged.remainingObjects).toBe(0);
    const physical = await fixture.listPhysical('');
    expect(physical).toHaveLength(0);
    const [fenced] = await db.select().from(sessionContentGrants)
      .where(eq(sessionContentGrants.sessionId, 'sess-content-s1'));
    expect(fenced?.state).toBe('revoked');
    await expectContentError(
      () => service.requestRetainedPurge(handles[0]!.retainedScopeId, other.id),
      'cross_owner_refused',
    );
  });

  it.each(['purge', 'revoke', 'exclude', 'project'] as const)('should apply product content %s without source contact and preserve D1', async (action) => {
    await acceptProject();
    const bindingId = await adoptSession('product-content-purge');
    const [binding] = await db.select().from(sessionWorkspaceBindings)
      .where(eq(sessionWorkspaceBindings.bindingId, bindingId));
    await service.deriveGrant({ projectId: 'sess-content-project-1', sessionId: 'product-content-purge',
      bindingId, bindingVersion: binding!.version, d1Version: binding!.version, d1Incarnation: 1,
      d1StartSeq: 0, workspaceId, sessionCreatedAt: now, sourceGeneration: 'gen-1',
      sourceTrustVersion: 'tv-1', nativeStartSeq: 0 }, ctx);
    const bytes = new TextEncoder().encode('origin-owned-route-copy');
    const reserved = await service.reserveBeforeUpload('product-content-purge', 'terminal.cache',
      { raw: bytes.length, encoded: bytes.length }, 'product-content-purge', ctx);
    await service.publishAfterUpload(reserved.reservationId, bytes, ctx);
    if (action === 'purge') await db.delete(workspaceMemberships).where(and(
      eq(workspaceMemberships.workspaceId, workspaceId), eq(workspaceMemberships.userId, owner.id)));
    const router = productContent();
    const inventory = await router.request('/api/v1/auth/session/content/retained-content', { headers: browserHeaders() });
    const { items } = await inventory.json();
    const suffix = action === 'purge' ? `consent?retainedScopeId=${encodeURIComponent(items[0].retainedScopeId)}`
      : action === 'revoke' ? 'consent' : 'exclusion';
    const target = action === 'project' ? `workspaces/${workspaceId}/consent` : `${bindingId}/${suffix}`;
    const response = await router.request(`/api/v1/auth/session/content/${target}`,
      { method: action === 'exclude' ? 'PUT' : 'DELETE',
        headers: { ...browserHeaders(), 'content-type': 'application/json' },
        ...(action === 'exclude' ? { body: JSON.stringify({ excluded: true }) } : {}) });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ complete: true });
    expect(await fixture.listPhysical('')).toHaveLength(0);
    expect((await db.select().from(sessionContentGrants)
      .where(eq(sessionContentGrants.sessionId, 'product-content-purge')))[0]?.state).toBe(action === 'exclude' ? 'excluded' : 'revoked');
    if (action === 'exclude') expect((await db.select().from(sessionContentProjects)
      .where(eq(sessionContentProjects.projectId, 'sess-content-project-1')))[0]?.excludedSessionIds).toContain('product-content-purge');
    expect((await db.select().from(sessionWorkspaceBindings)
      .where(eq(sessionWorkspaceBindings.bindingId, bindingId)))[0]?.status).toBe('attached');
  });

  it('should close live on D1 detach/end, retain copies and require history authority', async () => {
    await acceptProject();
    const adopting = new SessionWorkspaceService(undefined, null);
    const first = await adopting.adopt({
      sessionId: 'sess-content-s1', tenantId: TENANT_A, principalId: owner.id, workspaceId,
    });
    await service.deriveGrant({
      projectId: 'sess-content-project-1',
      sessionId: 'sess-content-s1',
      bindingId: first.bindingId,
      bindingVersion: first.version,
      d1Version: first.version,
      d1Incarnation: 1,
      d1StartSeq: 0,
      workspaceId,
      sessionCreatedAt: now,
      sourceGeneration: 'gen-1',
      sourceTrustVersion: 'tv-1',
      nativeStartSeq: 0,
    }, ctx);
    const body = new TextEncoder().encode('closed-copy-bytes');
    const reserved = await service.reserveBeforeUpload(
      'sess-content-s1', 'terminal.cache', { raw: body.length, encoded: body.length }, 'k-c1', ctx,
    );
    await service.publishAfterUpload(reserved.reservationId, body, ctx);
    const closed = await service.closeGrant('sess-content-s1', ctx);
    expect(closed.retainedCopies).toBe(true);
    await expectContentError(
      () => service.readCommitted('sess-content-s1', 'terminal.cache', ctx),
      'history_authorization_required',
    );
    const authorization = await service.grantHistoryAuthorization('sess-content-s1', ctx);
    expect(authorization.ceilings['terminal.cache']).toBeNull();
    const read = await service.readCommitted(
      'sess-content-s1', 'terminal.cache', ctx, authorization.authorizationId,
    );
    expect(new TextDecoder().decode(read)).toBe('closed-copy-bytes');
    await adopting.detach('sess-content-s1', TENANT_A, owner.id);
    const reattached = await adopting.adopt({
      sessionId: 'sess-content-s1', tenantId: TENANT_A, principalId: owner.id, workspaceId,
    });
    expect(reattached.version).toBeGreaterThan(first.version);
    await expectContentError(() => service.deriveGrant({
      projectId: 'sess-content-project-1',
      sessionId: 'sess-content-s1',
      bindingId: first.bindingId,
      bindingVersion: first.version,
      d1Version: first.version,
      d1Incarnation: 1,
      d1StartSeq: 0,
      workspaceId,
      sessionCreatedAt: now,
      sourceGeneration: 'gen-1',
      sourceTrustVersion: 'tv-1',
      nativeStartSeq: 0,
    }, ctx), 'ineligible_session');
    const newCtx: SessionContentContext = {
      tenantId: TENANT_A, principalId: other.id, ownerId: other.id,
    };
    await expectContentError(
      () => service.readCommitted('sess-content-s1', 'terminal.cache', newCtx, authorization.authorizationId),
      'cross_owner_refused',
    );
  });

  it('should purge history scope on authorization revoke without viewer-close purge', async () => {
    await acceptProject();
    await adoptSession('sess-content-s1');
    const bindings = await db
      .select()
      .from(sessionWorkspaceBindings)
      .where(eq(sessionWorkspaceBindings.sessionId, 'sess-content-s1'));
    await service.deriveGrant({
      projectId: 'sess-content-project-1',
      sessionId: 'sess-content-s1',
      bindingId: bindings[0]!.bindingId,
      bindingVersion: bindings[0]!.version,
      d1Version: bindings[0]!.version,
      d1Incarnation: 1,
      d1StartSeq: 0,
      workspaceId,
      sessionCreatedAt: now,
      sourceGeneration: 'gen-1',
      sourceTrustVersion: 'tv-1',
      nativeStartSeq: 0,
    }, ctx);
    const body = new TextEncoder().encode('history-bytes');
    const reserved = await service.reserveBeforeUpload(
      'sess-content-s1', 'terminal.cache', { raw: body.length, encoded: body.length }, 'k-h1', ctx,
    );
    await service.publishAfterUpload(reserved.reservationId, body, ctx);
    await service.closeGrant('sess-content-s1', ctx);
    const first = await service.grantHistoryAuthorization('sess-content-s1', ctx);
    const second = await service.grantHistoryAuthorization('sess-content-s1', ctx);
    await service.revokeHistoryAuthorization(first.authorizationId, ctx);
    await expectContentError(
      () => service.readCommitted('sess-content-s1', 'terminal.cache', ctx, first.authorizationId),
      'history_authorization_revoked',
    );
    await expectContentError(
      () => service.readCommitted('sess-content-s1', 'terminal.cache', ctx, second.authorizationId),
      'not_found',
    );
    const jobs = await db.select().from(sessionContentPurgeJobs);
    expect(jobs.length).toBeGreaterThan(0);
    const purged = await service.runPurge(jobs[0]!.purgeJobId);
    expect(purged.remainingObjects).toBe(0);
    expect(await fixture.listPhysical('')).toHaveLength(0);
  });

  it('should fence and purge on tenant DELETE with surviving tombstones', async () => {
    await acceptProject();
    await adoptSession('sess-content-s1');
    const bindings = await db
      .select()
      .from(sessionWorkspaceBindings)
      .where(eq(sessionWorkspaceBindings.sessionId, 'sess-content-s1'));
    await service.deriveGrant({
      projectId: 'sess-content-project-1',
      sessionId: 'sess-content-s1',
      bindingId: bindings[0]!.bindingId,
      bindingVersion: bindings[0]!.version,
      d1Version: bindings[0]!.version,
      d1Incarnation: 1,
      d1StartSeq: 0,
      workspaceId,
      sessionCreatedAt: now,
      sourceGeneration: 'gen-1',
      sourceTrustVersion: 'tv-1',
      nativeStartSeq: 0,
    }, ctx);
    const body = new TextEncoder().encode('tenant-scoped-bytes');
    const reserved = await service.reserveBeforeUpload(
      'sess-content-s1', 'terminal.cache', { raw: body.length, encoded: body.length }, 'k-t1', ctx,
    );
    await service.publishAfterUpload(reserved.reservationId, body, ctx);
    await db.delete(workspaces).where(eq(workspaces.id, workspaceId));
    await db.delete(tenants).where(eq(tenants.id, TENANT_A));
    const grants = await db
      .select()
      .from(sessionContentGrants)
      .where(eq(sessionContentGrants.sessionId, 'sess-content-s1'));
    expect(grants[0]!.state).toBe('revoked');
    const tombs = await db
      .select()
      .from(sessionContentTombstones)
      .where(
        and(eq(sessionContentTombstones.kind, 'tenant'), eq(sessionContentTombstones.publicId, TENANT_A)),
    );
    expect(tombs).toHaveLength(1);
    await expectContentError(() => service.reserveBeforeUpload(
      'sess-content-s1', 'terminal.cache', { raw: 4, encoded: 4 }, 'k-t2', ctx,
    ), 'membership_required');
    const jobs = await db.select().from(sessionContentPurgeJobs);
    expect(jobs.length).toBeGreaterThan(0);
    const purged = await service.runPurge(jobs[0]!.purgeJobId);
    expect(purged.deletedObjects).toBe(1);
    expect(purged.remainingObjects).toBe(0);
    expect(await fixture.listPhysical('')).toHaveLength(0);
    await db.insert(tenants).values({ id: TENANT_A, name: TENANT_A, status: 'active' });
    await db.insert(tenantMemberships).values({
      tenantId: TENANT_A, userId: owner.id, status: 'approved', role: 'admin',
    });
    await expectContentError(() => service.deriveGrant({
      projectId: 'sess-content-project-1',
      sessionId: 'sess-content-s1',
      bindingId: bindings[0]!.bindingId,
      bindingVersion: bindings[0]!.version,
      d1Version: bindings[0]!.version,
      d1Incarnation: 1,
      d1StartSeq: 0,
      workspaceId,
      sessionCreatedAt: now,
      sourceGeneration: 'gen-1',
      sourceTrustVersion: 'tv-1',
      nativeStartSeq: 0,
    }, ctx), 'tombstoned_scope');
  });

  it('should fence on tenant offboard status and leave empty scopes untouched', async () => {
    const emptyBefore = await service.probeEmptyState(TENANT_B);
    expect(emptyBefore.empty).toBe(true);
    await db.delete(tenants).where(eq(tenants.id, TENANT_B));
    const emptyAfter = await service.probeEmptyState(TENANT_B);
    expect(emptyAfter.empty).toBe(true);
    expect(emptyAfter.namespaces).toBe(0);
    expect(emptyAfter.purgeJobs).toBe(0);
    const tombs = await db.select().from(sessionContentTombstones);
    expect(tombs).toHaveLength(0);
    await db.insert(tenants).values({ id: TENANT_B, name: TENANT_B, status: 'active' });
    await acceptProject();
    await db
      .update(tenants)
      .set({ status: 'offboarded' })
      .where(eq(tenants.id, TENANT_A));
    const projects = await db
      .select()
      .from(sessionContentProjects)
      .where(eq(sessionContentProjects.projectId, 'sess-content-project-1'));
    expect(projects).toHaveLength(1);
    const offboardTombs = await db
      .select()
      .from(sessionContentTombstones)
      .where(eq(sessionContentTombstones.kind, 'tenant'));
    expect(offboardTombs).toHaveLength(1);
    await expectContentError(() => service.amendProject(
      'sess-content-project-1',
      basePolicy({ ownerId: owner.id, readers: [owner.id] }),
      ctx,
    ), 'membership_required');
    const triggers = await db.execute(sql`
      SELECT tgname FROM pg_trigger
      WHERE tgname IN (
        'session_content_fence_tenant_delete_trigger',
        'session_content_fence_user_delete_trigger',
        'session_content_fence_workspace_delete_trigger',
        'session_content_fence_tenant_offboard_trigger'
      )
    `);
    expect(triggers.rows).toHaveLength(4);
    const functions = await db.execute(sql`
      SELECT proname FROM pg_proc
      WHERE proname IN (
        'session_content_fence_tenant_delete',
        'session_content_fence_user_delete',
        'session_content_fence_workspace_delete',
        'session_content_fence_tenant_offboard'
      )
    `);
    expect(functions.rows).toHaveLength(4);
  });

  it('should isolate user deletion per owner prefix across two tenants', async () => {
    await acceptProject();
    await adoptSession('sess-content-s1');
    const bindings = await db
      .select()
      .from(sessionWorkspaceBindings)
      .where(eq(sessionWorkspaceBindings.sessionId, 'sess-content-s1'));
    await service.deriveGrant({
      projectId: 'sess-content-project-1',
      sessionId: 'sess-content-s1',
      bindingId: bindings[0]!.bindingId,
      bindingVersion: bindings[0]!.version,
      d1Version: bindings[0]!.version,
      d1Incarnation: 1,
      d1StartSeq: 0,
      workspaceId,
      sessionCreatedAt: now,
      sourceGeneration: 'gen-1',
      sourceTrustVersion: 'tv-1',
      nativeStartSeq: 0,
    }, ctx);
    const body = new TextEncoder().encode('owner-prefix-bytes');
    const reserved = await service.reserveBeforeUpload(
      'sess-content-s1', 'terminal.cache', { raw: body.length, encoded: body.length }, 'k-u1', ctx,
    );
    await service.publishAfterUpload(reserved.reservationId, body, ctx);
    await db.delete(users).where(eq(users.id, other.id));
    const namespaces = await db.select().from(sessionContentNamespaces);
    expect(namespaces).toHaveLength(1);
    expect(namespaces[0]!.ownerId).toBe(owner.id);
    await db.delete(users).where(eq(users.id, owner.id));
    const revoked = await db
      .select()
      .from(sessionContentGrants)
      .where(eq(sessionContentGrants.sessionId, 'sess-content-s1'));
    expect(revoked[0]!.state).toBe('revoked');
    const userTombs = await db
      .select()
      .from(sessionContentTombstones)
      .where(eq(sessionContentTombstones.kind, 'user'));
    expect(userTombs.map((t) => t.publicId)).toContain(owner.id);
    const jobs = await db.select().from(sessionContentPurgeJobs);
    const restarted = makeService();
    void restarted;
    const purged = await service.runPurge(jobs[0]!.purgeJobId);
    expect(purged.remainingObjects).toBe(0);
    expect(await fixture.listPhysical('')).toHaveLength(0);
  });

  it('should revoke shared bindings on workspace deletion only for intended scope', async () => {
    await acceptProject();
    await adoptSession('sess-content-s1');
    const bindings = await db
      .select()
      .from(sessionWorkspaceBindings)
      .where(eq(sessionWorkspaceBindings.sessionId, 'sess-content-s1'));
    await service.deriveGrant({
      projectId: 'sess-content-project-1',
      sessionId: 'sess-content-s1',
      bindingId: bindings[0]!.bindingId,
      bindingVersion: bindings[0]!.version,
      d1Version: bindings[0]!.version,
      d1Incarnation: 1,
      d1StartSeq: 0,
      workspaceId,
      sessionCreatedAt: now,
      sourceGeneration: 'gen-1',
      sourceTrustVersion: 'tv-1',
      nativeStartSeq: 0,
    }, ctx);
    await db.delete(workspaces).where(eq(workspaces.id, workspaceId));
    const grants = await db
      .select()
      .from(sessionContentGrants)
      .where(eq(sessionContentGrants.sessionId, 'sess-content-s1'));
    expect(grants[0]!.state).toBe('revoked');
    const wsTombs = await db
      .select()
      .from(sessionContentTombstones)
      .where(
        and(eq(sessionContentTombstones.kind, 'workspace'), eq(sessionContentTombstones.publicId, workspaceId)),
      );
    expect(wsTombs).toHaveLength(1);
  });

  it('should refuse storage_unavailable with zero S3 calls when D2 storage is unset', async () => {
    process.env.DOC_STORAGE_BUCKET = 'sentropic-docs-test';
    process.env.DOC_STORAGE_ENDPOINT = 'http://minio:9000';
    const unconfigured = new SessionContentService({ nowMs: () => now, issuer: 'test-issuer', epochs: fakeEpoch });
    await expectContentError(
      () => unconfigured.readCommitted('sess-content-s1', 'terminal.cache', ctx),
      'storage_unavailable',
    );
    await expectContentError(
      () => unconfigured.runPurge('purge:missing'),
      'storage_unavailable',
    );
    expect(await fixture.listPhysical('')).toHaveLength(0);
    delete process.env.DOC_STORAGE_BUCKET;
    delete process.env.DOC_STORAGE_ENDPOINT;
  });

  it('should not fabricate a namespace from login admission alone', async () => {
    const admission = await service.recordAdmission({
      authSessionId: 'auth-session-1',
      tokenHash: 'hash-1',
      credentialId: 'cred-1',
      origin: 'http://localhost:5581',
      userVerified: true,
    });
    expect(await service.checkAdmission('auth-session-1', 'cred-1')).toBe(true);
    expect(await service.checkAdmission('auth-session-1', 'cred-unknown')).toBe(false);
    await expectContentError(
      () => service.recordAdmission({
        authSessionId: 'auth-session-2',
        tokenHash: 'hash-2',
        credentialId: 'cred-2',
        origin: 'http://localhost:5581',
        userVerified: false,
      }),
      'invalid_request',
    );
    const state = await service.probeEmptyState(TENANT_A);
    expect(state.empty).toBe(true);
    expect(state.namespaces).toBe(0);
    void admission;
  });

  it('should fence old namespaces on epoch rotation and require fresh consent', async () => {
    await acceptProject();
    await adoptSession('sess-content-s1');
    const bindings = await db
      .select()
      .from(sessionWorkspaceBindings)
      .where(eq(sessionWorkspaceBindings.sessionId, 'sess-content-s1'));
    await service.deriveGrant({
      projectId: 'sess-content-project-1',
      sessionId: 'sess-content-s1',
      bindingId: bindings[0]!.bindingId,
      bindingVersion: bindings[0]!.version,
      d1Version: bindings[0]!.version,
      d1Incarnation: 1,
      d1StartSeq: 0,
      workspaceId,
      sessionCreatedAt: now,
      sourceGeneration: 'gen-1',
      sourceTrustVersion: 'tv-1',
      nativeStartSeq: 0,
    }, ctx);
    const body = new TextEncoder().encode('pre-rotation-bytes');
    const reserved = await service.reserveBeforeUpload(
      'sess-content-s1', 'terminal.cache', { raw: body.length, encoded: body.length }, 'k-e1', ctx,
    );
    await service.publishAfterUpload(reserved.reservationId, body, ctx);
    const oldNamespace = `scc:${TENANT_A}:${owner.id}:epoch-test-1`;
    await service.fenceForRestore(oldNamespace);
    fakeEpoch.rotate('epoch-test-2');
    await expectContentError(() => service.reserveBeforeUpload(
      'sess-content-s1', 'terminal.cache', { raw: 4, encoded: 4 }, 'k-e2', ctx,
    ), 'grant_revoked');
    const jobs = await db
      .select()
      .from(sessionContentPurgeJobs)
      .where(eq(sessionContentPurgeJobs.namespaceId, oldNamespace));
    expect(jobs).toHaveLength(1);
    const purged = await service.runPurge(jobs[0]!.purgeJobId);
    expect(purged.deletedObjects).toBe(1);
    expect(purged.remainingObjects).toBe(0);
    expect(await fixture.listPhysical('')).toHaveLength(0);
    const namespaces = await db
      .select()
      .from(sessionContentNamespaces)
      .where(eq(sessionContentNamespaces.namespaceId, oldNamespace));
    expect(namespaces[0]!.status).toBe('purged');
    fakeEpoch.setUnavailable();
    await expectContentError(() => service.deriveGrant({
      projectId: 'sess-content-project-1',
      sessionId: 'sess-content-s9',
      bindingId: 'binding:missing',
      bindingVersion: 1,
      d1Version: 1,
      d1Incarnation: 1,
      d1StartSeq: 0,
      workspaceId,
      sessionCreatedAt: now,
      sourceGeneration: 'gen-1',
      sourceTrustVersion: 'tv-1',
      nativeStartSeq: 0,
    }, ctx), 'epoch_unavailable');
  });

  it('should reconcile local-only deny on reconnect without purging copies', async () => {
    await acceptProject();
    await adoptSession('sess-content-s1');
    const bindings = await db
      .select()
      .from(sessionWorkspaceBindings)
      .where(eq(sessionWorkspaceBindings.sessionId, 'sess-content-s1'));
    await service.deriveGrant({
      projectId: 'sess-content-project-1',
      sessionId: 'sess-content-s1',
      bindingId: bindings[0]!.bindingId,
      bindingVersion: bindings[0]!.version,
      d1Version: bindings[0]!.version,
      d1Incarnation: 1,
      d1StartSeq: 0,
      workspaceId,
      sessionCreatedAt: now,
      sourceGeneration: 'gen-1',
      sourceTrustVersion: 'tv-1',
      nativeStartSeq: 0,
    }, ctx);
    const body = new TextEncoder().encode('local-deny-bytes');
    const reserved = await service.reserveBeforeUpload(
      'sess-content-s1', 'terminal.cache', { raw: body.length, encoded: body.length }, 'k-d1', ctx,
    );
    await service.publishAfterUpload(reserved.reservationId, body, ctx);
    await service.recordLocalDeny('sess-content-s1', ctx);
    const reconciled = await service.reconcileLocalDeny('sess-content-s1', ctx);
    expect(reconciled.reconciled).toBe(true);
    const usage = await service.accountUsage({ sessionId: 'sess-content-s1' });
    expect(usage.committedBytes).toBe(body.length);
    await expectContentError(
      () => service.readCommitted('sess-content-s1', 'terminal.cache', ctx),
      'grant_revoked',
    );
  });

  it('should refuse reads when the authority is unavailable or stale (M1)', async () => {
    await acceptProject();
    const bindingId = await adoptSession('sess-content-s1');
    const bindings = await db
      .select()
      .from(sessionWorkspaceBindings)
      .where(eq(sessionWorkspaceBindings.sessionId, 'sess-content-s1'));
    await service.deriveGrant({
      projectId: 'sess-content-project-1',
      sessionId: 'sess-content-s1',
      bindingId,
      bindingVersion: bindings[0]!.version,
      d1Version: bindings[0]!.version,
      d1Incarnation: 1,
      d1StartSeq: 0,
      workspaceId,
      sessionCreatedAt: now,
      sourceGeneration: 'gen-1',
      sourceTrustVersion: 'tv-1',
      nativeStartSeq: 0,
    }, ctx);
    const body = new TextEncoder().encode('epoch-fenced-bytes');
    const reserved = await service.reserveBeforeUpload(
      'sess-content-s1', 'terminal.cache', { raw: body.length, encoded: body.length }, 'k-m1e', ctx,
    );
    await service.publishAfterUpload(reserved.reservationId, body, ctx);
    fakeEpoch.setUnavailable();
    await expectContentError(
      () => service.readCommitted('sess-content-s1', 'terminal.cache', ctx),
      'epoch_unavailable',
    );
    fakeEpoch.restore({ epoch: 'epoch-test-1', revision: 1, enabled: true, validUntil: Number.MAX_SAFE_INTEGER });
    fakeEpoch.expireRead();
    await expectContentError(
      () => service.readCommitted('sess-content-s1', 'terminal.cache', ctx),
      'epoch_stale',
    );
  });

  it('should refuse reserve/publish/read after rotation without restore fencing (M1)', async () => {
    await acceptProject();
    const bindingId = await adoptSession('sess-content-s1');
    const bindings = await db
      .select()
      .from(sessionWorkspaceBindings)
      .where(eq(sessionWorkspaceBindings.sessionId, 'sess-content-s1'));
    await service.deriveGrant({
      projectId: 'sess-content-project-1',
      sessionId: 'sess-content-s1',
      bindingId,
      bindingVersion: bindings[0]!.version,
      d1Version: bindings[0]!.version,
      d1Incarnation: 1,
      d1StartSeq: 0,
      workspaceId,
      sessionCreatedAt: now,
      sourceGeneration: 'gen-1',
      sourceTrustVersion: 'tv-1',
      nativeStartSeq: 0,
    }, ctx);
    const body = new TextEncoder().encode('pre-rotation-live');
    const reserved = await service.reserveBeforeUpload(
      'sess-content-s1', 'terminal.cache', { raw: body.length, encoded: body.length }, 'k-m1r', ctx,
    );
    await service.publishAfterUpload(reserved.reservationId, body, ctx);
    const inFlight = await service.reserveBeforeUpload(
      'sess-content-s1', 'terminal.cache', { raw: 4, encoded: 4 }, 'k-m1f', ctx,
    );
    fakeEpoch.rotate('epoch-test-2');
    await expectContentError(() => service.reserveBeforeUpload(
      'sess-content-s1', 'terminal.cache', { raw: 4, encoded: 4 }, 'k-m1n', ctx,
    ), 'epoch_mismatch');
    await expectContentError(() => service.publishAfterUpload(
      inFlight.reservationId, new Uint8Array([1, 2, 3, 4]), ctx,
    ), 'epoch_mismatch');
    await expectContentError(
      () => service.readCommitted('sess-content-s1', 'terminal.cache', ctx),
      'epoch_mismatch',
    );
    const grants = await db
      .select()
      .from(sessionContentGrants)
      .where(eq(sessionContentGrants.sessionId, 'sess-content-s1'));
    expect(grants[0]!.authorityEpoch).toBe('epoch-test-1');
  });

  it('should publish nothing when revoked between upload and commit (M2)', async () => {
    await acceptProject();
    const bindingId = await adoptSession('sess-content-s1');
    const bindings = await db
      .select()
      .from(sessionWorkspaceBindings)
      .where(eq(sessionWorkspaceBindings.sessionId, 'sess-content-s1'));
    await service.deriveGrant({
      projectId: 'sess-content-project-1',
      sessionId: 'sess-content-s1',
      bindingId,
      bindingVersion: bindings[0]!.version,
      d1Version: bindings[0]!.version,
      d1Incarnation: 1,
      d1StartSeq: 0,
      workspaceId,
      sessionCreatedAt: now,
      sourceGeneration: 'gen-1',
      sourceTrustVersion: 'tv-1',
      nativeStartSeq: 0,
    }, ctx);
    const body = new TextEncoder().encode('in-flight-revoked');
    const reserved = await service.reserveBeforeUpload(
      'sess-content-s1', 'terminal.cache', { raw: body.length, encoded: body.length }, 'k-m2b', ctx,
    );
    const publishing = makeService({
      publishHooks: {
        afterUpload: async () => {
          await service.revokeGrant('sess-content-s1', ctx);
        },
      },
    });
    await expectContentError(() => publishing.publishAfterUpload(
      reserved.reservationId, body, ctx,
    ), 'grant_revoked');
    const committed = await db
      .select()
      .from(sessionContentObjects)
      .where(
        and(
          eq(sessionContentObjects.sessionId, 'sess-content-s1'),
          eq(sessionContentObjects.state, 'committed'),
        ),
      );
    expect(committed).toHaveLength(0);
    const staged = await db
      .select()
      .from(sessionContentObjects)
      .where(
        and(
          eq(sessionContentObjects.sessionId, 'sess-content-s1'),
          eq(sessionContentObjects.state, 'purge_pending'),
        ),
      );
    expect(staged).toHaveLength(1);
    const usage = await service.accountUsage({ sessionId: 'sess-content-s1' });
    expect(usage.pendingDeletionBytes).toBe(body.length);
    const jobs = await db
      .select()
      .from(sessionContentPurgeJobs)
      .where(eq(sessionContentPurgeJobs.bindingId, bindingId));
    expect(jobs.length).toBeGreaterThan(0);
    const purged = await service.runPurge(jobs[0]!.purgeJobId);
    expect(purged.remainingObjects).toBe(0);
    expect(await fixture.listPhysical('')).toHaveLength(0);
  });

  it('should enforce O1=D scope on derive: workspace, status, principal, eligibility (M3)', async () => {
    await acceptProject();
    const bindingId = await adoptSession('sess-content-s1');
    const bindings = await db
      .select()
      .from(sessionWorkspaceBindings)
      .where(eq(sessionWorkspaceBindings.sessionId, 'sess-content-s1'));
    const otherCtx: SessionContentContext = {
      tenantId: TENANT_A, principalId: other.id, ownerId: other.id,
    };
    const base = {
      projectId: 'sess-content-project-1',
      sessionId: 'sess-content-s1',
      bindingId,
      bindingVersion: bindings[0]!.version,
      d1Version: bindings[0]!.version,
      d1Incarnation: 1,
      d1StartSeq: 0,
      workspaceId,
      sessionCreatedAt: now,
      sourceGeneration: 'gen-1',
      sourceTrustVersion: 'tv-1',
      nativeStartSeq: 0,
    };
    await expectContentError(() => service.deriveGrant(base, otherCtx), 'cross_owner_refused');
    await acceptProject({ projectId: 'sess-content-project-other' }, otherCtx);
    await expectContentError(() => service.deriveGrant(
      { ...base, projectId: 'sess-content-project-other' }, otherCtx,
    ), 'cross_owner_refused');
    await db
      .update(sessionWorkspaceBindings)
      .set({ status: 'detached' })
      .where(eq(sessionWorkspaceBindings.sessionId, 'sess-content-s1'));
    await expectContentError(() => service.deriveGrant(base, ctx), 'ineligible_session');
    await db
      .update(sessionWorkspaceBindings)
      .set({ status: 'ended' })
      .where(eq(sessionWorkspaceBindings.sessionId, 'sess-content-s1'));
    await expectContentError(() => service.deriveGrant(base, ctx), 'ineligible_session');
    await db
      .update(sessionWorkspaceBindings)
      .set({ status: 'attached' })
      .where(eq(sessionWorkspaceBindings.sessionId, 'sess-content-s1'));
    await expectContentError(
      () => service.deriveGrant({ ...base, workspaceId: 'workspace:foreign' }, ctx),
      'invalid_request',
    );
    await expectContentError(
      () => service.deriveGrant({ ...base, d1Incarnation: -1 }, ctx),
      'invalid_request',
    );
    await expectContentError(
      () => service.deriveGrant({ ...base, d1StartSeq: 1.5 }, ctx),
      'invalid_request',
    );
  });

  it('should refuse derivation outside future/selected scope (M3)', async () => {
    await acceptProject({ futureSessions: false, selectedSessionIds: [] });
    const bindingId = await adoptSession('sess-content-s1');
    const bindings = await db
      .select()
      .from(sessionWorkspaceBindings)
      .where(eq(sessionWorkspaceBindings.sessionId, 'sess-content-s1'));
    await expectContentError(() => service.deriveGrant({
      projectId: 'sess-content-project-1',
      sessionId: 'sess-content-s1',
      bindingId,
      bindingVersion: bindings[0]!.version,
      d1Version: bindings[0]!.version,
      d1Incarnation: 1,
      d1StartSeq: 0,
      workspaceId,
      sessionCreatedAt: now,
      sourceGeneration: 'gen-1',
      sourceTrustVersion: 'tv-1',
      nativeStartSeq: 0,
    }, ctx), 'ineligible_session');
    await service.amendProject(
      'sess-content-project-1',
      basePolicy({
        ownerId: owner.id,
        readers: [owner.id],
        workspaceId,
        futureSessions: false,
        selectedSessionIds: ['sess-content-s1'],
      }),
      ctx,
    );
    const derived = await service.deriveGrant({
      projectId: 'sess-content-project-1',
      sessionId: 'sess-content-s1',
      bindingId,
      bindingVersion: bindings[0]!.version,
      d1Version: bindings[0]!.version,
      d1Incarnation: 1,
      d1StartSeq: 0,
      workspaceId,
      sessionCreatedAt: now,
      sourceGeneration: 'gen-1',
      sourceTrustVersion: 'tv-1',
      nativeStartSeq: 0,
    }, ctx);
    expect(derived.version).toBe(1);
  });

  it('should let exactly one concurrent amendment win at the same revision (M4/N2)', async () => {
    await acceptProject();
    const policyFor = () => basePolicy({
      ownerId: owner.id, readers: [owner.id], workspaceId, futureSessions: false,
      projectRevision: 0,
    });
    const outcomes = await Promise.allSettled([
      service.amendProject('sess-content-project-1', policyFor(), ctx),
      service.amendProject('sess-content-project-1', policyFor(), ctx),
    ]);
    const won = outcomes.filter((o) => o.status === 'fulfilled');
    expect(won).toHaveLength(1);
    expect((won[0] as PromiseFulfilledResult<{ revision: number }>).value.revision).toBe(1);
    const lost = outcomes.filter((o) => o.status === 'rejected');
    expect(lost).toHaveLength(1);
    expect((((lost[0] as PromiseRejectedResult).reason) as SessionContentError).code).toBe('revision_conflict');
    const projects = await db
      .select()
      .from(sessionContentProjects)
      .where(eq(sessionContentProjects.projectId, 'sess-content-project-1'));
    expect(projects[0]!.projectRevision).toBe(1);
  });

  it('should preserve exclusions across amendments and accept-at-N (N2)', async () => {
    await acceptProject();
    const s2binding = await adoptSession('sess-content-s2');
    const s2rows = await db
      .select()
      .from(sessionWorkspaceBindings)
      .where(eq(sessionWorkspaceBindings.sessionId, 'sess-content-s2'));
    await service.excludeSession('sess-content-project-1', 'sess-content-s2', ctx);
    await service.amendProject(
      'sess-content-project-1',
      basePolicy({ ownerId: owner.id, readers: [owner.id], workspaceId, projectRevision: 0 }),
      ctx,
    );
    const deriveS2 = () => service.deriveGrant({
      projectId: 'sess-content-project-1',
      sessionId: 'sess-content-s2',
      bindingId: s2binding,
      bindingVersion: s2rows[0]!.version,
      d1Version: s2rows[0]!.version,
      d1Incarnation: 1,
      d1StartSeq: 0,
      workspaceId,
      sessionCreatedAt: now,
      sourceGeneration: 'gen-1',
      sourceTrustVersion: 'tv-1',
      nativeStartSeq: 0,
    }, ctx);
    await expectContentError(deriveS2, 'session_excluded');
    const prepared = service.prepareProject(
      basePolicy({ ownerId: owner.id, readers: [owner.id], workspaceId, projectRevision: 1 }),
    );
    await service.acceptProject({ ...prepared, offlineReadAccepted: true }, ctx);
    await expectContentError(deriveS2, 'session_excluded');
    const projects = await db
      .select()
      .from(sessionContentProjects)
      .where(eq(sessionContentProjects.projectId, 'sess-content-project-1'));
    expect(projects[0]!.projectRevision).toBe(2);
    expect(projects[0]!.excludedSessionIds).toContain('sess-content-s2');
    expect(projects[0]!.exclusionRevision).toBe(1);
    void s2binding;
  });

  it('should retain committed copies when staged purge jobs drain (N1)', async () => {
    await acceptProject();
    const bindingId = await adoptSession('sess-content-s1');
    const bindings = await db
      .select()
      .from(sessionWorkspaceBindings)
      .where(eq(sessionWorkspaceBindings.sessionId, 'sess-content-s1'));
    const deriveS1 = () => service.deriveGrant({
      projectId: 'sess-content-project-1',
      sessionId: 'sess-content-s1',
      bindingId,
      bindingVersion: bindings[0]!.version,
      d1Version: bindings[0]!.version,
      d1Incarnation: 1,
      d1StartSeq: 0,
      workspaceId,
      sessionCreatedAt: now,
      sourceGeneration: 'gen-1',
      sourceTrustVersion: 'tv-1',
      nativeStartSeq: 0,
    }, ctx);
    await deriveS1();
    const committedBody = new TextEncoder().encode('committed-n1');
    const first = await service.reserveBeforeUpload(
      'sess-content-s1', 'terminal.cache',
      { raw: committedBody.length, encoded: committedBody.length }, 'k-n1-1', ctx,
    );
    await service.publishAfterUpload(first.reservationId, committedBody, ctx);
    const stagedBody = new TextEncoder().encode('staged-n1');
    const second = await service.reserveBeforeUpload(
      'sess-content-s1', 'terminal.cache',
      { raw: stagedBody.length, encoded: stagedBody.length }, 'k-n1-2', ctx,
    );
    const closing = makeService({
      publishHooks: {
        afterUpload: async () => {
          await service.closeGrant('sess-content-s1', ctx);
        },
      },
    });
    await expectContentError(() => closing.publishAfterUpload(
      second.reservationId, stagedBody, ctx,
    ), 'grant_revoked');
    await adoptSession('sess-content-s2');
    const s2rows = await db
      .select()
      .from(sessionWorkspaceBindings)
      .where(eq(sessionWorkspaceBindings.sessionId, 'sess-content-s2'));
    await service.deriveGrant({
      projectId: 'sess-content-project-1',
      sessionId: 'sess-content-s2',
      bindingId: s2rows[0]!.bindingId,
      bindingVersion: s2rows[0]!.version,
      d1Version: s2rows[0]!.version,
      d1Incarnation: 1,
      d1StartSeq: 0,
      workspaceId,
      sessionCreatedAt: now,
      sourceGeneration: 'gen-1',
      sourceTrustVersion: 'tv-1',
      nativeStartSeq: 0,
    }, ctx);
    const stagedS2 = new TextEncoder().encode('staged-s2');
    const rS2 = await service.reserveBeforeUpload(
      'sess-content-s2', 'terminal.cache',
      { raw: stagedS2.length, encoded: stagedS2.length }, 'k-n1-3', ctx,
    );
    const detaching = makeService({
      publishHooks: {
        afterUpload: async () => {
          const adopting = new SessionWorkspaceService(undefined, null);
          await adopting.detach('sess-content-s2', TENANT_A, owner.id);
          await service.fenceSessionOnDetachEnd('sess-content-s2', TENANT_A);
        },
      },
    });
    await expectContentError(() => detaching.publishAfterUpload(
      rS2.reservationId, stagedS2, ctx,
    ), 'grant_revoked');
    const jobs = await db.select().from(sessionContentPurgeJobs);
    expect(jobs.length).toBeGreaterThan(0);
    for (const job of jobs) {
      expect(job.scope).toBe('object');
    }
    for (const job of jobs) {
      await service.runPurge(job.purgeJobId);
    }
    const history = await service.grantHistoryAuthorization('sess-content-s1', ctx);
    const bytes = await service.readCommitted('sess-content-s1', 'terminal.cache', ctx, history.authorizationId);
    expect(new TextDecoder().decode(bytes)).toBe('committed-n1');
    expect(await fixture.listPhysical('')).toHaveLength(1);
    void bindingId;
  });

  it('should not oversubscribe tenant quota across sessions (N4)', async () => {
    service = makeService({ maxBytesPerSession: 64, maxBytesPerTenant: 24, maxObjectsPerSession: 16 });
    await acceptProject();
    for (const sessionId of ['sess-content-s1', 'sess-content-s2']) {
      const bindingId = await adoptSession(sessionId);
      const bindings = await db
        .select()
        .from(sessionWorkspaceBindings)
        .where(eq(sessionWorkspaceBindings.sessionId, sessionId));
      await service.deriveGrant({
        projectId: 'sess-content-project-1',
        sessionId,
        bindingId,
        bindingVersion: bindings[0]!.version,
        d1Version: bindings[0]!.version,
        d1Incarnation: 1,
        d1StartSeq: 0,
        workspaceId,
        sessionCreatedAt: now,
        sourceGeneration: 'gen-1',
        sourceTrustVersion: 'tv-1',
        nativeStartSeq: 0,
      }, ctx);
      void bindingId;
    }
    const outcomes = await Promise.allSettled([
      service.reserveBeforeUpload(
        'sess-content-s1', 'terminal.cache', { raw: 16, encoded: 16 }, 'k-n4-1', ctx,
      ),
      service.reserveBeforeUpload(
        'sess-content-s2', 'terminal.cache', { raw: 16, encoded: 16 }, 'k-n4-2', ctx,
      ),
    ]);
    const won = outcomes.filter((o) => o.status === 'fulfilled');
    expect(won).toHaveLength(1);
    const lost = outcomes.filter((o) => o.status === 'rejected');
    expect(lost).toHaveLength(1);
    expect((((lost[0] as PromiseRejectedResult).reason) as SessionContentError).code).toBe('quota_exceeded');
    const usage = await service.accountUsage({ tenantId: TENANT_A });
    expect(usage.reservedBytes).toBeLessThanOrEqual(24);
  });

  it('should keep purge pending with no second staged row on PUT failure (N5)', async () => {
    await acceptProject();
    const bindingId = await adoptSession('sess-content-s1');
    const bindings = await db
      .select()
      .from(sessionWorkspaceBindings)
      .where(eq(sessionWorkspaceBindings.sessionId, 'sess-content-s1'));
    await service.deriveGrant({
      projectId: 'sess-content-project-1',
      sessionId: 'sess-content-s1',
      bindingId,
      bindingVersion: bindings[0]!.version,
      d1Version: bindings[0]!.version,
      d1Incarnation: 1,
      d1StartSeq: 0,
      workspaceId,
      sessionCreatedAt: now,
      sourceGeneration: 'gen-1',
      sourceTrustVersion: 'tv-1',
      nativeStartSeq: 0,
    }, ctx);
    const failing = makeService({
      publishHooks: {
        beforePut: async () => {
          throw new Error('injected PUT failure');
        },
      },
    });
    const body = new TextEncoder().encode('put-failure-n5');
    const reserved = await service.reserveBeforeUpload(
      'sess-content-s1', 'terminal.cache',
      { raw: body.length, encoded: body.length }, 'k-n5', ctx,
    );
    await expectContentError(() => failing.publishAfterUpload(
      reserved.reservationId, body, ctx,
    ), 'unknown_outcome');
    await expectContentError(() => service.publishAfterUpload(
      reserved.reservationId, body, ctx,
    ), 'unknown_outcome');
    const objects = await db
      .select()
      .from(sessionContentObjects)
      .where(eq(sessionContentObjects.sessionId, 'sess-content-s1'));
    expect(objects).toHaveLength(1);
    expect(objects[0]!.state).toBe('purge_pending');
    const duplicate = await service.reserveBeforeUpload(
      'sess-content-s1', 'terminal.cache',
      { raw: body.length, encoded: body.length }, 'k-n5', ctx,
    );
    expect(duplicate.duplicate).toBe(true);
    expect(duplicate.outcome).toBe('outcome_unknown');
    const attempts = await db
      .select()
      .from(sessionContentAttempts)
      .where(eq(sessionContentAttempts.sessionId, 'sess-content-s1'));
    expect(attempts[0]!.outcome).toBe('outcome_unknown');
    const usage = await service.accountUsage({ sessionId: 'sess-content-s1' });
    expect(usage.pendingDeletionBytes).toBe(body.length);
    const jobs = await db
      .select()
      .from(sessionContentPurgeJobs)
      .where(eq(sessionContentPurgeJobs.bindingId, bindingId));
    expect(jobs).toHaveLength(1);
    expect(jobs[0]!.scope).toBe('object');
    const purged = await service.runPurge(jobs[0]!.purgeJobId);
    expect(purged.remainingObjects).toBe(0);
    expect(await fixture.listPhysical('')).toHaveLength(0);
    void bindingId;
  });

  it('should derive future eligibility from the server D1 binding time (n4)', async () => {
    await acceptProject();
    const bindingId = await adoptSession('sess-content-s1');
    const bindings = await db
      .select()
      .from(sessionWorkspaceBindings)
      .where(eq(sessionWorkspaceBindings.sessionId, 'sess-content-s1'));
    const derived = await service.deriveGrant({
      projectId: 'sess-content-project-1',
      sessionId: 'sess-content-s1',
      bindingId,
      bindingVersion: bindings[0]!.version,
      d1Version: bindings[0]!.version,
      d1Incarnation: 1,
      d1StartSeq: 0,
      workspaceId,
      sessionCreatedAt: 1,
      sourceGeneration: 'gen-1',
      sourceTrustVersion: 'tv-1',
      nativeStartSeq: 0,
    }, ctx);
    const grants = await db
      .select()
      .from(sessionContentGrants)
      .where(eq(sessionContentGrants.sessionId, 'sess-content-s1'));
    expect(grants[0]!.lastFreshnessAckAt).toBe(bindings[0]!.createdAt.getTime());
    expect(grants[0]!.lastFreshnessAckAt).toBeGreaterThan(1);
    expect(derived.version).toBe(1);
    void bindingId;
  });

  it('should resolve the D1 content-hook issuer from configuration (n6)', async () => {
    const { resolveSessionContentIssuer } = await import(
      '../../src/services/cluster-mesh/session-workspace'
    );
    const previous = process.env.SESSION_CONTENT_AUTHORITY_ISSUER;
    try {
      expect(resolveSessionContentIssuer('explicit-issuer')).toBe('explicit-issuer');
      process.env.SESSION_CONTENT_AUTHORITY_ISSUER = 'env-issuer';
      expect(resolveSessionContentIssuer()).toBe('env-issuer');
      delete process.env.SESSION_CONTENT_AUTHORITY_ISSUER;
      expect(resolveSessionContentIssuer()).toBe('sentropic-product');
    } finally {
      if (previous === undefined) delete process.env.SESSION_CONTENT_AUTHORITY_ISSUER;
      else process.env.SESSION_CONTENT_AUTHORITY_ISSUER = previous;
    }
  });

  it('should increment on accept-at-N so a replayed accept conflicts (M4)', async () => {
    await acceptProject();
    await service.amendProject(
      'sess-content-project-1',
      basePolicy({ ownerId: owner.id, readers: [owner.id], workspaceId }),
      ctx,
    );
    const atOne = () => {
      const prepared = service.prepareProject(
        basePolicy({ ownerId: owner.id, readers: [owner.id], workspaceId, projectRevision: 1 }),
      );
      return service.acceptProject({ ...prepared, offlineReadAccepted: true }, ctx);
    };
    const outcomes = await Promise.allSettled([atOne(), atOne()]);
    expect(outcomes.filter((o) => o.status === 'fulfilled')).toHaveLength(1);
    const rejected = outcomes.filter((o) => o.status === 'rejected');
    expect(rejected).toHaveLength(1);
    expect((((rejected[0] as PromiseRejectedResult).reason) as SessionContentError).code).toBe('revision_conflict');
    const projects = await db
      .select()
      .from(sessionContentProjects)
      .where(eq(sessionContentProjects.projectId, 'sess-content-project-1'));
    expect(projects[0]!.projectRevision).toBe(2);
  });

  it('should not oversubscribe quota under concurrent reservations (R5)', async () => {
    service = makeService({ maxBytesPerSession: 20, maxBytesPerTenant: 40, maxObjectsPerSession: 16 });
    await acceptProject();
    const bindingId = await adoptSession('sess-content-s1');
    const bindings = await db
      .select()
      .from(sessionWorkspaceBindings)
      .where(eq(sessionWorkspaceBindings.sessionId, 'sess-content-s1'));
    await service.deriveGrant({
      projectId: 'sess-content-project-1',
      sessionId: 'sess-content-s1',
      bindingId,
      bindingVersion: bindings[0]!.version,
      d1Version: bindings[0]!.version,
      d1Incarnation: 1,
      d1StartSeq: 0,
      workspaceId,
      sessionCreatedAt: now,
      sourceGeneration: 'gen-1',
      sourceTrustVersion: 'tv-1',
      nativeStartSeq: 0,
    }, ctx);
    const outcomes = await Promise.allSettled([0, 1, 2, 3, 4].map((index) =>
      service.reserveBeforeUpload(
        'sess-content-s1', 'terminal.cache', { raw: 8, encoded: 8 }, `k-r5-${index}`, ctx,
      ),
    ));
    const won = outcomes.filter((o) => o.status === 'fulfilled');
    const lost = outcomes.filter((o) => o.status === 'rejected');
    expect(won).toHaveLength(2);
    expect(lost).toHaveLength(3);
    for (const rejection of lost) {
      expect((((rejection as PromiseRejectedResult).reason) as SessionContentError).code).toBe('quota_exceeded');
    }
    const usage = await service.accountUsage({ sessionId: 'sess-content-s1' });
    expect(usage.reservedBytes).toBeLessThanOrEqual(20);
    void bindingId;
  });

  it('should require origin-workspace membership on bounded reads (R6)', async () => {
    await acceptProject();
    const bindingId = await adoptSession('sess-content-s1');
    const bindings = await db
      .select()
      .from(sessionWorkspaceBindings)
      .where(eq(sessionWorkspaceBindings.sessionId, 'sess-content-s1'));
    await service.deriveGrant({
      projectId: 'sess-content-project-1',
      sessionId: 'sess-content-s1',
      bindingId,
      bindingVersion: bindings[0]!.version,
      d1Version: bindings[0]!.version,
      d1Incarnation: 1,
      d1StartSeq: 0,
      workspaceId,
      sessionCreatedAt: now,
      sourceGeneration: 'gen-1',
      sourceTrustVersion: 'tv-1',
      nativeStartSeq: 0,
    }, ctx);
    const body = new TextEncoder().encode('workspace-scoped-bytes');
    const reserved = await service.reserveBeforeUpload(
      'sess-content-s1', 'terminal.cache', { raw: body.length, encoded: body.length }, 'k-r6', ctx,
    );
    await service.publishAfterUpload(reserved.reservationId, body, ctx);
    await db.delete(workspaceMemberships).where(eq(workspaceMemberships.workspaceId, workspaceId));
    await expectContentError(
      () => service.readCommitted('sess-content-s1', 'terminal.cache', ctx),
      'membership_required',
    );
    const usage = await service.accountUsage({ sessionId: 'sess-content-s1' });
    expect(usage.committedBytes).toBe(body.length);
    void bindingId;
  });

  it('should validate the file authority record and require an explicit issuer (R10)', async () => {
    const { mkdtempSync, writeFileSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const { createFileContentAuthorityEpochPort } = await import(
      '../../src/services/cluster-mesh/session-content'
    );
    const dir = mkdtempSync(join(tmpdir(), 'scc-authority-'));
    const recordPath = join(dir, 'authority.json');
    writeFileSync(recordPath, JSON.stringify({
      issuer: 'sentropic-product', epoch: 'epoch-file-1', revision: 1.5, enabled: true, validUntil: 9_999_999_999_999,
    }));
    const nanPort = createFileContentAuthorityEpochPort(recordPath, () => now, 'sentropic-product');
    await expectContentError(() => nanPort.readCurrent('sentropic-product'), 'epoch_unavailable');
    writeFileSync(recordPath, JSON.stringify({
      issuer: 'sentropic-product', epoch: 'epoch-file-1', revision: 3, enabled: true, validUntil: 9_999_999_999_999,
    }));
    const validPort = createFileContentAuthorityEpochPort(recordPath, () => now, 'sentropic-product');
    const current = await validPort.readCurrent('sentropic-product');
    expect(current.revision).toBe(3);
    expect(() => createFileContentAuthorityEpochPort(recordPath, () => now, ''))
      .toThrowError();
  });

  it('should preserve a non-deleted identity on rollback without false purge', async () => {
    await acceptProject();
    const jobsBefore = await db.select().from(sessionContentPurgeJobs);
    const tombsBefore = await db.select().from(sessionContentTombstones);
    try {
      await db.transaction(async (tx) => {
        await tx.delete(tenants).where(eq(tenants.id, TENANT_B));
        throw new Error('intentional rollback');
      });
    } catch (err) {
      expect((err as Error).message).toBe('intentional rollback');
    }
    const tenantsAfter = await db
      .select()
      .from(tenants)
      .where(eq(tenants.id, TENANT_B));
    expect(tenantsAfter).toHaveLength(1);
    expect(await db.select().from(sessionContentPurgeJobs)).toHaveLength(jobsBefore.length);
    expect(await db.select().from(sessionContentTombstones)).toHaveLength(tombsBefore.length);
  });

  it('should pause capture after a retention amendment until refresh, then reserve and commit (N3)', async () => {
    await acceptProject();
    const deriveS = async (sessionId: string, projectId = 'sess-content-project-1') => {
      const bindingId = await adoptSession(sessionId);
      const rows = await db
        .select()
        .from(sessionWorkspaceBindings)
        .where(eq(sessionWorkspaceBindings.sessionId, sessionId));
      await service.deriveGrant({
        projectId,
        sessionId,
        bindingId,
        bindingVersion: rows[0]!.version,
        d1Version: rows[0]!.version,
        d1Incarnation: 1,
        d1StartSeq: 0,
        workspaceId,
        sessionCreatedAt: now,
        sourceGeneration: 'gen-1',
        sourceTrustVersion: 'tv-1',
        nativeStartSeq: 0,
      }, ctx);
      return { bindingId, bindingVersion: rows[0]!.version };
    };
    const s1 = await deriveS('sess-content-s1');
    const s2 = await deriveS('sess-content-s2');
    const pre = new TextEncoder().encode('pre-amend-n3');
    const r0 = await service.reserveBeforeUpload(
      'sess-content-s1', 'terminal.cache',
      { raw: pre.length, encoded: pre.length }, 'k-n3-pre', ctx,
    );
    await service.publishAfterUpload(r0.reservationId, pre, ctx);
    await service.amendProject(
      'sess-content-project-1',
      basePolicy({
        ownerId: owner.id,
        readers: [owner.id],
        workspaceId,
        projectRevision: 0,
        retentionByChannel: {
          'terminal.cache': { mode: 'duration', durationSeconds: 3600 },
          'native.mirror': { mode: 'none' },
        },
      }),
      ctx,
    );
    const resBefore = await db
      .select()
      .from(sessionContentReservations)
      .where(eq(sessionContentReservations.sessionId, 'sess-content-s1'));
    const attBefore = await db
      .select()
      .from(sessionContentAttempts)
      .where(eq(sessionContentAttempts.sessionId, 'sess-content-s1'));
    await expectContentError(() => service.reserveBeforeUpload(
      'sess-content-s1', 'terminal.cache', { raw: 4, encoded: 4 }, 'k-n3-paused', ctx,
    ), 'project_revision_changed');
    expect(await db
      .select()
      .from(sessionContentReservations)
      .where(eq(sessionContentReservations.sessionId, 'sess-content-s1'))).toHaveLength(resBefore.length);
    expect(await db
      .select()
      .from(sessionContentAttempts)
      .where(eq(sessionContentAttempts.sessionId, 'sess-content-s1'))).toHaveLength(attBefore.length);
    await acceptProject({ projectId: 'sess-content-project-2', workspaceId });
    const o3 = await deriveS('sess-content-s3', 'sess-content-project-2');
    await service.reserveBeforeUpload(
      'sess-content-s3', 'terminal.cache', { raw: 4, encoded: 4 }, 'k-n3-other', ctx,
    );
    const ack1 = await refreshAck('sess-content-s1', 1, s1.bindingVersion, 5);
    expect(ack1.projectRevision).toBe(1);
    expect(ack1.version).toBe(2);
    await refreshAck('sess-content-s2', 1, s2.bindingVersion, 5);
    await service.reserveBeforeUpload(
      'sess-content-s2', 'terminal.cache', { raw: 4, encoded: 4 }, 'k-n3-s2', ctx,
    );
    const post = new TextEncoder().encode('post-amend-n3');
    const r1 = await service.reserveBeforeUpload(
      'sess-content-s1', 'terminal.cache',
      { raw: post.length, encoded: post.length }, 'k-n3-post', ctx,
    );
    const pub1 = await service.publishAfterUpload(r1.reservationId, post, ctx);
    expect(pub1.expiresAt).toBe(now + 3_600_000);
    const mir = new TextEncoder().encode('mirror-amend-n3');
    const r2 = await service.reserveBeforeUpload(
      'sess-content-s1', 'native.mirror',
      { raw: mir.length, encoded: mir.length }, 'k-n3-mir', ctx,
    );
    const pub2 = await service.publishAfterUpload(r2.reservationId, mir, ctx);
    expect(pub2.expiresAt).toBeNull();
    const copies = await db
      .select()
      .from(sessionContentObjects)
      .where(eq(sessionContentObjects.sessionId, 'sess-content-s1'));
    expect(copies.filter((o) => o.state === 'committed')).toHaveLength(3);
    const preRow = copies.find((o) => o.bytesEncoded === pre.length && o.channel === 'terminal.cache');
    expect(preRow!.expiresAt).toBeNull();
    const bytes = await service.readCommitted('sess-content-s1', 'terminal.cache', ctx);
    expect(bytes.length).toBeGreaterThan(0);
    expect(await fixture.listPhysical('')).toHaveLength(3);
    void o3;
  });

  it('should refuse publication with zero PUT for reservations made before an amendment (N3)', async () => {
    await acceptProject();
    const bindingId = await adoptSession('sess-content-s1');
    const rows = await db
      .select()
      .from(sessionWorkspaceBindings)
      .where(eq(sessionWorkspaceBindings.sessionId, 'sess-content-s1'));
    await service.deriveGrant({
      projectId: 'sess-content-project-1',
      sessionId: 'sess-content-s1',
      bindingId,
      bindingVersion: rows[0]!.version,
      d1Version: rows[0]!.version,
      d1Incarnation: 1,
      d1StartSeq: 0,
      workspaceId,
      sessionCreatedAt: now,
      sourceGeneration: 'gen-1',
      sourceTrustVersion: 'tv-1',
      nativeStartSeq: 0,
    }, ctx);
    const body = new TextEncoder().encode('pre-fence-n3');
    const reserved = await service.reserveBeforeUpload(
      'sess-content-s1', 'terminal.cache',
      { raw: body.length, encoded: body.length }, 'k-n3-fence', ctx,
    );
    await service.amendProject(
      'sess-content-project-1',
      basePolicy({ ownerId: owner.id, readers: [owner.id], workspaceId, projectRevision: 0 }),
      ctx,
    );
    await expectContentError(() => service.publishAfterUpload(
      reserved.reservationId, body, ctx,
    ), 'project_revision_changed');
    expect(await db
      .select()
      .from(sessionContentObjects)
      .where(eq(sessionContentObjects.sessionId, 'sess-content-s1'))).toHaveLength(0);
    const reservations = await db
      .select()
      .from(sessionContentReservations)
      .where(eq(sessionContentReservations.reservationId, reserved.reservationId));
    expect(reservations[0]!.state).toBe('cancelled');
    const attempts = await db
      .select()
      .from(sessionContentAttempts)
      .where(eq(sessionContentAttempts.sessionId, 'sess-content-s1'));
    expect(attempts[0]!.outcome).toBe('cancelled');
    const usage = await service.accountUsage({ sessionId: 'sess-content-s1' });
    expect(usage.reservedBytes).toBe(0);
    expect(await fixture.listPhysical('')).toHaveLength(0);
    const jobs = await db
      .select()
      .from(sessionContentPurgeJobs)
      .where(eq(sessionContentPurgeJobs.bindingId, bindingId));
    expect(jobs).toHaveLength(0);
    void bindingId;
  });

  it('should let the amendment fence win over a writer admitted before it (N3)', async () => {
    await acceptProject();
    const bindingId = await adoptSession('sess-content-s1');
    const rows = await db
      .select()
      .from(sessionWorkspaceBindings)
      .where(eq(sessionWorkspaceBindings.sessionId, 'sess-content-s1'));
    await service.deriveGrant({
      projectId: 'sess-content-project-1',
      sessionId: 'sess-content-s1',
      bindingId,
      bindingVersion: rows[0]!.version,
      d1Version: rows[0]!.version,
      d1Incarnation: 1,
      d1StartSeq: 0,
      workspaceId,
      sessionCreatedAt: now,
      sourceGeneration: 'gen-1',
      sourceTrustVersion: 'tv-1',
      nativeStartSeq: 0,
    }, ctx);
    const seed = new TextEncoder().encode('seed-n3');
    const r0 = await service.reserveBeforeUpload(
      'sess-content-s1', 'terminal.cache',
      { raw: seed.length, encoded: seed.length }, 'k-n3-seed', ctx,
    );
    await service.publishAfterUpload(r0.reservationId, seed, ctx);
    const body = new TextEncoder().encode('fenced-n3');
    const reserved = await service.reserveBeforeUpload(
      'sess-content-s1', 'terminal.cache',
      { raw: body.length, encoded: body.length }, 'k-n3-race', ctx,
    );
    const racing = makeService({
      publishHooks: {
        beforePut: async () => {
          await service.amendProject(
            'sess-content-project-1',
            basePolicy({ ownerId: owner.id, readers: [owner.id], workspaceId, projectRevision: 0 }),
            ctx,
          );
          await refreshAck('sess-content-s1', 1, rows[0]!.version, 3);
        },
      },
    });
    await expectContentError(() => racing.publishAfterUpload(
      reserved.reservationId, body, ctx,
    ), 'project_revision_changed');
    const objects = await db
      .select()
      .from(sessionContentObjects)
      .where(eq(sessionContentObjects.sessionId, 'sess-content-s1'));
    expect(objects.filter((o) => o.state === 'committed')).toHaveLength(1);
    expect(objects.filter((o) => o.state === 'purge_pending')).toHaveLength(1);
    await expectContentError(() => service.publishAfterUpload(
      reserved.reservationId, body, ctx,
    ), 'unknown_outcome');
    expect(await db
      .select()
      .from(sessionContentObjects)
      .where(eq(sessionContentObjects.sessionId, 'sess-content-s1'))).toHaveLength(2);
    await service.reserveBeforeUpload(
      'sess-content-s1', 'terminal.cache',
      { raw: body.length, encoded: body.length }, 'k-n3-race-2', ctx,
    );
    const jobs = await db.select().from(sessionContentPurgeJobs);
    expect(jobs.length).toBeGreaterThan(0);
    for (const job of jobs) {
      expect(job.scope).toBe('object');
      await service.runPurge(job.purgeJobId);
    }
    const bytes = await service.readCommitted('sess-content-s1', 'terminal.cache', ctx);
    expect(new TextDecoder().decode(bytes)).toBe('seed-n3');
    expect(await fixture.listPhysical('')).toHaveLength(1);
    const usage = await service.accountUsage({ sessionId: 'sess-content-s1' });
    expect(usage.pendingDeletionBytes).toBe(0);
    expect(usage.committedBytes).toBe(seed.length);
    expect(usage.reservedBytes).toBe(body.length);
    void bindingId;
  });

  it('should keep capture paused across restart and resume siblings independently (N3)', async () => {
    await acceptProject();
    const deriveS = async (sessionId: string) => {
      const bindingId = await adoptSession(sessionId);
      const rows = await db
        .select()
        .from(sessionWorkspaceBindings)
        .where(eq(sessionWorkspaceBindings.sessionId, sessionId));
      await service.deriveGrant({
        projectId: 'sess-content-project-1',
        sessionId,
        bindingId,
        bindingVersion: rows[0]!.version,
        d1Version: rows[0]!.version,
        d1Incarnation: 1,
        d1StartSeq: 0,
        workspaceId,
        sessionCreatedAt: now,
        sourceGeneration: 'gen-1',
        sourceTrustVersion: 'tv-1',
        nativeStartSeq: 0,
      }, ctx);
      return { bindingVersion: rows[0]!.version };
    };
    const s1 = await deriveS('sess-content-s1');
    const s2 = await deriveS('sess-content-s2');
    await service.amendProject(
      'sess-content-project-1',
      basePolicy({ ownerId: owner.id, readers: [owner.id], workspaceId, projectRevision: 0 }),
      ctx,
    );
    const restarted = makeService();
    await expectContentError(() => restarted.reserveBeforeUpload(
      'sess-content-s1', 'terminal.cache', { raw: 4, encoded: 4 }, 'k-n3-restart', ctx,
    ), 'project_revision_changed');
    const ack = await refreshAck('sess-content-s1', 1, s1.bindingVersion);
    expect(ack.version).toBe(2);
    await service.reserveBeforeUpload(
      'sess-content-s1', 'terminal.cache', { raw: 4, encoded: 4 }, 'k-n3-resumed', ctx,
    );
    await service.closeGrant('sess-content-s2', ctx);
    await expectContentError(() => refreshAck('sess-content-s2', 1, s2.bindingVersion), 'grant_closed');
    const dup = await refreshAck('sess-content-s1', 1, s1.bindingVersion);
    expect(dup.projectRevision).toBe(1);
    expect(dup.version).toBe(2);
    void restarted;
  });

  it('should refuse refresh for excluded, revoked, detached and rotated children (N3)', async () => {
    await acceptProject();
    const deriveS = async (sessionId: string) => {
      const bindingId = await adoptSession(sessionId);
      const rows = await db
        .select()
        .from(sessionWorkspaceBindings)
        .where(eq(sessionWorkspaceBindings.sessionId, sessionId));
      await service.deriveGrant({
        projectId: 'sess-content-project-1',
        sessionId,
        bindingId,
        bindingVersion: rows[0]!.version,
        d1Version: rows[0]!.version,
        d1Incarnation: 1,
        d1StartSeq: 0,
        workspaceId,
        sessionCreatedAt: now,
        sourceGeneration: 'gen-1',
        sourceTrustVersion: 'tv-1',
        nativeStartSeq: 0,
      }, ctx);
      return { bindingVersion: rows[0]!.version };
    };
    const se = await deriveS('sess-content-se');
    const sr = await deriveS('sess-content-sr');
    const sd = await deriveS('sess-content-sd');
    const sp = await deriveS('sess-content-sp');
    await service.excludeSession('sess-content-project-1', 'sess-content-se', ctx);
    await service.revokeGrant('sess-content-sr', ctx);
    await service.fenceSessionOnDetachEnd('sess-content-sd', TENANT_A);
    await service.amendProject(
      'sess-content-project-1',
      basePolicy({ ownerId: owner.id, readers: [owner.id], workspaceId, projectRevision: 0 }),
      ctx,
    );
    await expectContentError(() => refreshAck('sess-content-se', 1, se.bindingVersion), 'session_excluded');
    await expectContentError(() => refreshAck('sess-content-sr', 1, sr.bindingVersion), 'grant_revoked');
    await expectContentError(() => refreshAck('sess-content-sd', 1, sd.bindingVersion), 'grant_closed');
    fakeEpoch.rotate('epoch-test-2');
    await expectContentError(() => refreshAck('sess-content-sp', 1, sp.bindingVersion), 'epoch_mismatch');
  });

  it('should not exhaust a small session quota over amend-and-refresh cycles (P1)', async () => {
    service = makeService({ maxBytesPerSession: 32, maxBytesPerTenant: 1000, maxObjectsPerSession: 64 });
    await acceptProject();
    const bindingId = await adoptSession('sess-content-s1');
    const rows = await db
      .select()
      .from(sessionWorkspaceBindings)
      .where(eq(sessionWorkspaceBindings.sessionId, 'sess-content-s1'));
    await service.deriveGrant({
      projectId: 'sess-content-project-1',
      sessionId: 'sess-content-s1',
      bindingId,
      bindingVersion: rows[0]!.version,
      d1Version: rows[0]!.version,
      d1Incarnation: 1,
      d1StartSeq: 0,
      workspaceId,
      sessionCreatedAt: now,
      sourceGeneration: 'gen-1',
      sourceTrustVersion: 'tv-1',
      nativeStartSeq: 0,
    }, ctx);
    for (let i = 1; i <= 8; i += 1) {
      const body = new TextEncoder().encode(`p1c${i}`);
      const r1 = await service.reserveBeforeUpload(
        'sess-content-s1', 'terminal.cache',
        { raw: body.length, encoded: body.length }, `k-p1-${i}-a`, ctx,
      );
      await service.amendProject(
        'sess-content-project-1',
        basePolicy({ ownerId: owner.id, readers: [owner.id], workspaceId, projectRevision: i - 1 }),
        ctx,
      );
      await expectContentError(() => service.publishAfterUpload(
        r1.reservationId, body, ctx,
      ), 'project_revision_changed');
      await refreshAck('sess-content-s1', i, rows[0]!.version, i);
      const r2 = await service.reserveBeforeUpload(
        'sess-content-s1', 'terminal.cache',
        { raw: body.length, encoded: body.length }, `k-p1-${i}-b`, ctx,
      );
      await service.publishAfterUpload(r2.reservationId, body, ctx);
    }
    const usage = await service.accountUsage({ sessionId: 'sess-content-s1' });
    expect(usage.reservedBytes).toBe(0);
    expect(usage.pendingDeletionBytes).toBe(0);
    expect(usage.committedBytes).toBe(32);
    void bindingId;
  });

  it('should not cancel unrelated attempts when an object job drains twice (P2)', async () => {
    await acceptProject();
    const deriveS = async (sessionId: string) => {
      const bindingId = await adoptSession(sessionId);
      const rows = await db
        .select()
        .from(sessionWorkspaceBindings)
        .where(eq(sessionWorkspaceBindings.sessionId, sessionId));
      await service.deriveGrant({
        projectId: 'sess-content-project-1',
        sessionId,
        bindingId,
        bindingVersion: rows[0]!.version,
        d1Version: rows[0]!.version,
        d1Incarnation: 1,
        d1StartSeq: 0,
        workspaceId,
        sessionCreatedAt: now,
        sourceGeneration: 'gen-1',
        sourceTrustVersion: 'tv-1',
        nativeStartSeq: 0,
      }, ctx);
      return { bindingId };
    };
    const s1 = await deriveS('sess-content-s1');
    const failing = makeService({
      publishHooks: {
        beforePut: async () => {
          throw new Error('injected PUT failure');
        },
      },
    });
    const body = new TextEncoder().encode('p2-failed');
    const r1 = await service.reserveBeforeUpload(
      'sess-content-s1', 'terminal.cache',
      { raw: body.length, encoded: body.length }, 'k-p2-1', ctx,
    );
    await expectContentError(() => failing.publishAfterUpload(
      r1.reservationId, body, ctx,
    ), 'unknown_outcome');
    const jobs = await db
      .select()
      .from(sessionContentPurgeJobs)
      .where(eq(sessionContentPurgeJobs.bindingId, s1.bindingId));
    expect(jobs).toHaveLength(1);
    expect(jobs[0]!.scope).toBe('object');
    await service.runPurge(jobs[0]!.purgeJobId);
    const other = new TextEncoder().encode('p2-live');
    const rm = await service.reserveBeforeUpload(
      'sess-content-s1', 'native.mirror',
      { raw: other.length, encoded: other.length }, 'k-p2-m', ctx,
    );
    await deriveS('sess-content-s2');
    const r2 = await service.reserveBeforeUpload(
      'sess-content-s2', 'terminal.cache',
      { raw: other.length, encoded: other.length }, 'k-p2-2', ctx,
    );
    const second = await service.runPurge(jobs[0]!.purgeJobId);
    expect(second.remainingObjects).toBe(0);
    const attemptOf = async (reservationId: string) => (await db
      .select()
      .from(sessionContentAttempts)
      .where(eq(sessionContentAttempts.attemptId, reservationId)))[0]!.outcome;
    expect(await attemptOf(rm.reservationId)).toBe('attempted');
    expect(await attemptOf(r2.reservationId)).toBe('attempted');
    const res1 = await db
      .select()
      .from(sessionContentReservations)
      .where(eq(sessionContentReservations.reservationId, r1.reservationId));
    expect(res1[0]!.state).toBe('cancelled');
    void s1;
  });

  it('should cancel only the linked attempt when an object job settles a crash (P2)', async () => {
    await acceptProject();
    const bindingId = await adoptSession('sess-content-s1');
    const rows = await db
      .select()
      .from(sessionWorkspaceBindings)
      .where(eq(sessionWorkspaceBindings.sessionId, 'sess-content-s1'));
    await service.deriveGrant({
      projectId: 'sess-content-project-1',
      sessionId: 'sess-content-s1',
      bindingId,
      bindingVersion: rows[0]!.version,
      d1Version: rows[0]!.version,
      d1Incarnation: 1,
      d1StartSeq: 0,
      workspaceId,
      sessionCreatedAt: now,
      sourceGeneration: 'gen-1',
      sourceTrustVersion: 'tv-1',
      nativeStartSeq: 0,
    }, ctx);
    const failing = makeService({
      publishHooks: {
        beforePut: async () => {
          throw new Error('injected PUT failure');
        },
      },
    });
    const body = new TextEncoder().encode('p2-crash');
    const r3 = await service.reserveBeforeUpload(
      'sess-content-s1', 'terminal.cache',
      { raw: body.length, encoded: body.length }, 'k-p2-3', ctx,
    );
    await expectContentError(() => failing.publishAfterUpload(
      r3.reservationId, body, ctx,
    ), 'unknown_outcome');
    await db
      .update(sessionContentAttempts)
      .set({ outcome: 'attempted' })
      .where(eq(sessionContentAttempts.attemptId, r3.reservationId));
    const live = new TextEncoder().encode('p2-other');
    const r4 = await service.reserveBeforeUpload(
      'sess-content-s1', 'native.mirror',
      { raw: live.length, encoded: live.length }, 'k-p2-4', ctx,
    );
    const jobs = await db
      .select()
      .from(sessionContentPurgeJobs)
      .where(eq(sessionContentPurgeJobs.bindingId, bindingId));
    expect(jobs).toHaveLength(1);
    await service.runPurge(jobs[0]!.purgeJobId);
    const attemptOf = async (reservationId: string) => (await db
      .select()
      .from(sessionContentAttempts)
      .where(eq(sessionContentAttempts.attemptId, reservationId)))[0]!.outcome;
    expect(await attemptOf(r3.reservationId)).toBe('cancelled');
    expect(await attemptOf(r4.reservationId)).toBe('attempted');
    void bindingId;
  });

  it('should refuse refresh on replaced source generation or changed D1 version (P3)', async () => {
    await acceptProject();
    const bindingId = await adoptSession('sess-content-s1');
    const rows = await db
      .select()
      .from(sessionWorkspaceBindings)
      .where(eq(sessionWorkspaceBindings.sessionId, 'sess-content-s1'));
    await service.deriveGrant({
      projectId: 'sess-content-project-1',
      sessionId: 'sess-content-s1',
      bindingId,
      bindingVersion: rows[0]!.version,
      d1Version: rows[0]!.version,
      d1Incarnation: 1,
      d1StartSeq: 0,
      workspaceId,
      sessionCreatedAt: now,
      sourceGeneration: 'gen-1',
      sourceTrustVersion: 'tv-1',
      nativeStartSeq: 0,
    }, ctx);
    await service.amendProject(
      'sess-content-project-1',
      basePolicy({ ownerId: owner.id, readers: [owner.id], workspaceId, projectRevision: 0 }),
      ctx,
    );
    await expectContentError(() => refreshAck('sess-content-s1', 1, rows[0]!.version, 0, {
      sourceGeneration: 'gen-2',
    }), 'source_reauthorization_required');
    const grants = await db
      .select()
      .from(sessionContentGrants)
      .where(eq(sessionContentGrants.sessionId, 'sess-content-s1'));
    expect(grants[0]!.sourceGeneration).toBe('gen-1');
    await expectContentError(() => refreshAck('sess-content-s1', 1, rows[0]!.version, 0, {
      d1Version: 2,
    }), 'ineligible_session');
    await expectContentError(() => service.reserveBeforeUpload(
      'sess-content-s1', 'terminal.cache', { raw: 4, encoded: 4 }, 'k-p3', ctx,
    ), 'project_revision_changed');
    expect(await fixture.listPhysical('')).toHaveLength(0);
    void bindingId;
  });

  it('should bind refresh to the accepted digest with a forward boundary and fresh ack (m1)', async () => {
    await acceptProject();
    const bindingId = await adoptSession('sess-content-s1');
    const rows = await db
      .select()
      .from(sessionWorkspaceBindings)
      .where(eq(sessionWorkspaceBindings.sessionId, 'sess-content-s1'));
    await service.deriveGrant({
      projectId: 'sess-content-project-1',
      sessionId: 'sess-content-s1',
      bindingId,
      bindingVersion: rows[0]!.version,
      d1Version: rows[0]!.version,
      d1Incarnation: 1,
      d1StartSeq: 0,
      workspaceId,
      sessionCreatedAt: now,
      sourceGeneration: 'gen-1',
      sourceTrustVersion: 'tv-1',
      nativeStartSeq: 7,
    }, ctx);
    await service.amendProject(
      'sess-content-project-1',
      basePolicy({ ownerId: owner.id, readers: [owner.id], workspaceId, projectRevision: 0 }),
      ctx,
    );
    await expectContentError(() => refreshAck('sess-content-s1', 1, rows[0]!.version, 9, {
      policyDigest: '0'.repeat(64),
    }), 'revision_conflict');
    await expectContentError(
      () => refreshAck('sess-content-s1', 1, rows[0]!.version, 3),
      'invalid_request',
    );
    const ack = await refreshAck('sess-content-s1', 1, rows[0]!.version, 9);
    expect(ack.projectRevision).toBe(1);
    const updated = await db
      .select()
      .from(sessionContentGrants)
      .where(eq(sessionContentGrants.sessionId, 'sess-content-s1'));
    expect(updated[0]!.nativeBoundarySeq).toBe(9);
    expect(updated[0]!.lastFreshnessAckAt).toBe(now);
    void bindingId;
  });

  it('should refuse refresh and reserve on an unreconciled local deny (m1)', async () => {
    await acceptProject();
    const bindingId = await adoptSession('sess-content-s1');
    const rows = await db
      .select()
      .from(sessionWorkspaceBindings)
      .where(eq(sessionWorkspaceBindings.sessionId, 'sess-content-s1'));
    await service.deriveGrant({
      projectId: 'sess-content-project-1',
      sessionId: 'sess-content-s1',
      bindingId,
      bindingVersion: rows[0]!.version,
      d1Version: rows[0]!.version,
      d1Incarnation: 1,
      d1StartSeq: 0,
      workspaceId,
      sessionCreatedAt: now,
      sourceGeneration: 'gen-1',
      sourceTrustVersion: 'tv-1',
      nativeStartSeq: 0,
    }, ctx);
    await service.recordLocalDeny('sess-content-s1', ctx);
    await expectContentError(() => service.reserveBeforeUpload(
      'sess-content-s1', 'terminal.cache', { raw: 4, encoded: 4 }, 'k-m1-deny', ctx,
    ), 'invalid_request');
    await service.amendProject(
      'sess-content-project-1',
      basePolicy({ ownerId: owner.id, readers: [owner.id], workspaceId, projectRevision: 0 }),
      ctx,
    );
    await expectContentError(
      () => refreshAck('sess-content-s1', 1, rows[0]!.version),
      'invalid_request',
    );
    const reconciled = await service.reconcileLocalDeny('sess-content-s1', ctx);
    expect(reconciled.reconciled).toBe(true);
    await expectContentError(
      () => refreshAck('sess-content-s1', 1, rows[0]!.version),
      'grant_revoked',
    );
    void bindingId;
  });

  it('should pause and resume capture through accept-at-N (m2)', async () => {
    await acceptProject();
    const bindingId = await adoptSession('sess-content-s1');
    const rows = await db
      .select()
      .from(sessionWorkspaceBindings)
      .where(eq(sessionWorkspaceBindings.sessionId, 'sess-content-s1'));
    await service.deriveGrant({
      projectId: 'sess-content-project-1',
      sessionId: 'sess-content-s1',
      bindingId,
      bindingVersion: rows[0]!.version,
      d1Version: rows[0]!.version,
      d1Incarnation: 1,
      d1StartSeq: 0,
      workspaceId,
      sessionCreatedAt: now,
      sourceGeneration: 'gen-1',
      sourceTrustVersion: 'tv-1',
      nativeStartSeq: 0,
    }, ctx);
    const prepared = service.prepareProject(
      basePolicy({ ownerId: owner.id, readers: [owner.id], workspaceId, projectRevision: 0 }),
    );
    await service.acceptProject({ ...prepared, offlineReadAccepted: true }, ctx);
    await expectContentError(() => service.reserveBeforeUpload(
      'sess-content-s1', 'terminal.cache', { raw: 4, encoded: 4 }, 'k-m2-acceptn', ctx,
    ), 'project_revision_changed');
    await refreshAck('sess-content-s1', 1, rows[0]!.version);
    await service.reserveBeforeUpload(
      'sess-content-s1', 'terminal.cache', { raw: 4, encoded: 4 }, 'k-m2-acceptn-2', ctx,
    );
    void bindingId;
  });

  it('should let exactly one concurrent refresh win (m2)', async () => {
    await acceptProject();
    const bindingId = await adoptSession('sess-content-s1');
    const rows = await db
      .select()
      .from(sessionWorkspaceBindings)
      .where(eq(sessionWorkspaceBindings.sessionId, 'sess-content-s1'));
    await service.deriveGrant({
      projectId: 'sess-content-project-1',
      sessionId: 'sess-content-s1',
      bindingId,
      bindingVersion: rows[0]!.version,
      d1Version: rows[0]!.version,
      d1Incarnation: 1,
      d1StartSeq: 0,
      workspaceId,
      sessionCreatedAt: now,
      sourceGeneration: 'gen-1',
      sourceTrustVersion: 'tv-1',
      nativeStartSeq: 0,
    }, ctx);
    await service.amendProject(
      'sess-content-project-1',
      basePolicy({ ownerId: owner.id, readers: [owner.id], workspaceId, projectRevision: 0 }),
      ctx,
    );
    const outcomes = await Promise.allSettled([
      refreshAck('sess-content-s1', 1, rows[0]!.version, 1),
      refreshAck('sess-content-s1', 1, rows[0]!.version, 1),
    ]);
    const won = outcomes.filter((o) => o.status === 'fulfilled');
    expect(won).toHaveLength(1);
    expect((won[0] as PromiseFulfilledResult<{ refreshed: boolean }>).value.refreshed).toBe(true);
    const lost = outcomes.filter((o) => o.status === 'rejected');
    expect(lost).toHaveLength(1);
    expect((((lost[0] as PromiseRejectedResult).reason) as SessionContentError).code).toBe('revision_conflict');
    const grants = await db
      .select()
      .from(sessionContentGrants)
      .where(eq(sessionContentGrants.sessionId, 'sess-content-s1'));
    expect(grants[0]!.projectRevision).toBe(1);
    expect(grants[0]!.version).toBe(2);
    void bindingId;
  });

  it('should keep later fences effective after a refresh (m2)', async () => {
    await acceptProject();
    const bindingId = await adoptSession('sess-content-s1');
    const rows = await db
      .select()
      .from(sessionWorkspaceBindings)
      .where(eq(sessionWorkspaceBindings.sessionId, 'sess-content-s1'));
    await service.deriveGrant({
      projectId: 'sess-content-project-1',
      sessionId: 'sess-content-s1',
      bindingId,
      bindingVersion: rows[0]!.version,
      d1Version: rows[0]!.version,
      d1Incarnation: 1,
      d1StartSeq: 0,
      workspaceId,
      sessionCreatedAt: now,
      sourceGeneration: 'gen-1',
      sourceTrustVersion: 'tv-1',
      nativeStartSeq: 0,
    }, ctx);
    await service.amendProject(
      'sess-content-project-1',
      basePolicy({ ownerId: owner.id, readers: [owner.id], workspaceId, projectRevision: 0 }),
      ctx,
    );
    await refreshAck('sess-content-s1', 1, rows[0]!.version);
    await service.fenceSessionOnDetachEnd('sess-content-s1', TENANT_A);
    await expectContentError(() => service.reserveBeforeUpload(
      'sess-content-s1', 'terminal.cache', { raw: 4, encoded: 4 }, 'k-m2-fenced', ctx,
    ), 'grant_revoked');
    await expectContentError(
      () => refreshAck('sess-content-s1', 1, rows[0]!.version),
      'grant_closed',
    );
    void bindingId;
  });

  it('should refuse future-only derivation when the server binding predates activation (m2/n4)', async () => {
    await acceptProject({ futureSessions: true, selectedSessionIds: [] });
    const bindingId = await adoptSession('sess-content-s1');
    await db
      .update(sessionWorkspaceBindings)
      .set({ createdAt: new Date(1) })
      .where(eq(sessionWorkspaceBindings.sessionId, 'sess-content-s1'));
    const rows = await db
      .select()
      .from(sessionWorkspaceBindings)
      .where(eq(sessionWorkspaceBindings.sessionId, 'sess-content-s1'));
    await expectContentError(() => service.deriveGrant({
      projectId: 'sess-content-project-1',
      sessionId: 'sess-content-s1',
      bindingId,
      bindingVersion: rows[0]!.version,
      d1Version: rows[0]!.version,
      d1Incarnation: 1,
      d1StartSeq: 0,
      workspaceId,
      sessionCreatedAt: now,
      sourceGeneration: 'gen-1',
      sourceTrustVersion: 'tv-1',
      nativeStartSeq: 0,
    }, ctx), 'ineligible_session');
    void bindingId;
  });
});
