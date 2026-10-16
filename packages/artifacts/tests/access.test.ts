/**
 * L-5c — access control: owner, grants, approved-public (spec-v8 §9 5c).
 *
 * Reads require ownership, an explicit read/source grant, or a public flag
 * combined with an approved account — never anonymity. Source export needs
 * ownership or an explicit source grant (read alone is insufficient).
 * Mutations of the access list are owner-only. Withdrawn artifacts suspend
 * reader grants (kept for audit, inactive) while the owner keeps access.
 */
import { describe, expect, it } from 'vitest';
import {
  evaluateAccess,
  grantAccess,
  revokeAccess,
  type ArtifactAcl,
} from '../src/server/access.js';

const OWNER = 'owner-1';
const READER = 'reader-1';
const STRANGER = 'stranger-1';

function privateAcl(): ArtifactAcl {
  return { ownerId: OWNER, isPublic: false, grants: [], withdrawn: false };
}

const APPROVED = new Set([OWNER, READER]);

describe('artifact access', () => {
  it('lets the owner read, export source and manage grants', () => {
    const acl = grantAccess(privateAcl(), OWNER, { principalId: READER, grant: 'read' });
    expect(evaluateAccess(acl, OWNER, 'read')).toBe(true);
    expect(evaluateAccess(acl, OWNER, 'source')).toBe(true);
    const revoked = revokeAccess(acl, OWNER, READER);
    expect(revoked.grants).toEqual([]);
  });

  it('grants read without source, source implies read', () => {
    let acl = grantAccess(privateAcl(), OWNER, { principalId: READER, grant: 'read' });
    expect(evaluateAccess(acl, READER, 'read')).toBe(true);
    expect(evaluateAccess(acl, READER, 'source')).toBe(false);
    acl = grantAccess(privateAcl(), OWNER, { principalId: READER, grant: 'source' });
    expect(evaluateAccess(acl, READER, 'read')).toBe(true);
    expect(evaluateAccess(acl, READER, 'source')).toBe(true);
  });

  it('refuses strangers and anonymous readers', () => {
    const acl = grantAccess(privateAcl(), OWNER, { principalId: READER, grant: 'read' });
    expect(evaluateAccess(acl, STRANGER, 'read')).toBe(false);
    expect(evaluateAccess(acl, STRANGER, 'source')).toBe(false);
    expect(evaluateAccess(acl, '', 'read')).toBe(false);
  });

  it('opens public reads to approved accounts only', () => {
    const acl: ArtifactAcl = { ...privateAcl(), isPublic: true };
    expect(evaluateAccess(acl, READER, 'read', APPROVED.has.bind(APPROVED))).toBe(true);
    expect(evaluateAccess(acl, STRANGER, 'read', APPROVED.has.bind(APPROVED))).toBe(false);
    expect(evaluateAccess(acl, '', 'read', APPROVED.has.bind(APPROVED))).toBe(false);
    expect(evaluateAccess(acl, READER, 'source', APPROVED.has.bind(APPROVED))).toBe(false);
  });

  it('refuses grant management by non-owners and duplicate grants', () => {
    expect(() => grantAccess(privateAcl(), READER, { principalId: STRANGER, grant: 'read' })).toThrow(
      /owner/,
    );
    expect(() => revokeAccess(privateAcl(), READER, STRANGER)).toThrow(/owner/);
    const acl = grantAccess(privateAcl(), OWNER, { principalId: READER, grant: 'read' });
    expect(() =>
      grantAccess(acl, OWNER, { principalId: READER, grant: 'source' }),
    ).toThrow(/duplicate/);
  });

  it('suspends reader grants while withdrawn, owner keeps access', () => {
    let acl = grantAccess(privateAcl(), OWNER, { principalId: READER, grant: 'read' });
    acl = { ...acl, withdrawn: true };
    expect(evaluateAccess(acl, READER, 'read')).toBe(false);
    expect(evaluateAccess(acl, OWNER, 'read')).toBe(true);
    expect(acl.grants.length).toBe(1);
  });
});
