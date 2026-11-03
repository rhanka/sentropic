/**
 * G1 — three-mode sharing access model (converged-r2 §2.1/§2.2 + owner answers Q1–Q3).
 *
 * Matrix: modes (restricted/platform/public) × actors (anonymous, unapproved,
 * invited read, invited collab/source, approved third party, owner, admin) ×
 * platform policy on/off. Owner Q1: the collab (source) right is nominative
 * only — one named colleague, never platform-wide, never public. Owner Q2:
 * a paused (suspended) share resumes automatically once the account is
 * approved again, and reports as paused meanwhile. Owner Q3: the ACL is per
 * artifact, so a share covers all retained versions (asserted at the model
 * level: no version-scoped state exists on the ACL).
 */
import { describe, expect, it } from 'vitest';
import {
  accessModeOf,
  applyModeTransition,
  audienceOf,
  canManageAccess,
  evaluateAccess,
  evaluateGrant,
  grantAccess,
  PLATFORM_PRINCIPAL,
  PUBLIC_PRINCIPAL,
  RESERVED_PRINCIPAL_PREFIX,
  revokeAccess,
  type ArtifactAcl,
} from '../src/server/access.js';

const OWNER = 'owner-1';
const READER = 'reader-1';
const COLLAB = 'collab-1';
const STRANGER = 'stranger-1';
const ADMIN = 'admin-1';

function acl(overrides: Partial<ArtifactAcl> = {}): ArtifactAcl {
  return { ownerId: OWNER, isPublic: false, withdrawn: false, grants: [], ...overrides };
}

const APPROVED = new Set([OWNER, READER, COLLAB, STRANGER, ADMIN]);
const approved = (id: string): boolean => APPROVED.has(id);
const suspended = new Set([READER]);
const approvedUnlessSuspended = (id: string): boolean => APPROVED.has(id) && !suspended.has(id);

const POLICY_ON = { allowPublicSharing: true };
const POLICY_OFF = { allowPublicSharing: false };

