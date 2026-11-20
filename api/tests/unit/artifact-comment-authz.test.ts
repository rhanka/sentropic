import { describe, expect, it } from 'vitest';
import type { ArtifactAcl, SharingPolicyContext } from '@sentropic/artifacts/server/access';
import type { ArtifactState } from '@sentropic/artifacts/server/lifecycle';
import { artifactAuthority, type ArtifactHostIdentity } from '../../src/services/artifacts/authorization';
import { createArtifactCommentAuthz, type ArtifactCommentAuthzPorts } from '../../src/services/comments/artifact-comment-authz';

const [ART_PRIVATE, ART_SHARED, ART_GRANT, ART_OTHER_WS, ART_DELETED, ART_PUBLIC, ART_MISSING] = [
  '11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222', '33333333-3333-4333-8333-333333333333',
  '44444444-4444-4444-8444-444444444444', '55555555-5555-4555-8555-555555555555', '66666666-6666-4666-8666-666666666666',
  '99999999-9999-4999-8999-999999999999',
];
const NOT_FOUND = { ok: false, status: 404, code: 'artifact_not_found' } as const;
const FORBIDDEN = { ok: false, status: 403, code: 'comment_forbidden' } as const;

const identity = (subject: string, tenantId = 'tenant-a'): ArtifactHostIdentity => ({
  subject,
  tenantId,
  clientId: 'sentropic-session',
  credentialId: 'session-a',
});

describe('artifactAuthority commentable right', () => {
  it.each([
    { role: 'admin', approved: true, cred: { readable: true, writable: true }, expected: { readable: true, commentable: true, writable: true } },
    { role: 'editor', approved: true, cred: { readable: true, writable: true }, expected: { readable: true, commentable: true, writable: true } },
    { role: 'commenter', approved: true, cred: { readable: true, writable: true }, expected: { readable: true, commentable: true, writable: false } },
    { role: 'viewer', approved: true, cred: { readable: true, writable: true }, expected: { readable: true, commentable: false, writable: false } },
    { role: 'commenter', approved: true, cred: { readable: true, writable: false }, expected: { readable: true, commentable: false, writable: false } },
    { role: 'editor', approved: false, cred: { readable: true, writable: true }, expected: { readable: false, commentable: false, writable: false } },
    { role: 'owner', approved: true, cred: { readable: true, writable: true }, expected: { readable: false, commentable: false, writable: false } },
  ])('should compute authority for role=$role approved=$approved', ({ role, approved, cred, expected }) => {
    expect(artifactAuthority({ role, approved }, cred)).toEqual(expected);
  });

  it('should deny all rights when membership row is absent', () => {
    expect(artifactAuthority(undefined, { readable: true, writable: true })).toEqual({
      readable: false,
      commentable: false,
      writable: false,
    });
  });
});

