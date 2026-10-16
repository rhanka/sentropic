import { describe, expect, it } from 'vitest';
import {
  captureExpiresAt,
  checkGrantLiveness,
  ContentConsentError,
  computePolicyDigest,
  createContentConsentService,
  createMemoryContentConsentStore,
  isGrantValidForBinding,
  partitionExportableNativeRecords,
  validateRetentionByChannel,
  verifyPolicyDigest,
} from '../src/sessions/content-consent.js';
import type {
  DeriveChildInput,
  NamedHistoryDescriptor,
  ProjectPrepareInput,
} from '../src/sessions/content-consent.js';

const expectConsentCode = (fn: () => unknown, code: string) => {
  try {
    fn();
  } catch (error) {
    expect(error).toMatchObject({ code });
    return;
  }
  expect.unreachable();
};

const expectConsentCodeAsync = async (fn: () => Promise<unknown>, code: string) => {
  try {
    await fn();
  } catch (error) {
    expect(error).toMatchObject({ code });
    return;
  }
  expect.unreachable();
};

const sharedBaseInput = (overrides: Partial<ProjectPrepareInput> = {}): ProjectPrepareInput => ({
  projectId: 'project-1',
  tenantId: 'tenant-a',
  workspaceId: 'workspace-1',
  workspaceIncarnation: 1,
  ownerId: 'user-1',
  sourceIdentities: ['workstation-1'],
  sourceTrustVersions: ['h2a-1.0+d2-1'],
  channels: { 'terminal.live': true, 'terminal.cache': true, 'native.mirror': false, 'keyboard.control': false },
  futureSessions: true,
  selectedSessionIds: [] as string[],
  namedHistories: [] as NamedHistoryDescriptor[],
  retentionByChannel: { 'terminal.cache': { mode: 'none' }, 'native.mirror': { mode: 'none' } },
  authorityEpoch: 'epoch-1',
  offlineReadAccepted: true,
  ...overrides,
});

const setupConsent = () => {
  const store = createMemoryContentConsentStore();
  let nowMs = 1_000_000;
  const service = createContentConsentService(store, { nowMs: () => nowMs });
  return { store, service, advance: (ms: number) => { nowMs += ms; }, now: () => nowMs };
};

const readyConsent = async () => {
  const context = setupConsent();
  const prepared = context.service.prepareProject(sharedBaseInput());
  await context.service.acceptProject(prepared, { challengeId: prepared.challengeId });
  return context;
};

const sharedChildInput = (overrides: Partial<DeriveChildInput> = {}): DeriveChildInput => ({
  projectId: 'project-1',
  sessionId: 'session-1',
  bindingId: 'binding-1',
  bindingVersion: 1,
  d1Version: 3,
  d1Incarnation: 1,
  d1StartSeq: 40,
  tenantId: 'tenant-a',
  workspaceId: 'workspace-1',
  ownerId: 'user-1',
  sessionCreatedAt: 1_000_001,
  sourceGeneration: 'gen-1',
  sourceTrustVersion: 'h2a-1.0+d2-1',
  nativeStartSeq: 40,
  ...overrides,
});

describe('content consent retention validation', () => {
  it('should accept explicit no-expiry defaults for both retained channels', () => {
    const map = validateRetentionByChannel({
      'terminal.cache': { mode: 'none' },
      'native.mirror': { mode: 'none' },
    });
    expect(map['terminal.cache']).toEqual({ mode: 'none' });
    expect(map['native.mirror']).toEqual({ mode: 'none' });
  });

  it('should accept a positive safe-integer duration for one channel only', () => {
    const map = validateRetentionByChannel({
      'terminal.cache': { mode: 'duration', durationSeconds: 3600 },
      'native.mirror': { mode: 'none' },
    });
    expect(map['terminal.cache']).toEqual({ mode: 'duration', durationSeconds: 3600 });
  });

  it('should refuse a zero duration', () => {
    expectConsentCode(() => validateRetentionByChannel({
      'terminal.cache': { mode: 'duration', durationSeconds: 0 },
      'native.mirror': { mode: 'none' },
    }), 'invalid_retention');
  });

  it('should refuse a negative duration', () => {
    expectConsentCode(() => validateRetentionByChannel({
      'terminal.cache': { mode: 'duration', durationSeconds: -60 },
      'native.mirror': { mode: 'none' },
    }), 'invalid_retention');
  });

  it('should refuse a fractional duration', () => {
    expectConsentCode(() => validateRetentionByChannel({
      'terminal.cache': { mode: 'duration', durationSeconds: 1.5 },
      'native.mirror': { mode: 'none' },
    }), 'invalid_retention');
  });

  it('should refuse an overflowing duration beyond the safe integer range', () => {
    expectConsentCode(() => validateRetentionByChannel({
      'terminal.cache': { mode: 'duration', durationSeconds: Number.MAX_SAFE_INTEGER + 1 },
      'native.mirror': { mode: 'none' },
    }), 'invalid_retention');
  });

  it('should refuse an omitted channel as unsigned retention', () => {
    expectConsentCode(() => validateRetentionByChannel({
      'terminal.cache': { mode: 'none' },
    }), 'unsigned_retention');
  });

  it('should refuse an unsigned finite duration without an explicit tag', () => {
    expectConsentCode(() => validateRetentionByChannel({
      'terminal.cache': { durationSeconds: 3600 },
      'native.mirror': { mode: 'none' },
    }), 'unsigned_retention');
  });

  it('should refuse a malformed retention tag', () => {
    expectConsentCode(() => validateRetentionByChannel({
      'terminal.cache': { mode: 'forever' },
      'native.mirror': { mode: 'none' },
    }), 'invalid_retention');
  });

  it('should refuse a non-object retention map', () => {
    expectConsentCode(() => validateRetentionByChannel(null), 'invalid_retention');
  });

  it('should throw ContentConsentError instances', () => {
    try {
      validateRetentionByChannel(null);
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(ContentConsentError);
    }
  });
});

