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
