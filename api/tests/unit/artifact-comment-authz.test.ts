import { describe, expect, it } from 'vitest';
import type { ArtifactAcl } from '@sentropic/artifacts/server/access';
import type { ArtifactState } from '@sentropic/artifacts/server/lifecycle';
import { artifactAuthority, type ArtifactHostIdentity } from '../../src/services/artifacts/authorization';
import { createArtifactCommentAuthz } from '../../src/services/comments/artifact-comment-authz';

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
  function fixture() {
    const scopes = new Map<string, string>([['tenant-a:ws-a', 'scope-a'], ['tenant-a:ws-b', 'scope-b']]);
    const memberships = new Map<string, { role: string; approved: boolean }>([
      ['alice:ws-a', { role: 'editor', approved: true }],
      ['bob:ws-a', { role: 'editor', approved: true }],
      ['carol:ws-a', { role: 'commenter', approved: true }],
      ['dave:ws-a', { role: 'viewer', approved: true }],
      ['erin:ws-a', { role: 'admin', approved: true }],
      ['alice:ws-b', { role: 'editor', approved: true }],
    ]);
    const acls = new Map<string, ArtifactAcl>([
      ['art-private', { ownerId: 'alice', storageScopeId: 'scope-a', isPublic: false, withdrawn: false, accessMode: 'restricted', grants: [] }],
      ['art-shared', { ownerId: 'alice', storageScopeId: 'scope-a', isPublic: false, withdrawn: false, accessMode: 'platform', grants: [] }],
      ['art-grant', { ownerId: 'alice', storageScopeId: 'scope-a', isPublic: false, withdrawn: false, accessMode: 'restricted', grants: [{ principalId: 'carol', grant: 'read' }] }],
      ['art-other-ws', { ownerId: 'alice', storageScopeId: 'scope-b', isPublic: false, withdrawn: false, accessMode: 'platform', grants: [] }],
      ['art-deleted', { ownerId: 'alice', storageScopeId: 'scope-a', isPublic: false, withdrawn: false, accessMode: 'platform', grants: [] }],
    ]);
    const states = new Map<string, ArtifactState>([['art-deleted', 'deleted']]);
    const credentials = new Map<string, { readable: boolean; writable: boolean }>();

    const authz = createArtifactCommentAuthz({
      resolveStorageScopeId: async (tenantId, workspaceId) => scopes.get(`${tenantId}:${workspaceId}`),
      resolveAuthority: async (id, workspaceId) =>
        artifactAuthority(memberships.get(`${id.subject}:${workspaceId}`), credentials.get(id.subject) ?? { readable: true, writable: true }),
      getArtifactAcl: async (artifactId) => acls.get(artifactId),
      getArtifactState: async (artifactId) => states.get(artifactId) ?? 'active',
    });
    return { authz, credentials };
  }

  it('should allow owner, editor, commenter, and admin on visible artifacts', async () => {
    const { authz } = fixture();
    expect(await authz({ identity: identity('alice'), workspaceId: 'ws-a', artifactId: 'art-private' })).toMatchObject({
      ok: true, artifactId: 'art-private', workspaceId: 'ws-a', storageScopeId: 'scope-a',
      authority: { readable: true, commentable: true, writable: true },
    });
    expect(await authz({ identity: identity('bob'), workspaceId: 'ws-a', artifactId: 'art-shared' })).toMatchObject({ ok: true });
    expect(await authz({ identity: identity('carol'), workspaceId: 'ws-a', artifactId: 'art-grant' })).toMatchObject({
      ok: true, authority: { readable: true, commentable: true, writable: false },
    });
    expect(await authz({ identity: identity('erin'), workspaceId: 'ws-a', artifactId: 'art-shared' })).toMatchObject({ ok: true });
  });

  it('should refuse viewer with 403 on a visible artifact while allowing read', async () => {
    const { authz } = fixture();
    expect(await authz({ identity: identity('dave'), workspaceId: 'ws-a', artifactId: 'art-shared' }))
      .toEqual({ ok: false, status: 403, code: 'comment_forbidden' });
    expect(await authz({ identity: identity('dave'), workspaceId: 'ws-a', artifactId: 'art-shared', action: 'read' }))
      .toMatchObject({ ok: true, authority: { readable: true, commentable: false, writable: false } });
  });

  it('should refuse read-only credential with 403 on a visible artifact', async () => {
    const { authz, credentials } = fixture();
    credentials.set('carol', { readable: true, writable: false });
    expect(await authz({ identity: identity('carol'), workspaceId: 'ws-a', artifactId: 'art-shared' }))
      .toEqual({ ok: false, status: 403, code: 'comment_forbidden' });
  });

  it('should return 404 for unknown, invisible, deleted, or cross-workspace artifacts', async () => {
    const { authz } = fixture();
    for (const req of [
      { identity: identity('alice'), workspaceId: 'ws-a', artifactId: 'art-missing' },
      { identity: identity('bob'), workspaceId: 'ws-a', artifactId: 'art-private' },
      { identity: identity('dave'), workspaceId: 'ws-a', artifactId: 'art-private' },
      { identity: identity('alice'), workspaceId: 'ws-a', artifactId: 'art-deleted' },
      { identity: identity('alice'), workspaceId: 'ws-a', artifactId: 'art-other-ws' },
      { identity: identity('bob'), workspaceId: 'ws-b', artifactId: 'art-other-ws' },
    ]) {
      expect(await authz(req)).toEqual({ ok: false, status: 404, code: 'artifact_not_found' });
    }
  });
});