describe('content consent policy digest', () => {
  const policy = {
    projectId: 'project-1',
    projectRevision: 1,
    tenantId: 'tenant-a',
    workspaceId: 'workspace-1',
    ownerId: 'user-1',
    channels: { 'terminal.live': true, 'terminal.cache': true, 'native.mirror': false, 'keyboard.control': false },
    retentionByChannel: {
      'terminal.cache': { mode: 'none' },
      'native.mirror': { mode: 'none' },
    },
  };

  it('should recompute the same digest for the same canonical policy', () => {
    expect(computePolicyDigest(policy)).toBe(computePolicyDigest(structuredClone(policy)));
  });

  it('should change the digest when a duration is altered after preparation', () => {
    const altered = structuredClone(policy);
    altered.retentionByChannel['terminal.cache'] = { mode: 'duration', durationSeconds: 60 };
    expect(computePolicyDigest(altered)).not.toBe(computePolicyDigest(policy));
  });

  it('should verify a matching digest and reject a tampered policy', () => {
    const digest = computePolicyDigest(policy);
    expect(verifyPolicyDigest(policy, digest)).toBe(true);
    const tampered = structuredClone(policy);
    tampered.channels['native.mirror'] = true;
    expect(verifyPolicyDigest(tampered, digest)).toBe(false);
  });
});

