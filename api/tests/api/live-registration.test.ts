import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { db } from '../../src/db/client';
import { liveGitDeclarations } from '../../src/db/control-schema';
import {
  PostgresLiveDeclarationStore,
  canonicalLiveDeclarationIdentity,
  deriveCloneIdentity,
  deriveWorktreeIdentity,
  deriveDeclarationIdentity,
  INITIAL_DECLARATION_REVISION,
  INITIAL_BINDING_REVISION,
  POLICY_VERSION,
} from '../../src/services/cluster-mesh/live-declarations';

const store = new PostgresLiveDeclarationStore(canonicalLiveDeclarationIdentity);

beforeEach(async () => { await db.delete(liveGitDeclarations); });
afterEach(async () => { await db.delete(liveGitDeclarations); });

function makeDeclaration(overrides: Record<string, unknown> = {}) {
  const clone = deriveCloneIdentity({
    hostScope: 'host:test',
    commonDirRealpath: '/srv/repo/.git',
    commonDirProjectFingerprint: 'proj-fp-1',
    identityUncertainty: [],
    oidAlgorithm: 'sha1',
  });
  const worktree = deriveWorktreeIdentity({
    hostScope: 'host:test',
    clone,
    worktreePath: '/srv/repo',
    gitDir: '/srv/repo/.git',
    worktreeFingerprint: 'ws:test-1',
    identityUncertainty: [],
  });
  const identity = deriveDeclarationIdentity({ hostScope: 'host:test', clone, worktree });
  return {
    tenant: 'tenant-test',
    principal: 'principal-test',
    hostFingerprint: 'ws:test-1',
    identityUncertainty: [] as const,
    declarationId: identity.declarationId,
    cloneId: identity.cloneId,
    worktreeId: identity.worktreeId,
    authorizedRoots: ['/srv/repo'],
    liveCapability: 'live' as const,
    policyVersion: POLICY_VERSION,
    declarationRevision: INITIAL_DECLARATION_REVISION,
    ...overrides,
  };
}

describe('live registration product-binding persistence (L6a)', () => {
  it('enforces complete product-binding triplet and initial revision 1', async () => {
    const partial = makeDeclaration({ serverWorkspaceId: 'ws-1' });
    await expect(store.save(partial as never)).rejects.toThrow();

    const bound = makeDeclaration({
      serverWorkspaceId: 'ws-1',
      serverIssuer: 'https://idp.example',
      bindingRevision: INITIAL_BINDING_REVISION,
    });
    await store.save(bound as never);
    const found = await store.find('tenant-test', bound.declarationId, bound.cloneId, bound.worktreeId);
    expect(found).toMatchObject({
      serverWorkspaceId: 'ws-1',
      serverIssuer: 'https://idp.example',
      bindingRevision: INITIAL_BINDING_REVISION,
    });
  });

  it('revocation targets exactly one declaration by the declarationId/cloneId/worktreeId triple', async () => {
    const decl = makeDeclaration({
      serverWorkspaceId: 'ws-2',
      serverIssuer: 'https://idp.example',
      bindingRevision: INITIAL_BINDING_REVISION,
    });
    await store.save(decl as never);

    const purge = { purgePrivateSnapshots: true as const, purgeDerivedIndexes: true as const, revokeDecryptability: true as const, preserveCommittedHistory: true as const };
    const withdrawal = { declarationId: decl.declarationId, tenant: decl.tenant, cloneId: decl.cloneId, worktreeId: 'wt:mismatch', declarationRevision: decl.declarationRevision, reason: 'workspace-remove' as const, requestPrivatePurge: purge };
    expect(await store.recordWithdrawal(withdrawal as never, '2026-10-12T14:00:00Z')).toBe(false);

    const matching = { ...withdrawal, worktreeId: decl.worktreeId };
    expect(await store.recordWithdrawal(matching as never, '2026-10-12T14:01:00Z')).toBe(true);
    expect(await store.status('tenant-test', decl.declarationId, decl.cloneId, decl.worktreeId)).toBe('withdrawn');

    const [row] = await db.select().from(liveGitDeclarations).where(eq(liveGitDeclarations.tenantId, 'tenant-test'));
    expect(row.status).toBe('withdrawn');
  });

  it('persists declarations with missing_history uncertainty and omitted fingerprint', async () => {
    const clone = deriveCloneIdentity({ hostScope: 'host:test', commonDirRealpath: '/srv/empty/.git', identityUncertainty: ['missing_history'], oidAlgorithm: 'sha1' });
    const worktree = deriveWorktreeIdentity({ hostScope: 'host:test', clone, worktreePath: '/srv/empty', gitDir: '/srv/empty/.git', identityUncertainty: ['missing_history'] });
    const identity = deriveDeclarationIdentity({ hostScope: 'host:test', clone, worktree });
    const decl = { tenant: 'tenant-test', principal: 'principal-test', identityUncertainty: ['missing_history'] as const, declarationId: identity.declarationId, cloneId: identity.cloneId, worktreeId: identity.worktreeId, authorizedRoots: ['/srv/empty'], liveCapability: 'live' as const, policyVersion: POLICY_VERSION, declarationRevision: INITIAL_DECLARATION_REVISION };
    await store.save(decl as never);
    const found = await store.find('tenant-test', decl.declarationId, decl.cloneId, decl.worktreeId);
    expect(found).toMatchObject({ declarationId: identity.declarationId, identityUncertainty: ['missing_history'] });
    expect(found?.hostFingerprint).toBeUndefined();
  });
});
