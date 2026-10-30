import { createHash, generateKeyPairSync, verify } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { authorizeRemoteAction, signRemoteAttestation } from '../../../src/services/auth/remote-authority';
import { remoteSignedBytes } from '../../../src/services/auth/remote-contract';

const target = {
  appMeshId: 'a', sourceMeshId: 'b', nativeAudience: 'native-b', registrationId: 'reg',
  tenantId: 'tenant', workspaceId: 'workspace', bindingId: 'binding', sourceId: 'source',
  sourceSessionId: 'source-session', nativeSessionId: 'native-session', sourceGeneration: 1,
  bootGeneration: 1, custodyEpoch: 1, controllerEpoch: 1, connectionId: 'connection', connectionGeneration: 1,
};
const actor = { issuer: 'idp', sub: 'owner', sid: 'login', sessionVersion: 1 };
const authority = {
  target, actor, ownerIssuer: 'idp', ownerSub: 'owner', membershipActive: true,
  membershipTenantId: 'tenant', membershipWorkspaceId: 'workspace', role: 'member', membershipRevision: 1,
  consent: { bindingId: 'binding', consentPolicyId: 'policy', consentRevision: 1, ownerIssuer: 'idp',
    ownerSub: 'owner', actionScopes: ['remote.input', 'remote.permission.respond'],
    scopeDigest: '9e7e0335aa6ae45dde9dde594d8ee686d92dd545796ac9254c1849eea480a523' },
  expectedConsentRevision: 1, enabled: true, remoteControlEpoch: 1, expectedRemoteControlEpoch: 1,
  controlPolicyRevision: 1, operation: 'input', permissionMode: 'interactive', autoApprovePolicyDigest: null,
};

// R10: owner/membership/role; R11: consent/scope/revision/epoch. These are A-side checks.
describe('RC1 owner and consent predicate', () => {
  it.each(['input', 'permission-response'])('should authorize the owner for %s under current consent', (operation) => {
    expect(() => authorizeRemoteAction({ ...authority, operation })).not.toThrow();
  });
  it.each(['member', 'workspace-admin', 'read-share'])('should refuse another %s owner', (role) => {
    expect(() => authorizeRemoteAction({ ...authority, role, actor: { ...actor, sub: 'other' } }))
      .toThrowError(expect.objectContaining({ code: 'authority_refused' }));
  });
  it.each([
    [{ membershipActive: false }, 'workspace_membership_required'],
    [{ membershipWorkspaceId: 'other' }, 'workspace_membership_required'],
    [{ membershipTenantId: 'other' }, 'workspace_membership_required'],
    [{ role: 'viewer' }, 'role_refused'], [{ enabled: false }, 'control_disabled'],
    [{ expectedRemoteControlEpoch: 0 }, 'control_disabled'],
    [{ expectedConsentRevision: 0 }, 'control_disabled'],
    [{ consent: null }, 'control_disabled'],
    [{ consent: { ...authority.consent, bindingId: 'other' } }, 'control_disabled'],
    [{ consent: { ...authority.consent, ownerIssuer: 'other' } }, 'control_disabled'],
    [{ consent: { ...authority.consent, ownerSub: 'other' } }, 'control_disabled'],
    [{ consent: { ...authority.consent, actionScopes: [], scopeDigest:
      '4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945' } }, 'action_scope_refused'],
    [{ permissionMode: 'auto-approve' }, 'input_mode_refused'],
    [{ permissionMode: 'bypass' }, 'input_mode_refused'],
    [{ permissionMode: 'unknown' }, 'input_mode_refused'],
    [{ autoApprovePolicyDigest: 'a'.repeat(64) }, 'input_mode_refused'],
  ])('should refuse invalid current authority %j', (change, code) => {
    expect(() => authorizeRemoteAction({ ...authority, ...change }))
      .toThrowError(expect.objectContaining({ code }));
  });
  it('should keep permission response independent of input mode', () => {
    expect(() => authorizeRemoteAction({ ...authority, operation: 'permission-response',
      permissionMode: 'auto-approve' })).not.toThrow();
  });
  it.each([
    ['input', ['remote.permission.respond']], ['permission-response', ['remote.input']],
  ])('should refuse %s when only the other operation is consented', (operation, actionScopes) => {
    const scopeDigest = createHash('sha256').update(JSON.stringify(actionScopes)).digest('hex');
    expect(() => authorizeRemoteAction({ ...authority, operation,
      consent: { ...authority.consent, actionScopes, scopeDigest } }))
      .toThrowError(expect.objectContaining({ code: 'action_scope_refused' }));
  });
  it('should refuse tampered scope digests and source identities', () => {
    expect(() => authorizeRemoteAction({ ...authority,
      consent: { ...authority.consent, scopeDigest: 'a'.repeat(64) } }))
      .toThrowError(expect.objectContaining({ code: 'control_disabled' }));
    expect(() => authorizeRemoteAction({ ...authority, actor: { ...actor, issuer: 'source' } }))
      .toThrowError(expect.objectContaining({ code: 'authority_refused' }));
  });
  // R04: app attestation bindings; matching native equality/refusal vectors remain pending.
  it('should sign the frozen attestation with a distinct app key and no cyclic fields', () => {
    const key = generateKeyPairSync('ed25519');
    const result = signRemoteAttestation({ authority, issuer: 'app', kid: 'app-1', key: key.privateKey,
      actionId: 'AAAAAAAAAAAAAAAAAAAAAA', cliSessionProofDigest: 'a'.repeat(64),
      payloadDigest: 'b'.repeat(64), nonceId: 'nonce', nonce: 'A'.repeat(43),
      sessionEvidenceDigest: 'c'.repeat(64), issuedAt: 1_800_000_000_000, expiresAt: 1_800_000_030_000 });
    expect(result.body).toMatchObject({ kind: 'session-attestation', actor, target,
      actionScopes: authority.consent.actionScopes, consentRevision: 1 });
    expect(result.body).not.toHaveProperty('envelopeDigest');
    expect(verify(null, remoteSignedBytes(result.body), key.publicKey,
      Buffer.from(result.signature.value, 'base64url'))).toBe(true);
    expect(verify(null, remoteSignedBytes(result.body), generateKeyPairSync('ed25519').publicKey,
      Buffer.from(result.signature.value, 'base64url'))).toBe(false);
  });
});