describe('content consent project activation', () => {
  const baseInput = () => ({
    projectId: 'project-1',
    tenantId: 'tenant-a',
    workspaceId: 'workspace-1',
    workspaceIncarnation: 1,
    ownerId: 'user-1',
    sourceIdentities: ['workstation-1'],
    sourceTrustVersions: ['h2a-1.0+d2-1'],
    channels: { 'terminal.live': true, 'terminal.cache': true, 'native.mirror': false, 'keyboard.control': false },
    futureSessions: true,
    selectedSessionIds: [] as string[],
    namedHistories: [] as NamedHistoryDescriptor[],
    retentionByChannel: {
      'terminal.cache': { mode: 'none' },
      'native.mirror': { mode: 'none' },
    },
    authorityEpoch: 'epoch-1',
    offlineReadAccepted: true,
  });

  const setup = () => {
    const store = createMemoryContentConsentStore();
    let nowMs = 1_000_000;
    const service = createContentConsentService(store, { nowMs: () => nowMs });
    return { store, service, advance: (ms: number) => { nowMs += ms; } };
  };

  it('should prepare and accept one owner-confirmed project grant', async () => {
    const { service } = setup();
    const prepared = service.prepareProject(baseInput());
    expect(prepared.digest).toBe(computePolicyDigest(prepared.policy));
    const accepted = await service.acceptProject(prepared, { challengeId: prepared.challengeId });
    expect(accepted.projectRevision).toBe(1);
    expect(accepted.state).toBe('active');
    expect(accepted.readers).toEqual(['user-1']);
    expect(accepted.retentionDigest).toBe(prepared.digest);
  });

  it('should refuse preparation without explicit offline-risk acceptance', () => {
    const { service } = setup();
    expectConsentCode(
      () => service.prepareProject({ ...baseInput(), offlineReadAccepted: false }),
      'invalid_request',
    );
  });

  it('should refuse a non-owner reader with no admin inheritance', () => {
    const { service } = setup();
    expectConsentCode(
      () => service.prepareProject({ ...baseInput(), readers: ['user-1', 'admin-1'] }),
      'cross_owner_refused',
    );
  });

  it('should refuse preparation without enrolled source identity and trust', () => {
    const { service } = setup();
    expectConsentCode(
      () => service.prepareProject({ ...baseInput(), sourceIdentities: [] }),
      'invalid_request',
    );
    expectConsentCode(
      () => service.prepareProject({ ...baseInput(), sourceTrustVersions: [] }),
      'invalid_request',
    );
  });

  it('should refuse an extra retention key instead of applying a silent default', () => {
    const { service } = setup();
    expectConsentCode(
      () => service.prepareProject({
        ...baseInput(),
        retentionByChannel: {
          'terminal.cache': { mode: 'none' },
          'native.mirror': { mode: 'none' },
          default: { mode: 'duration', durationSeconds: 60 },
        },
      }),
      'invalid_request',
    );
  });

  it('should refuse acceptance when the duration was altered after preparation', async () => {
    const { store, service } = setup();
    const prepared = service.prepareProject(baseInput());
    const tampered = structuredClone(prepared);
    tampered.policy.retentionByChannel['terminal.cache'] = { mode: 'duration', durationSeconds: 60 };
    await expect(service.acceptProject(tampered, { challengeId: prepared.challengeId }))
      .rejects.toMatchObject({ code: 'policy_digest_mismatch' });
    expect(store.projectCount()).toBe(0);
  });

  it('should consume the one-use challenge and refuse its replay', async () => {
    const { service } = setup();
    const prepared = service.prepareProject(baseInput());
    await service.acceptProject(prepared, { challengeId: prepared.challengeId });
    await expect(service.acceptProject(prepared, { challengeId: prepared.challengeId }))
      .rejects.toMatchObject({ code: 'challenge_replayed' });
  });

  it('should refuse acceptance after the short-lived challenge expires', async () => {
    const { service, advance } = setup();
    const prepared = service.prepareProject(baseInput());
    advance(10 * 60_000);
    await expect(service.acceptProject(prepared, { challengeId: prepared.challengeId }))
      .rejects.toMatchObject({ code: 'challenge_expired' });
  });

  it('should refuse acceptance for an unknown challenge', async () => {
    const { service } = setup();
    const prepared = service.prepareProject(baseInput());
    await expect(service.acceptProject(prepared, { challengeId: 'challenge-unknown' }))
      .rejects.toMatchObject({ code: 'challenge_unknown' });
  });

  it('should leave zero activation behind a cancelled offer', async () => {
    const { store, service } = setup();
    service.prepareProject(baseInput());
    await expect(service.deriveChild({
      projectId: 'project-1', sessionId: 'session-9', bindingId: 'binding-9', bindingVersion: 1,
      d1Version: 3, d1Incarnation: 1, d1StartSeq: 40, tenantId: 'tenant-a', workspaceId: 'workspace-1',
      ownerId: 'user-1', sessionCreatedAt: 1_000_001, sourceGeneration: 'gen-1',
      sourceTrustVersion: 'h2a-1.0+d2-1', nativeStartSeq: 40,
    })).rejects.toMatchObject({ code: 'project_not_active' });
    expect(store.projectCount()).toBe(0);
  });

  it('should amend retention for future capture without rewriting the accepted revision', async () => {
    const { service } = setup();
    const prepared = service.prepareProject(baseInput());
    await service.acceptProject(prepared, { challengeId: prepared.challengeId });
    const rePrepared = service.prepareProject({
      ...baseInput(),
      expectedProjectRevision: 1,
      retentionByChannel: {
        'terminal.cache': { mode: 'duration', durationSeconds: 3600 },
        'native.mirror': { mode: 'none' },
      },
    });
    const amended = await service.acceptProject(rePrepared, { challengeId: rePrepared.challengeId });
    expect(amended.projectRevision).toBe(2);
    expect(amended.retentionByChannel['terminal.cache']).toEqual({ mode: 'duration', durationSeconds: 3600 });
    const current = await service.readProject('project-1');
    expect(current?.projectRevision).toBe(2);
    expect(verifyPolicyDigest(amended.acceptedPolicy, amended.retentionDigest)).toBe(true);
  });
});