describe('artifact access — three modes', () => {
  it('keeps restricted mode owner + nominative grants only', () => {
    const a = acl({ grants: [{ principalId: READER, grant: 'read' }, { principalId: COLLAB, grant: 'source' }] });
    expect(accessModeOf(a)).toBe('restricted');
    expect(evaluateAccess(a, OWNER, 'read', approved)).toBe(true);
    expect(evaluateAccess(a, OWNER, 'source', approved)).toBe(true);
    expect(evaluateAccess(a, READER, 'read', approved)).toBe(true);
    expect(evaluateAccess(a, READER, 'source', approved)).toBe(false);
    expect(evaluateAccess(a, COLLAB, 'read', approved)).toBe(true);
    expect(evaluateAccess(a, COLLAB, 'source', approved)).toBe(true);
    expect(evaluateAccess(a, STRANGER, 'read', approved)).toBe(false);
    expect(evaluateAccess(a, '', 'read', approved)).toBe(false);
  });

  it('opens platform mode to approved accounts in read only, never anonymous, never source', () => {
    const a = acl({ accessMode: 'platform', isPublic: true, grants: [{ principalId: READER, grant: 'read' }] });
    expect(accessModeOf(a)).toBe('platform');
    expect(evaluateAccess(a, READER, 'read', approved)).toBe(true);
    expect(evaluateAccess(a, STRANGER, 'read', approved)).toBe(true);
    expect(evaluateAccess(a, STRANGER, 'source', approved)).toBe(false);
    expect(evaluateAccess(a, '', 'read', approved)).toBe(false);
    // unapproved account is refused even in platform mode
    expect(evaluateAccess(a, 'pending-1', 'read', approved)).toBe(false);
    // an invited user keeps access orthogonally to the wide mode
    expect(evaluateAccess(a, READER, 'read', approved)).toBe(true);
  });

  it('opens public mode to anonymous read only while the policy allows it, never source', () => {
    const a = acl({ accessMode: 'public', isPublic: true });
    expect(evaluateAccess(a, '', 'read', approved, POLICY_ON)).toBe(true);
    expect(evaluateAccess(a, STRANGER, 'read', approved, POLICY_ON)).toBe(true);
    expect(evaluateAccess(a, '', 'source', approved, POLICY_ON)).toBe(false);
    expect(evaluateAccess(a, STRANGER, 'source', approved, POLICY_ON)).toBe(false);
    // policy off (default closed): public mode grants nothing
    expect(evaluateAccess(a, '', 'read', approved, POLICY_OFF)).toBe(false);
    expect(evaluateAccess(a, STRANGER, 'read', approved, POLICY_OFF)).toBe(false);
    expect(evaluateAccess(a, STRANGER, 'read', approved)).toBe(false);
    // owner still reads
    expect(evaluateAccess(a, OWNER, 'read', approved, POLICY_OFF)).toBe(true);
  });

  it('derives the legacy isPublic flag as platform, never public', () => {
    expect(accessModeOf(acl({ isPublic: true }))).toBe('platform');
    expect(accessModeOf(acl({ isPublic: false }))).toBe('restricted');
    expect(accessModeOf(acl({ isPublic: true, accessMode: 'restricted' }))).toBe('restricted');
  });

  it('requires fresh approval at every read: suspension pauses, reactivation resumes (Q2)', () => {
    const a = acl({ grants: [{ principalId: READER, grant: 'read' }] });
    expect(evaluateAccess(a, READER, 'read', approvedUnlessSuspended)).toBe(false);
    expect(evaluateGrant(a, READER, approvedUnlessSuspended)).toEqual({ effective: false, blockedBy: 'account_inactive' });
    // automatic resume once approved again — no re-grant needed
    suspended.delete(READER);
    expect(evaluateAccess(a, READER, 'read', approvedUnlessSuspended)).toBe(true);
    expect(evaluateGrant(a, READER, approvedUnlessSuspended)).toEqual({ effective: true });
    // the dormant grant is kept, never deleted
    expect(a.grants).toEqual([{ principalId: READER, grant: 'read' }]);
  });

  it('suspends reader grants while withdrawn, owner keeps access', () => {
    const a = acl({ withdrawn: true, grants: [{ principalId: READER, grant: 'read' }] });
    expect(evaluateAccess(a, READER, 'read', approved)).toBe(false);
    expect(evaluateAccess(a, OWNER, 'read', approved)).toBe(true);
    expect(evaluateAccess(a, OWNER, 'source', approved)).toBe(true);
    expect(a.grants.length).toBe(1);
  });

  it('refuses grant management by non-owners and duplicate grants', () => {
    expect(() => grantAccess(acl(), READER, { principalId: STRANGER, grant: 'read' })).toThrow(/owner/);
    expect(() => revokeAccess(acl(), READER, STRANGER)).toThrow(/owner/);
    const a = grantAccess(acl(), OWNER, { principalId: READER, grant: 'read' });
    expect(() => grantAccess(a, OWNER, { principalId: READER, grant: 'source' })).toThrow(/duplicate/);
  });

  it('enforces owner Q1: collab (source) is one named colleague, restricted mode only, never a sentinel', () => {
    const a = grantAccess(acl(), OWNER, { principalId: COLLAB, grant: 'source' });
    expect(a.grants).toEqual([{ principalId: COLLAB, grant: 'source' }]);
    // a second collab grant is refused — one named colleague at a time
    expect(() => grantAccess(a, OWNER, { principalId: READER, grant: 'source' })).toThrow(/source/);
    // sentinel-shaped principals are reserved, never nominative
    expect(() => grantAccess(acl(), OWNER, { principalId: PLATFORM_PRINCIPAL, grant: 'read' })).toThrow(/reserved/);
    expect(() => grantAccess(acl(), OWNER, { principalId: `${RESERVED_PRINCIPAL_PREFIX}x`, grant: 'read' })).toThrow(/reserved/);
    // source grant refused outside restricted mode (schema mirrors this)
    const wide = acl({ accessMode: 'platform', isPublic: true });
    expect(() => grantAccess(wide, OWNER, { principalId: READER, grant: 'source' })).toThrow(/restricted/);
    const pub = acl({ accessMode: 'public', isPublic: true });
    expect(() => grantAccess(pub, OWNER, { principalId: READER, grant: 'source' })).toThrow(/restricted/);
  });

  it('covers all retained versions: the ACL carries no version-scoped state (Q3)', () => {
    const a = grantAccess(acl(), OWNER, { principalId: READER, grant: 'read' });
    expect(Object.keys(a).filter((k) => /release|version/i.test(k))).toEqual([]);
    expect(evaluateAccess(a, READER, 'read', approved)).toBe(true);
  });
});

