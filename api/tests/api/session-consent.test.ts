import { and, eq, inArray, sql } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
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

  const makeService = (quotas?: Record<string, number>): SessionContentService =>
    new SessionContentService({
      nowMs: () => now,
      storage: {
        endpoint: fixture.config.endpoint,
        region: fixture.config.region,
        bucket: fixture.config.bucket,
        accessKeyId: fixture.config.accessKeyId,
        secretAccessKey: fixture.config.secretAccessKey,
      },
      epochs: fakeEpoch,
      quotas,
    });

  const acceptProject = async (
    overrides: Record<string, unknown> = {},
    context: SessionContentContext = ctx,
  ) => {
    const policy = basePolicy({ ownerId: context.ownerId, readers: [context.ownerId], ...overrides });
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
      basePolicy({ ownerId: owner.id, readers: [owner.id] }),
      ctx,
    );
    expect(amended.revision).toBe(1);
    await expectContentError(() => service.revokeProject('sess-content-project-1', {
      tenantId: TENANT_B, principalId: outsider.id, ownerId: outsider.id,
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
          { ...prepared, policy: { ...prepared.policy, projectRevision: 99 } },
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