describe('content consent child derivation', () => {
  it('should derive two eligible future sessions from one proof without a second prompt', async () => {
    const { service } = await readyConsent();
    const first = await service.deriveChild(sharedChildInput());
    const second = await service.deriveChild(sharedChildInput({ sessionId: 'session-2', bindingId: 'binding-2' }));
    expect(first.state).toBe('active');
    expect(second.state).toBe('active');
    expect(first.grantId).not.toBe(second.grantId);
    expect(second.projectRevision).toBe(1);
  });

  it('should bind the new D1 version and freeze the native boundary', async () => {
    const { service } = await readyConsent();
    const grant = await service.deriveChild(sharedChildInput());
    expect(grant.d1Version).toBe(3);
    expect(grant.d1Incarnation).toBe(1);
    expect(grant.d1StartSeq).toBe(40);
    expect(grant.nativeBoundarySeq).toBe(40);
    expect(grant.channels).toEqual({
      'terminal.live': true, 'terminal.cache': true, 'native.mirror': false, 'keyboard.control': false,
    });
  });

  it('should return the same grant when the same binding derives again', async () => {
    const { service } = await readyConsent();
    const first = await service.deriveChild(sharedChildInput());
    const again = await service.deriveChild(sharedChildInput());
    expect(again.grantId).toBe(first.grantId);
    expect(again.version).toBe(first.version);
  });

  it('should refuse an unnamed pre-existing session outside the project scope', async () => {
    const { service } = await readyConsent();
    await expectConsentCodeAsync(
      () => service.deriveChild(sharedChildInput({ sessionCreatedAt: 999_999 })),
      'ineligible_session',
    );
  });

  it('should refuse another project, source, owner and tenant', async () => {
    const { service } = await readyConsent();
    await expectConsentCodeAsync(
      () => service.deriveChild(sharedChildInput({ ownerId: 'user-2' })),
      'cross_owner_refused',
    );
    await expectConsentCodeAsync(
      () => service.deriveChild(sharedChildInput({ tenantId: 'tenant-b' })),
      'cross_tenant_refused',
    );
    await expectConsentCodeAsync(
      () => service.deriveChild(sharedChildInput({ sourceTrustVersion: 'h2a-9.9+d2-9' })),
      'source_reauthorization_required',
    );
    await expectConsentCodeAsync(
      () => service.deriveChild(sharedChildInput({ projectId: 'project-2' })),
      'project_not_active',
    );
  });

  it('should keep a grant bound to its own binding only', async () => {
    const { service } = await readyConsent();
    const grant = await service.deriveChild(sharedChildInput());
    expect(isGrantValidForBinding(grant, 'binding-1')).toBe(true);
    expect(isGrantValidForBinding(grant, 'binding-2')).toBe(false);
  });
});

describe('content consent revoke and exclusion', () => {
  it('should revoke one session grant while its sibling stays usable', async () => {
    const { service } = await readyConsent();
    await service.deriveChild(sharedChildInput());
    await service.deriveChild(sharedChildInput({ sessionId: 'session-2', bindingId: 'binding-2' }));
    await service.revokeGrant('session-1');
    await expectConsentCodeAsync(() => service.deriveChild(sharedChildInput()), 'grant_revoked');
    const sibling = await service.deriveChild(sharedChildInput({ sessionId: 'session-2', bindingId: 'binding-2' }));
    expect(sibling.state).toBe('active');
  });

  it('should fence derived children when their project is revoked', async () => {
    const { service } = await readyConsent();
    await service.deriveChild(sharedChildInput());
    await service.revokeProject('project-1');
    await expectConsentCodeAsync(() => service.deriveChild(sharedChildInput()), 'project_revoked');
    const grant = await service.readGrant('session-1');
    expect(grant?.state).toBe('revoked');
  });

  it('should refuse derivation for an excluded session and fence its grant', async () => {
    const { service } = await readyConsent();
    await service.deriveChild(sharedChildInput());
    await service.excludeSession('project-1', 'session-1');
    await expectConsentCodeAsync(() => service.deriveChild(sharedChildInput()), 'session_excluded');
    const grant = await service.readGrant('session-1');
    expect(grant?.state).toBe('excluded');
  });

  it('should keep a cleared exclusion suppressed until a fresh amendment', async () => {
    const { service, advance } = await readyConsent();
    advance(1_000);
    await service.deriveChild(sharedChildInput());
    await service.excludeSession('project-1', 'session-1');
    await service.clearExclusion('project-1', 'session-1');
    await expectConsentCodeAsync(() => service.deriveChild(sharedChildInput()), 'suppressed_scope');
    const project = await service.readProject('project-1');
    const rePrepared = service.prepareProject(sharedBaseInput({ expectedProjectRevision: project?.projectRevision }));
    await service.acceptProject(rePrepared, { challengeId: rePrepared.challengeId });
    const grant = await service.deriveChild(sharedChildInput({ bindingId: 'binding-2' }));
    expect(grant.state).toBe('active');
  });

  it('should settle a pending local denial on reconnect without purging copies', async () => {
    const { service } = await readyConsent();
    await service.deriveChild(sharedChildInput());
    const denied = await service.recordLocalDeny('session-1');
    expect(denied.localDenyPending).toBe(true);
    const reconciled = await service.reconcileLocalDeny('session-1');
    expect(reconciled.state).toBe('revoked');
    expect(reconciled.localDenyPending).toBe(false);
  });
});
