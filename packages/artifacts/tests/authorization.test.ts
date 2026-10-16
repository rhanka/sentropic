/**
 * L-5a — object-level authorization: owner-only, deny by default.
 *
 * Private artifacts are readable and mutable only by their owning user.
 * A forged owner, an anonymous actor and an empty owner are all refused
 * fail-closed; there is no sharing grant in this lot (sharing arrives in
 * L-5c access.ts). Authorization is a pure check over verified identities —
 * identity verification itself stays with the host.
 */
import { describe, expect, it } from 'vitest';
import { assertArtifactAccess } from '../src/server/authorization.js';

describe('artifact authorization', () => {
  it('allows the owner to read and mutate', () => {
    expect(() =>
      assertArtifactAccess({ actorUserId: 'user-1', artifactOwnerId: 'user-1', action: 'read' }),
    ).not.toThrow();
    expect(() =>
      assertArtifactAccess({ actorUserId: 'user-1', artifactOwnerId: 'user-1', action: 'mutate' }),
    ).not.toThrow();
  });

  it('refuses a forged owner fail-closed', () => {
    expect(() =>
      assertArtifactAccess({ actorUserId: 'user-2', artifactOwnerId: 'user-1', action: 'read' }),
    ).toThrow(/access denied/);
    expect(() =>
      assertArtifactAccess({ actorUserId: 'user-2', artifactOwnerId: 'user-1', action: 'mutate' }),
    ).toThrow(/access denied/);
  });

  it('refuses anonymous actors and empty owners', () => {
    expect(() =>
      assertArtifactAccess({ actorUserId: '', artifactOwnerId: 'user-1', action: 'read' }),
    ).toThrow(/access denied/);
    expect(() =>
      assertArtifactAccess({ actorUserId: 'user-1', artifactOwnerId: '', action: 'read' }),
    ).toThrow(/access denied/);
  });

  it('refuses unknown actions', () => {
    expect(() =>
      assertArtifactAccess({ actorUserId: 'user-1', artifactOwnerId: 'user-1', action: 'share' }),
    ).toThrow(/unknown action/);
  });
});