describe('mode transitions (normative table §2.1)', () => {
  it('applies grant/revoke of the sentinels exactly', () => {
    expect(applyModeTransition('restricted', 'grant', PLATFORM_PRINCIPAL)).toEqual({ mode: 'platform', changed: true });
    expect(applyModeTransition('public', 'grant', PLATFORM_PRINCIPAL)).toEqual({ mode: 'platform', changed: true });
    expect(applyModeTransition('platform', 'grant', PLATFORM_PRINCIPAL)).toEqual({ mode: 'platform', changed: false });
    expect(applyModeTransition('restricted', 'grant', PUBLIC_PRINCIPAL)).toEqual({ mode: 'public', changed: true });
    expect(applyModeTransition('platform', 'grant', PUBLIC_PRINCIPAL)).toEqual({ mode: 'public', changed: true });
    expect(applyModeTransition('public', 'grant', PUBLIC_PRINCIPAL)).toEqual({ mode: 'public', changed: false });
    expect(applyModeTransition('platform', 'revoke', PLATFORM_PRINCIPAL)).toEqual({ mode: 'restricted', changed: true });
    expect(applyModeTransition('public', 'revoke', PLATFORM_PRINCIPAL)).toEqual({ mode: 'public', changed: false });
    expect(applyModeTransition('restricted', 'revoke', PLATFORM_PRINCIPAL)).toEqual({ mode: 'restricted', changed: false });
    expect(applyModeTransition('public', 'revoke', PUBLIC_PRINCIPAL)).toEqual({ mode: 'restricted', changed: true });
    expect(applyModeTransition('platform', 'revoke', PUBLIC_PRINCIPAL)).toEqual({ mode: 'platform', changed: false });
    // nominative principals never change the wide mode
    expect(applyModeTransition('public', 'grant', READER)).toEqual({ mode: 'public', changed: false });
  });

  it('classifies audiences', () => {
    expect(audienceOf(PLATFORM_PRINCIPAL)).toBe('platform');
    expect(audienceOf(PUBLIC_PRINCIPAL)).toBe('public');
    expect(audienceOf(READER)).toBe('user');
  });
});

describe('canManageAccess — owner / admin-reduce-only (§2.1)', () => {
  const base = acl({ grants: [{ principalId: READER, grant: 'read' }] });
  it('lets the owner grant and revoke every audience', () => {
    for (const principalId of [READER, PLATFORM_PRINCIPAL, PUBLIC_PRINCIPAL]) {
      for (const action of ['grant', 'revoke'] as const) {
        expect(canManageAccess({ acl: base, actorId: OWNER, action, principalId })).toBe(true);
      }
    }
  });

  it('lets the admin list, revoke any grant and degrade modes, but never widen or grant nominative', () => {
    // revoke nominative grant: allowed
    expect(canManageAccess({ acl: base, actorId: ADMIN, action: 'revoke', principalId: READER, actorIsAdmin: true })).toBe(true);
    // revoke platform/public: allowed (no-op unless it is the current mode)
    expect(canManageAccess({ acl: base, actorId: ADMIN, action: 'revoke', principalId: PLATFORM_PRINCIPAL, actorIsAdmin: true })).toBe(true);
    expect(canManageAccess({ acl: acl({ accessMode: 'public', isPublic: true }), actorId: ADMIN, action: 'revoke', principalId: PUBLIC_PRINCIPAL, actorIsAdmin: true })).toBe(true);
    // the unique admin grant: degradation public → platform
    expect(canManageAccess({ acl: acl({ accessMode: 'public', isPublic: true }), actorId: ADMIN, action: 'grant', principalId: PLATFORM_PRINCIPAL, actorIsAdmin: true })).toBe(true);
    // admin cannot widen restricted → platform, nor grant public, nor place a nominative grant
    expect(canManageAccess({ acl: base, actorId: ADMIN, action: 'grant', principalId: PLATFORM_PRINCIPAL, actorIsAdmin: true })).toBe(false);
    expect(canManageAccess({ acl: base, actorId: ADMIN, action: 'grant', principalId: PUBLIC_PRINCIPAL, actorIsAdmin: true })).toBe(false);
    expect(canManageAccess({ acl: base, actorId: ADMIN, action: 'grant', principalId: READER, actorIsAdmin: true })).toBe(false);
    // admin flag is server-resolved: without it, no management right at all
    expect(canManageAccess({ acl: base, actorId: ADMIN, action: 'revoke', principalId: READER })).toBe(false);
  });

  it('refuses any management by a plain reader or stranger', () => {
    for (const principalId of [READER, PLATFORM_PRINCIPAL, PUBLIC_PRINCIPAL]) {
      for (const action of ['grant', 'revoke'] as const) {
        expect(canManageAccess({ acl: base, actorId: READER, action, principalId })).toBe(false);
        // the admin flag is server-resolved per actor: a stranger without it has no right
        expect(canManageAccess({ acl: base, actorId: STRANGER, action, principalId, actorIsAdmin: false })).toBe(false);
      }
    }
    // unknown sentinel-shaped principal is never manageable
    expect(canManageAccess({ acl: base, actorId: OWNER, action: 'grant', principalId: `${RESERVED_PRINCIPAL_PREFIX}other` })).toBe(false);
  });
});