describe('createArtifactCommentAuthz', () => {
  function fixture(sharingPolicy?: ArtifactCommentAuthzPorts['sharingPolicy']) {
    const scopes = new Map<string, string>([['tenant-a:ws-a', 'scope-a'], ['tenant-a:ws-b', 'scope-b']]);
    const memberships = new Map<string, { role: string; approved: boolean }>([
      ['tenant-a:alice:ws-a', { role: 'editor', approved: true }], ['tenant-a:bob:ws-a', { role: 'editor', approved: true }],
      ['tenant-a:carol:ws-a', { role: 'commenter', approved: true }], ['tenant-a:dave:ws-a', { role: 'viewer', approved: true }],
      ['tenant-a:erin:ws-a', { role: 'admin', approved: true }], ['tenant-a:alice:ws-b', { role: 'editor', approved: true }],
    ]);
    const acls = new Map<string, ArtifactAcl>([
      [ART_PRIVATE, { ownerId: 'alice', storageScopeId: 'scope-a', isPublic: false, withdrawn: false, accessMode: 'restricted', grants: [] }],
      [ART_SHARED, { ownerId: 'alice', storageScopeId: 'scope-a', isPublic: false, withdrawn: false, accessMode: 'platform', grants: [] }],
      [ART_GRANT, { ownerId: 'alice', storageScopeId: 'scope-a', isPublic: false, withdrawn: false, accessMode: 'restricted', grants: [{ principalId: 'carol', grant: 'read' }] }],
      [ART_OTHER_WS, { ownerId: 'alice', storageScopeId: 'scope-b', isPublic: false, withdrawn: false, accessMode: 'platform', grants: [] }],
      [ART_DELETED, { ownerId: 'alice', storageScopeId: 'scope-a', isPublic: false, withdrawn: false, accessMode: 'platform', grants: [] }],
      [ART_PUBLIC, { ownerId: 'alice', storageScopeId: 'scope-a', isPublic: true, withdrawn: false, accessMode: 'public', grants: [] }],
    ]);
    const states = new Map<string, ArtifactState>([[ART_DELETED, 'deleted']]);
    const credentials = new Map<string, { readable: boolean; writable: boolean }>();
    const calls: string[] = [];

    const authz = createArtifactCommentAuthz({
      resolveAuthority: async (id, workspaceId) => (calls.push('resolveAuthority'),
        artifactAuthority(memberships.get(`${id.tenantId}:${id.subject}:${workspaceId}`), credentials.get(id.subject) ?? { readable: true, writable: true })),
      resolveStorageScopeId: async (tenantId, workspaceId) => (calls.push('resolveStorageScopeId'), scopes.get(`${tenantId}:${workspaceId}`)),
      getArtifactAcl: async (artifactId) => (calls.push('getArtifactAcl'), acls.get(artifactId)),
      getArtifactState: async (artifactId) => (calls.push('getArtifactState'), states.get(artifactId) ?? 'active'),
      sharingPolicy,
    });
    return { authz, memberships, states, credentials, calls };
  }

  it('should allow owner, editor, commenter, and admin and resolve authority before scope', async () => {
    const { authz, calls } = fixture();
    expect(await authz({ identity: identity('alice'), workspaceId: 'ws-a', artifactId: ART_PRIVATE })).toMatchObject({
      ok: true, artifactId: ART_PRIVATE, workspaceId: 'ws-a', storageScopeId: 'scope-a',
      authority: { readable: true, commentable: true, writable: true },
    });
    expect(calls.slice(0, 2)).toEqual(['resolveAuthority', 'resolveStorageScopeId']);
    expect(await authz({ identity: identity('bob'), workspaceId: 'ws-a', artifactId: ART_SHARED })).toMatchObject({ ok: true });
    expect(await authz({ identity: identity('carol'), workspaceId: 'ws-a', artifactId: ART_GRANT })).toMatchObject({
      ok: true, authority: { readable: true, commentable: true, writable: false },
    });
    expect(await authz({ identity: identity('erin'), workspaceId: 'ws-a', artifactId: ART_SHARED })).toMatchObject({ ok: true });
  });

  it('should refuse viewer and downgraded owner with 403 on comment while allowing read', async () => {
    const { authz, memberships } = fixture();
    expect(await authz({ identity: identity('dave'), workspaceId: 'ws-a', artifactId: ART_SHARED })).toEqual(FORBIDDEN);
    expect(await authz({ identity: identity('dave'), workspaceId: 'ws-a', artifactId: ART_SHARED, action: 'read' })).toMatchObject({ ok: true, authority: { readable: true, commentable: false, writable: false } });
    memberships.set('tenant-a:alice:ws-a', { role: 'viewer', approved: true });
    expect(await authz({ identity: identity('alice'), workspaceId: 'ws-a', artifactId: ART_PRIVATE })).toEqual(FORBIDDEN);
    expect(await authz({ identity: identity('alice'), workspaceId: 'ws-a', artifactId: ART_PRIVATE, action: 'read' })).toMatchObject({ ok: true, authority: { readable: true, commentable: false, writable: false } });
  });

  it('should refuse read-only credential with 403 on a visible artifact', async () => {
    const { authz, credentials } = fixture();
    credentials.set('carol', { readable: true, writable: false });
    expect(await authz({ identity: identity('carol'), workspaceId: 'ws-a', artifactId: ART_SHARED })).toEqual(FORBIDDEN);
  });

  it('should return 404 without querying storage for non-UUID artifactId or malformed identity', async () => {
    const { authz, calls } = fixture();
    for (const req of [
      { identity: identity('alice'), workspaceId: 'ws-a', artifactId: 'art-missing' },
      { identity: identity('alice'), workspaceId: 'ws-a', artifactId: '11111111-1111-4111-8111-11111111111A' },
      { identity: identity('alice|forged'), workspaceId: 'ws-a', artifactId: ART_PRIVATE },
      { identity: null as unknown as ArtifactHostIdentity, workspaceId: 'ws-a', artifactId: ART_PRIVATE },
    ]) expect(await authz(req)).toEqual(NOT_FOUND);
    expect(calls).toEqual([]);
  });

  it('should return 404 for pending membership, revoked membership, and revoked credential including owner', async () => {
    const { authz, memberships, credentials, calls } = fixture();
    const check404 = async (who: string, artifactId: string) => {
      for (const action of ['comment', 'read'] as const) {
        expect(await authz({ identity: identity(who), workspaceId: 'ws-a', artifactId, action })).toEqual(NOT_FOUND);
      }
    };
    memberships.set('tenant-a:carol:ws-a', { role: 'commenter', approved: false });
    memberships.set('tenant-a:bob:ws-a', { role: 'editor', approved: false });
    memberships.set('tenant-a:alice:ws-a', { role: 'editor', approved: false });
    await check404('carol', ART_GRANT); await check404('bob', ART_SHARED); await check404('alice', ART_PRIVATE);
    expect(calls.includes('resolveStorageScopeId')).toBe(false);
    memberships.delete('tenant-a:carol:ws-a'); memberships.delete('tenant-a:alice:ws-a');
    await check404('carol', ART_GRANT); await check404('alice', ART_PRIVATE);
    memberships.set('tenant-a:alice:ws-a', { role: 'editor', approved: true });
    credentials.set('alice', { readable: false, writable: false });
    await check404('alice', ART_PRIVATE);
  });

  it('should return 404 for unknown, invisible, deleted, withdrawn, cross-workspace, and cross-tenant artifacts', async () => {
    const { authz, states } = fixture();
    for (const req of [
      { identity: identity('alice'), workspaceId: 'ws-a', artifactId: ART_MISSING },
      { identity: identity('bob'), workspaceId: 'ws-a', artifactId: ART_PRIVATE },
      { identity: identity('dave'), workspaceId: 'ws-a', artifactId: ART_PRIVATE },
      { identity: identity('alice'), workspaceId: 'ws-a', artifactId: ART_DELETED },
      { identity: identity('alice'), workspaceId: 'ws-a', artifactId: ART_OTHER_WS },
      { identity: identity('bob'), workspaceId: 'ws-b', artifactId: ART_OTHER_WS },
      { identity: identity('alice', 'tenant-b'), workspaceId: 'ws-a', artifactId: ART_PRIVATE },
    ]) expect(await authz(req)).toEqual(NOT_FOUND);
    states.set(ART_SHARED, 'withdrawn');
    expect(await authz({ identity: identity('alice'), workspaceId: 'ws-a', artifactId: ART_SHARED })).toMatchObject({ ok: true });
    expect(await authz({ identity: identity('bob'), workspaceId: 'ws-a', artifactId: ART_SHARED })).toEqual(NOT_FOUND);
    expect(await authz({ identity: identity('erin'), workspaceId: 'ws-a', artifactId: ART_SHARED })).toEqual(NOT_FOUND);
  });

  it('should fail closed on unknown action and missing, throwing, or malformed sharingPolicy', async () => {
    for (const badAction of ['delete', 'write', '', null] as unknown as Array<'read' | 'comment'>) {
      const { authz, calls } = fixture();
      expect(await authz({ identity: identity('dave'), workspaceId: 'ws-a', artifactId: ART_SHARED, action: badAction })).toEqual(FORBIDDEN);
      expect(calls).toEqual([]);
    }
    const closed: Array<ArtifactCommentAuthzPorts['sharingPolicy']> = [
      undefined, () => { throw new Error('policy unavailable'); },
      () => undefined as unknown as SharingPolicyContext,
      () => ({ allowPublicSharing: 'true' } as unknown as SharingPolicyContext),
    ];
    for (const policy of closed) {
      expect(await fixture(policy).authz({ identity: identity('bob'), workspaceId: 'ws-a', artifactId: ART_PUBLIC })).toEqual(NOT_FOUND);
    }
    expect(await fixture(async () => ({ allowPublicSharing: true })).authz({ identity: identity('bob'), workspaceId: 'ws-a', artifactId: ART_PUBLIC })).toMatchObject({ ok: true });
  });
});
