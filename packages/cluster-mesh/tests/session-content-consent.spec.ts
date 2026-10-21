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
  ...overrides,
});

const setupConsent = () => {
  const store = createMemoryContentConsentStore();
  let nowMs = 1_000_000;
  const service = createContentConsentService(store, { nowMs: () => nowMs });
  return { store, service, advance: (ms: number) => { nowMs += ms; }, now: () => nowMs };
};

const mirrorChannels = { 'terminal.live': true, 'terminal.cache': true, 'native.mirror': true, 'keyboard.control': false };

const readyConsent = async (overrides: Partial<ProjectPrepareInput> = {}) => {
  const context = setupConsent();
  const prepared = context.service.prepareProject(sharedBaseInput(overrides));
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
  it.each(['revoke', 'exclude', 'suppress'] as const)('should refuse N5 R8 in-flight derivation after project %s', async (denial) => {
    const { service, store } = await readyConsent();
    let entered!: () => void;
    let release!: () => void;
    const paused = new Promise<void>((resolve) => { entered = resolve; });
    const resume = new Promise<void>((resolve) => { release = resolve; });
    const concurrent = createContentConsentService({ ...store, async writeGrant(version, next) {
      entered(); await resume; return store.writeGrant(version, next);
    } });
    const stale = concurrent.deriveChild(sharedChildInput());
    await paused;
    try {
      if (denial === 'revoke') await service.revokeProject('project-1');
      else if (denial === 'exclude') await service.excludeSession('project-1', 'session-1');
      else await service.clearExclusion('project-1', 'unrelated');
    } finally { release(); }
    await expect(stale).rejects.toBeInstanceOf(ContentConsentError);
    expect(await service.readGrant('session-1')).toBeNull();
  });

  it.each(['project', 'grant'] as const)('should preserve N5 R8 capture denial in the concurrent %s repro', async (scope) => {
    const { service } = setupConsent();
    const prepared = service.prepareProject(sharedBaseInput({ channels: {
      'terminal.live': true, 'terminal.cache': true, 'native.mirror': true, 'keyboard.control': false,
    } }));
    await service.acceptProject(prepared, { challengeId: prepared.challengeId });
    await service.deriveChild(sharedChildInput());
    if (scope === 'project') {
      await service.closeGrant('session-1');
      await Promise.all([service.revokeProject('project-1'), service.excludeSession('project-1', 'unrelated')]);
      await expect(service.deriveChild(sharedChildInput({ sessionId: 'next', bindingId: 'next' }))).rejects.toBeInstanceOf(ContentConsentError);
    } else {
      await Promise.all([service.revokeGrant('session-1'), service.acknowledgeFreshness('session-1')]);
      await expect(service.deriveChild(sharedChildInput())).rejects.toBeInstanceOf(ContentConsentError);
    }
    const grant = (await service.readGrant('session-1'))!;
    const project = (await service.readProject('project-1'))!;
    expect(partitionExportableNativeRecords(grant, project, [
      { seq: 41, lineage: 'l', conversationId: 'c', ordered: true },
    ]).exportable).toEqual([]);
  });

  it.each(['exclude', 'clear', 'amend'] as const)('should fence N5 R8 stale project %s after revocation', async (operation) => {
    const { service, store } = await readyConsent();
    let entered!: () => void;
    let release!: () => void;
    const paused = new Promise<void>((resolve) => { entered = resolve; });
    const resume = new Promise<void>((resolve) => { release = resolve; });
    const concurrent = createContentConsentService({ ...store, async writeProject(revision, next) {
      entered(); await resume;
      return store.writeProject(revision, next);
    } });
    const amendment = concurrent.prepareProject(sharedBaseInput({ expectedProjectRevision: 1 }));
    const stale = operation === 'exclude' ? concurrent.excludeSession('project-1', 'other')
      : operation === 'clear' ? concurrent.clearExclusion('project-1', 'other')
        : concurrent.acceptProject(amendment, { challengeId: amendment.challengeId });
    await paused;
    try { await service.revokeProject('project-1'); } finally { release(); }
    const returned = await stale.catch((error: unknown) => { expect(error).toBeInstanceOf(ContentConsentError); });
    if (returned) expect(returned.state).toBe('revoked');
    expect((await service.readProject('project-1'))?.state).toBe('revoked');
    await expect(service.deriveChild(sharedChildInput())).rejects.toBeInstanceOf(ContentConsentError);
  });

  it.each((['freshness', 'close', 'refresh', 'local'] as const).flatMap((operation) =>
    (['revoke', 'exclude', 'close', 'pending', 'reconcile'] as const).map((denial) => [operation, denial] as const)))(
    'should fence N5 R8 stale %s against %s', async (operation, denial) => {
        const { service, store } = await readyConsent({ channels: mirrorChannels });
        await service.deriveChild(sharedChildInput());
        const amendment = service.prepareProject(sharedBaseInput({ channels: mirrorChannels, expectedProjectRevision: 1 }));
        await service.acceptProject(amendment, { challengeId: amendment.challengeId });
        let entered!: () => void;
        let release!: () => void;
        const paused = new Promise<void>((resolve) => { entered = resolve; });
        const resume = new Promise<void>((resolve) => { release = resolve; });
        const concurrent = createContentConsentService({ ...store, async writeGrant(version, next) {
          entered(); await resume;
          return store.writeGrant(version, next);
        } });
        const stale = operation === 'freshness' ? concurrent.acknowledgeFreshness('session-1')
          : operation === 'close' ? concurrent.closeGrant('session-1')
            : operation === 'local' ? concurrent.recordLocalDeny('session-1')
              : concurrent.refreshChild({ ...sharedChildInput(), expectedProjectRevision: 2,
                policyDigest: amendment.digest, nativeBoundarySeq: 41 });
        await paused;
        try {
          if (denial === 'revoke') await service.revokeGrant('session-1');
          if (denial === 'exclude') await service.excludeSession('project-1', 'session-1');
          if (denial === 'close') await service.closeGrant('session-1');
          if (denial === 'pending' || denial === 'reconcile') await service.recordLocalDeny('session-1');
          if (denial === 'reconcile') await service.reconcileLocalDeny('session-1');
        } finally { release(); }
        const returned = await stale.catch((error: unknown) => { expect(error).toBeInstanceOf(ContentConsentError); });
        if (returned) expect(returned.state !== 'active' || returned.localDenyPending, `returned ${operation}/${denial}`).toBe(true);
        const grant = (await service.readGrant('session-1'))!;
        expect(grant.state !== 'active' || grant.localDenyPending, `${operation}/${denial}`).toBe(true);
        const project = (await service.readProject('project-1'))!;
        expect(partitionExportableNativeRecords(grant, project, [
          { seq: 42, lineage: 'l', conversationId: 'c', ordered: true },
        ]).exportable, `${operation}/${denial}`).toEqual([]);
    });

  it.each(['exclude', 'amend', 'clear', 'amend-after-clear'] as const)('should preserve N5 R8 project suppression against stale %s', async (operation) => {
    const { service, store } = await readyConsent();
    let entered!: () => void;
    let release!: () => void;
    const paused = new Promise<void>((resolve) => { entered = resolve; });
    const resume = new Promise<void>((resolve) => { release = resolve; });
    const concurrent = createContentConsentService({ ...store, async writeProject(revision, next) {
      entered(); await resume;
      return store.writeProject(revision, next);
    } });
    const amendment = concurrent.prepareProject(sharedBaseInput({ expectedProjectRevision: 1 }));
    const stale = operation.startsWith('amend') ? concurrent.acceptProject(amendment, { challengeId: amendment.challengeId })
      : operation === 'clear' ? concurrent.clearExclusion('project-1', 'unrelated')
        : concurrent.excludeSession('project-1', 'unrelated');
    await paused;
    try {
      await service.excludeSession('project-1', 'session-1');
      if (operation === 'amend-after-clear') await service.clearExclusion('project-1', 'session-1');
    } finally { release(); }
    await stale;
    const project = (await service.readProject('project-1'))!;
    if (operation === 'amend-after-clear') expect(project.requiresFreshAmendment).toBe(true);
    else expect(project.excludedSessionIds).toContain('session-1');
    await expect(service.deriveChild(sharedChildInput())).rejects.toBeInstanceOf(ContentConsentError);
  });

  it('should refuse N5 R8 export and derivation after a pending local denial while retaining read semantics', async () => {
    const { service } = await readyConsent({ channels: mirrorChannels });
    const grant = await service.deriveChild(sharedChildInput());
    const project = (await service.readProject('project-1'))!;
    const records = [{ seq: 41, lineage: 'l', conversationId: 'c', ordered: true }];
    expect(partitionExportableNativeRecords(grant, project, records).exportable).toHaveLength(1);
    await service.recordLocalDeny('session-1');
    const pending = (await service.readGrant('session-1'))!;
    expect(pending.readDenied).toBe(false);
    expect(partitionExportableNativeRecords(pending, project, records).exportable).toEqual([]);
    await expect(service.deriveChild(sharedChildInput())).rejects.toBeInstanceOf(ContentConsentError);
  });

  it.each(['revoke', 'exclude', 'amend', 'mirror-off'] as const)('should refuse N5 R8 export with a current %s project fence', async (fence) => {
    const { service } = await readyConsent({ channels: mirrorChannels });
    const grant = await service.deriveChild(sharedChildInput());
    if (fence === 'revoke') await service.revokeProject('project-1');
    else if (fence === 'exclude') await service.excludeSession('project-1', 'session-1');
    else {
      const prepared = service.prepareProject(sharedBaseInput({ expectedProjectRevision: 1,
        channels: { ...mirrorChannels, 'native.mirror': fence !== 'mirror-off' } }));
      await service.acceptProject(prepared, { challengeId: prepared.challengeId });
    }
    expect(partitionExportableNativeRecords(grant, (await service.readProject('project-1'))!, [
      { seq: 41, lineage: 'l', conversationId: 'c', ordered: true },
    ]).exportable).toEqual([]);
  });

  it.each(['grant-close', 'project-exclude'] as const)(
    'should preserve N5 R3 denial across deterministic concurrent %s writes', async (race) => {
      const { service, store } = await readyConsent();
      await service.deriveChild(sharedChildInput());
      await service.closeGrant('session-1');
      if (race === 'grant-close') {
        await service.deriveChild(sharedChildInput({ bindingId: 'replacement', bindingVersion: 2 }));
      }
      const ceilings = { 'terminal.cache': null, 'native.mirror': null } as const;
      const history = await service.authorizeHistoryRead('session-1', ceilings);
      expect(await service.canReadClosed('session-1', history.authorizationId)).toBe(true);
      let entered!: () => void;
      let release!: () => void;
      const paused = new Promise<void>((resolve) => { entered = resolve; });
      const resume = new Promise<void>((resolve) => { release = resolve; });
      const concurrent = createContentConsentService({ ...store,
        async writeGrant(version, next) {
          if (race === 'grant-close') { entered(); await resume; }
          return store.writeGrant(version, next);
        },
        async writeProject(revision, next) {
          if (race === 'project-exclude') { entered(); await resume; }
          return store.writeProject(revision, next);
        },
      });
      const stale = race === 'grant-close' ? concurrent.closeGrant('session-1')
        : concurrent.excludeSession('project-1', 'unrelated-session');
      await paused; // The mutation already read the pre-revocation snapshot.
      try {
        if (race === 'grant-close') await service.revokeGrant('session-1');
        else await service.revokeProject('project-1');
      } finally { release(); }
      await stale;
      expect(await service.canReadClosed('session-1', history.authorizationId)).toBe(false);
      await expect(service.authorizeHistoryRead('session-1', ceilings)).rejects.toBeInstanceOf(ContentConsentError);
    });

  it.each(['grant-close', 'project-exclude'] as const)(
    'should preserve N5 R3 denial in the reviewer Promise.all %s repro', async (race) => {
      const { service } = await readyConsent();
      await service.deriveChild(sharedChildInput());
      if (race === 'grant-close') {
        await Promise.all([service.revokeGrant('session-1'), service.closeGrant('session-1')]);
      } else {
        await service.closeGrant('session-1');
        const history = await service.authorizeHistoryRead('session-1', { 'terminal.cache': null, 'native.mirror': null });
        await Promise.all([service.revokeProject('project-1'), service.excludeSession('project-1', 'unrelated-session')]);
        expect(await service.canReadClosed('session-1', history.authorizationId)).toBe(false);
      }
      await expect(service.authorizeHistoryRead('session-1', {
        'terminal.cache': null, 'native.mirror': null,
      })).rejects.toBeInstanceOf(ContentConsentError);
    });

  it('should preserve N5 R3 read denial when a confirmed amendment derives a replacement binding', async () => {
    const { service } = await readyConsent();
    await service.deriveChild(sharedChildInput());
    await service.closeGrant('session-1');
    const history = await service.authorizeHistoryRead('session-1', { 'terminal.cache': null, 'native.mirror': null });
    await service.revokeGrant('session-1');
    const amendment = service.prepareProject(sharedBaseInput({ expectedProjectRevision: 1 }));
    await service.acceptProject(amendment, { challengeId: amendment.challengeId });
    await service.deriveChild(sharedChildInput({ bindingId: 'replacement', bindingVersion: 2 }));
    expect(await service.canReadClosed('session-1', history.authorizationId)).toBe(false);
    await expectConsentCodeAsync(() => service.authorizeHistoryRead('session-1', {
      'terminal.cache': null, 'native.mirror': null,
    }), 'grant_revoked');
  });

  it.each(['owner', 'tenant'] as const)('should refuse N5 R5 domain amendment scope transfer by %s', async (scope) => {
    const { service } = await readyConsent();
    const before = await service.readProject('project-1');
    const amendment = service.prepareProject(sharedBaseInput({ expectedProjectRevision: 1,
      ...(scope === 'owner' ? { ownerId: 'user-b' } : { tenantId: 'tenant-b' }),
    }));
    await expectConsentCodeAsync(() => service.acceptProject(amendment, {
      challengeId: amendment.challengeId,
    }), 'cross_owner_refused');
    expect(await service.readProject('project-1')).toEqual(before);
  });

  it.each(['grant', 'project', 'exclude', 'close'] as const)(
    'should preserve N5 R3 closed-history denial after %s transitions', async (transition) => {
      const { service } = await readyConsent();
      await service.deriveChild(sharedChildInput());
      await service.closeGrant('session-1');
      const history = await service.authorizeHistoryRead('session-1', {
        'terminal.cache': null, 'native.mirror': null,
      });
      expect(await service.canReadClosed('session-1', history.authorizationId)).toBe(true);
      if (transition === 'project') await service.revokeProject('project-1');
      else await service.revokeGrant('session-1');
      if (transition === 'exclude') await service.excludeSession('project-1', 'session-1');
      if (transition === 'close') await expectConsentCodeAsync(() => service.closeGrant('session-1'), 'grant_closed');
      expect(await service.canReadClosed('session-1', history.authorizationId)).toBe(false);
      await expect(service.authorizeHistoryRead('session-1', {
        'terminal.cache': null, 'native.mirror': null,
      })).rejects.toBeInstanceOf(ContentConsentError);
    });

  it('should refuse N5 R4 exclusion of another project tenant and owner without mutations', async () => {
    const { service, store } = await readyConsent();
    const prepared = service.prepareProject(sharedBaseInput({
      projectId: 'victim-project', tenantId: 'tenant-b', workspaceId: 'workspace-b', ownerId: 'user-b',
    }));
    await service.acceptProject(prepared, { challengeId: prepared.challengeId });
    const victim = await service.deriveChild(sharedChildInput({
      projectId: 'victim-project', tenantId: 'tenant-b', workspaceId: 'workspace-b', ownerId: 'user-b',
    }));
    const project = await service.readProject('project-1');
    await expectConsentCodeAsync(() => service.excludeSession('project-1', victim.sessionId), 'cross_owner_refused');
    expect(await store.readGrant(victim.sessionId)).toEqual(victim);
    expect(await service.readProject('project-1')).toEqual(project);
  });

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

  it('should prepare explicit sharing without a separate offline-risk receipt', () => {
    const { service } = setup();
    const prepared = service.prepareProject(baseInput());
    expect(prepared.policy).not.toHaveProperty('offlineReadAccepted');
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

  it('should leave another project children alone when one project is revoked', async () => {
    const { service } = setupConsent();
    const first = service.prepareProject(sharedBaseInput());
    await service.acceptProject(first, { challengeId: first.challengeId });
    const second = service.prepareProject(sharedBaseInput({ projectId: 'project-2' }));
    await service.acceptProject(second, { challengeId: second.challengeId });
    await service.deriveChild(sharedChildInput());
    await service.deriveChild(sharedChildInput({ projectId: 'project-2', sessionId: 'session-2', bindingId: 'binding-2' }));
    await service.revokeProject('project-1');
    await expectConsentCodeAsync(() => service.deriveChild(sharedChildInput()), 'project_revoked');
    const survivor = await service.deriveChild(
      sharedChildInput({ projectId: 'project-2', sessionId: 'session-2', bindingId: 'binding-2' }),
    );
    expect(survivor.state).toBe('active');
  });
});

describe('content consent freshness and closed history', () => {
  it('should bind a finite capture deadline once and never extend it', () => {
    expect(captureExpiresAt({ mode: 'none' }, 1_000_000)).toBe(null);
    const deadline = captureExpiresAt({ mode: 'duration', durationSeconds: 3600 }, 1_000_000);
    expect(deadline).toBe(1_000_000 + 3_600_000);
    expect(captureExpiresAt({ mode: 'duration', durationSeconds: 3600 }, 1_000_000)).toBe(deadline);
  });

  it('should expire live freshness on a fake clock while keeping stored reads available', async () => {
    const { service, advance, now } = await readyConsent();
    const grant = await service.deriveChild(sharedChildInput());
    checkGrantLiveness(grant, now(), 60_000);
    advance(61_000);
    expectConsentCode(() => checkGrantLiveness(grant, now(), 60_000), 'live_expired');
    const refreshed = await service.acknowledgeFreshness('session-1');
    checkGrantLiveness(refreshed, now(), 60_000);
  });

  it('should refuse a grant clock running behind its acknowledgement', async () => {
    const { service } = await readyConsent();
    const grant = await service.deriveChild(sharedChildInput());
    expectConsentCode(() => checkGrantLiveness(grant, 1_000_000 - 120_000, 60_000, 60_000), 'lease_skew_exceeded');
  });

  it('should retain closed copies but deny closed reads without history authority', async () => {
    const { service } = await readyConsent();
    const grant = await service.deriveChild(sharedChildInput());
    const closed = await service.closeGrant('session-1');
    expect(closed.state).toBe('closed');
    expect(closed.retainedCopies).toBe(true);
    expect(await service.canReadClosed('session-1', 'auth-unknown')).toBe(false);
    const authorization = await service.authorizeHistoryRead('session-1', {
      'terminal.cache': null,
      'native.mirror': null,
    });
    expect(await service.canReadClosed('session-1', authorization.authorizationId)).toBe(true);
    await service.revokeHistoryAuthorization(authorization.authorizationId);
    expect(await service.canReadClosed('session-1', authorization.authorizationId)).toBe(false);
    expect(grant.retainedCopies).toBe(false);
  });

  it('should never let a history authorization create a duration', async () => {
    const { service } = await readyConsent();
    await service.deriveChild(sharedChildInput());
    await service.closeGrant('session-1');
    await expectConsentCodeAsync(
      () => service.authorizeHistoryRead('session-1', { 'terminal.cache': 2_000_000, 'native.mirror': null }),
      'invalid_retention',
    );
    await expectConsentCodeAsync(
      () => service.authorizeHistoryRead('session-9', { 'terminal.cache': null, 'native.mirror': null }),
      'invalid_request',
    );
  });
});

describe('content consent native boundary (CM2-R4-4)', () => {
  const namedRange = {
    provider: 'pty',
    conversationId: 'conv-old',
    lineage: 'lineage-old',
    sourceIdentity: 'workstation-1',
    checkpoint: 'checkpoint-7',
    rangeDigest: 'digest-7',
    startSeq: 5,
    endSeq: 20,
  };

  it('should copy only new eligible records for a child resuming an old conversation', async () => {
    const { service } = setupConsent();
    const prepared = service.prepareProject(sharedBaseInput({ channels: mirrorChannels }));
    const project = await service.acceptProject(prepared, { challengeId: prepared.challengeId });
    const grant = await service.deriveChild(sharedChildInput({
      resumedConversation: { conversationId: 'conv-old', lineage: 'lineage-old', ordered: true },
    }));
    expect(grant.nativeBoundarySeq).toBe(40);
    const partition = partitionExportableNativeRecords(grant, project, [
      { seq: 10, lineage: 'lineage-old', conversationId: 'conv-old', ordered: true },
      { seq: 45, lineage: 'lineage-old', conversationId: 'conv-old', ordered: true },
    ]);
    expect(partition.exportable.map((record) => record.seq)).toEqual([45]);
    expect(partition.withheld).toEqual([
      { seq: 10, lineage: 'lineage-old', conversationId: 'conv-old', ordered: true, reason: 'pre_boundary' },
    ]);
  });

  it('should add only the exact named older range after an amendment', async () => {
    const { service } = setupConsent();
    const prepared = service.prepareProject(sharedBaseInput({ channels: mirrorChannels }));
    await service.acceptProject(prepared, { challengeId: prepared.challengeId });
    await service.deriveChild(sharedChildInput());
    const rePrepared = service.prepareProject(sharedBaseInput({ channels: mirrorChannels, expectedProjectRevision: 1, namedHistories: [namedRange] }));
    const amended = await service.acceptProject(rePrepared, { challengeId: rePrepared.challengeId });
    const grant = await service.refreshChild({ ...sharedChildInput(), expectedProjectRevision: 2,
      policyDigest: amended.retentionDigest, nativeBoundarySeq: 40 });
    const partition = partitionExportableNativeRecords(grant, amended, [
      { seq: 12, lineage: 'lineage-old', conversationId: 'conv-old', ordered: true },
      { seq: 3, lineage: 'lineage-old', conversationId: 'conv-old', ordered: true },
      { seq: 9, lineage: 'lineage-other', conversationId: 'conv-other', ordered: true },
      { seq: 8, lineage: 'lineage-old', conversationId: 'conv-old', ordered: false },
      { seq: 50, lineage: 'lineage-old', conversationId: 'conv-old', ordered: true },
    ]);
    expect(partition.exportable.map((record) => record.seq).sort((a, b) => a - b)).toEqual([12, 50]);
    expect(partition.withheld.map((record) => `${record.seq}:${record.reason}`).sort()).toEqual([
      '3:pre_boundary',
      '8:unprovable_range',
      '9:pre_boundary',
    ]);
  });

  it('should derive a pre-existing session only through an exact named range', async () => {
    const { service } = setupConsent();
    const prepared = service.prepareProject(sharedBaseInput({ namedHistories: [namedRange] }));
    await service.acceptProject(prepared, { challengeId: prepared.challengeId });
    const grant = await service.deriveChild(sharedChildInput({
      sessionCreatedAt: 999_999,
      resumedConversation: { conversationId: 'conv-old', lineage: 'lineage-old', ordered: true },
    }));
    expect(grant.nativeBoundarySeq).toBe(5);
    await expectConsentCodeAsync(
      () => service.deriveChild(sharedChildInput({
        sessionId: 'session-2',
        bindingId: 'binding-2',
        sessionCreatedAt: 999_999,
        resumedConversation: { conversationId: 'conv-old', lineage: 'lineage-old', ordered: false },
      })),
      'unprovable_range',
    );
    await expectConsentCodeAsync(
      () => service.deriveChild(sharedChildInput({
        sessionId: 'session-3',
        bindingId: 'binding-3',
        sessionCreatedAt: 999_999,
        resumedConversation: { conversationId: 'conv-unknown', lineage: 'lineage-unknown', ordered: true },
      })),
      'not_resumable',
    );
  });
});

describe('content consent amendment refresh (N3)', () => {
  let currentDigest = '';
  const refreshInput = (overrides = {}) => ({
    projectId: 'project-1',
    sessionId: 'session-1',
    bindingId: 'binding-1',
    bindingVersion: 1,
    d1Version: 3,
    tenantId: 'tenant-a',
    workspaceId: 'workspace-1',
    ownerId: 'user-1',
    sessionCreatedAt: 1_000_001,
    sourceGeneration: 'gen-1',
    sourceTrustVersion: 'h2a-1.0+d2-1',
    nativeBoundarySeq: 41,
    expectedProjectRevision: 2,
    policyDigest: currentDigest,
    ...overrides,
  });

  const amendToTwo = async (service, overrides = {}) => {
    const rePrepared = service.prepareProject(sharedBaseInput({ expectedProjectRevision: 1, ...overrides }));
    await service.acceptProject(rePrepared, { challengeId: rePrepared.challengeId });
    currentDigest = rePrepared.digest;
    return rePrepared.digest;
  };

  it('should refresh two live children to the amended revision without per-child confirmation', async () => {
    const { service } = await readyConsent();
    const first = await service.deriveChild(sharedChildInput());
    const second = await service.deriveChild(sharedChildInput({ sessionId: 'session-2', bindingId: 'binding-2' }));
    const digest = await amendToTwo(service, {
      retentionByChannel: { 'terminal.cache': { mode: 'duration', durationSeconds: 3600 }, 'native.mirror': { mode: 'none' } },
    });
    await expectConsentCodeAsync(() => service.deriveChild(sharedChildInput()), 'project_revision_changed');
    const r1 = await service.refreshChild(refreshInput({ policyDigest: digest }));
    expect(r1.grantId).toBe(first.grantId);
    expect(r1.projectRevision).toBe(2);
    expect(r1.version).toBe(2);
    expect(r1.retentionSnapshot['terminal.cache']).toEqual({ mode: 'duration', durationSeconds: 3600 });
    expect(r1.nativeBoundarySeq).toBe(41);
    const r2 = await service.refreshChild(refreshInput({ sessionId: 'session-2', bindingId: 'binding-2', policyDigest: digest }));
    expect(r2.grantId).toBe(second.grantId);
    expect(r2.projectRevision).toBe(2);
    const project = await service.readProject('project-1');
    expect(project?.activatedAt).toBe(1_000_000);
    const dup = await service.refreshChild(refreshInput({ policyDigest: digest }));
    expect(dup.version).toBe(2);
    expect(dup.projectRevision).toBe(2);
  });

  it('should refuse refresh outside the amended scope and on stale acknowledgments', async () => {
    const { service } = await readyConsent();
    await service.deriveChild(sharedChildInput());
    await amendToTwo(service, { futureSessions: false, selectedSessionIds: [] });
    await expectConsentCodeAsync(() => service.refreshChild(refreshInput()), 'ineligible_session');
    await expectConsentCodeAsync(
      () => service.refreshChild(refreshInput({ expectedProjectRevision: 1 })),
      'revision_conflict',
    );
  });

  it('should refuse refresh for excluded, closed and replaced-source children', async () => {
    const { service } = await readyConsent();
    await service.deriveChild(sharedChildInput());
    await service.deriveChild(sharedChildInput({ sessionId: 'session-2', bindingId: 'binding-2' }));
    await service.deriveChild(sharedChildInput({ sessionId: 'session-3', bindingId: 'binding-3' }));
    await service.excludeSession('project-1', 'session-1');
    await amendToTwo(service);
    await expectConsentCodeAsync(() => service.refreshChild(refreshInput()), 'session_excluded');
    await service.closeGrant('session-2');
    await expectConsentCodeAsync(
      () => service.refreshChild(refreshInput({ sessionId: 'session-2', bindingId: 'binding-2' })),
      'grant_closed',
    );
    await expectConsentCodeAsync(
      () => service.refreshChild(refreshInput({
        sessionId: 'session-3', bindingId: 'binding-3', sourceTrustVersion: 'h2a-9.9+d2-9',
      })),
      'source_reauthorization_required',
    );
  });
});

describe('content consent refresh binds (P3/m1)', () => {
  const refreshInput = (overrides = {}) => ({
    projectId: 'project-1',
    sessionId: 'session-1',
    bindingId: 'binding-1',
    bindingVersion: 1,
    d1Version: 3,
    tenantId: 'tenant-a',
    workspaceId: 'workspace-1',
    ownerId: 'user-1',
    sessionCreatedAt: 1_000_001,
    sourceGeneration: 'gen-1',
    sourceTrustVersion: 'h2a-1.0+d2-1',
    nativeBoundarySeq: 41,
    expectedProjectRevision: 2,
    policyDigest: '',
    ...overrides,
  });

  const amendToTwo = async (service, overrides = {}) => {
    const rePrepared = service.prepareProject(sharedBaseInput({ expectedProjectRevision: 1, ...overrides }));
    await service.acceptProject(rePrepared, { challengeId: rePrepared.challengeId });
    return rePrepared.digest;
  };

  it('should refuse refresh on replaced generation or changed D1 version without overwriting', async () => {
    const { service } = await readyConsent();
    const first = await service.deriveChild(sharedChildInput());
    const digest = await amendToTwo(service);
    await expectConsentCodeAsync(
      () => service.refreshChild(refreshInput({ policyDigest: digest, sourceGeneration: 'gen-2' })),
      'source_reauthorization_required',
    );
    await expectConsentCodeAsync(
      () => service.refreshChild(refreshInput({ policyDigest: digest, d1Version: 2 })),
      'ineligible_session',
    );
    await expectConsentCodeAsync(
      () => service.refreshChild(refreshInput({ policyDigest: digest, bindingVersion: 2 })),
      'ineligible_session',
    );
    const grant = await service.readGrant('session-1');
    expect(grant?.sourceGeneration).toBe('gen-1');
    expect(grant?.bindingVersion).toBe(first.bindingVersion);
    expect(grant?.d1Version).toBe(first.d1Version);
    expect(grant?.projectRevision).toBe(1);
  });

  it('should bind refresh to the digest with a forward boundary, fresh ack and reconciled deny', async () => {
    const { service } = await readyConsent();
    await service.deriveChild(sharedChildInput());
    const digest = await amendToTwo(service);
    await expectConsentCodeAsync(
      () => service.refreshChild(refreshInput({ policyDigest: '0'.repeat(64), nativeBoundarySeq: 41 })),
      'revision_conflict',
    );
    await expectConsentCodeAsync(
      () => service.refreshChild(refreshInput({ policyDigest: digest, nativeBoundarySeq: 4 })),
      'invalid_request',
    );
    await service.recordLocalDeny('session-1');
    await expectConsentCodeAsync(
      () => service.refreshChild(refreshInput({ policyDigest: digest })),
      'invalid_request',
    );
    await service.reconcileLocalDeny('session-1');
    await expectConsentCodeAsync(
      () => service.refreshChild(refreshInput({ policyDigest: digest })),
      'grant_revoked',
    );
  });
});
