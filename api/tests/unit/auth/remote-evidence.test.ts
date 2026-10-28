import { generateKeyPairSync } from 'node:crypto';
import { decodeJwt, jwtVerify, SignJWT } from 'jose';
import { describe, expect, it } from 'vitest';
import { createRemoteEvidenceIssuer, verifyRemoteEvidence } from '../../../src/services/auth/remote-evidence';

const keys = generateKeyPairSync('ed25519');
const now = 1_800_000_000_000;
const request = {
  version: 'remote-action-v1', kind: 'evidence-request', actionId: 'AAAAAAAAAAAAAAAAAAAAAA',
  targetDigest: 'a'.repeat(64), operation: 'input', payloadDigest: 'b'.repeat(64),
  nonceId: 'nonce-1', sid: 'login-1', sessionVersion: 1, sessionCredential: 'credential-1',
};
const login = {
  sub: 'owner', sid: 'login-1', sessionVersion: 1, authTime: now / 1000 - 3600,
  amr: ['hwk', 'user', 'mfa'], expiresAt: now + 86_400_000,
};
function setup() {
  const state = { login: structuredClone(login) as typeof login | null, now };
  const used = new Set<string>();
  const issue = createRemoteEvidenceIssuer({
    issuer: 'idp', kid: 'idp-1', key: keys.privateKey, now: () => state.now,
    session: async (credential) => credential === 'credential-1' ? state.login : null,
    approvedTarget: async (digest, actor) => actor.sub === 'owner' && /^[ac]{64}$/.test(digest)
      ? { audience: 'native-b', tenantId: 'tenant-1', workspaceId: 'workspace-1' } : null,
    reserve: async (sid, actionId) => {
      const key = `${sid}:${actionId}`;
      if (used.has(key)) return false;
      used.add(key);
      return true;
    },
  });
  return { state, issue };
}

describe('RC1 D2 session evidence', () => {
  it('should preserve login lineage for repeated actions and machine switches without MFA', async () => {
    const { issue, state } = setup();
    const first = decodeJwt(await issue(request));
    state.now += 600_000;
    const second = decodeJwt(await issue({ ...request, actionId: 'BBBBBBBBBBBBBBBBBBBBBA',
      targetDigest: 'c'.repeat(64), operation: 'permission-response', nonceId: 'nonce-2' }));
    for (const field of ['iss', 'sub', 'sid', 'sessionVersion', 'auth_time', 'amr']) {
      expect(second[field]).toEqual(first[field]);
    }
    expect(second.jti).not.toBe(first.jti);
    expect(second.iat).toBe(state.now / 1000);
    expect(second.exp! - second.iat!).toBeLessThanOrEqual(60);
  });

  it.each(['logout', 'revoke', 'expiry'])('should refuse %s before signing', async (reason) => {
    const { issue, state } = setup();
    if (reason === 'expiry') state.login!.expiresAt = now;
    else state.login = null;
    await expect(issue(request)).rejects.toMatchObject({ code: 'authentication_required' });
  });

  it.each([
    { sid: 'another-login' }, { sessionVersion: 2 }, { sessionCredential: 'source-token' },
  ])('should refuse mismatched login evidence %j', async (change) => {
    await expect(setup().issue({ ...request, ...change }))
      .rejects.toMatchObject({ code: 'authentication_required' });
  });

  it('should refuse single-factor sessions and unapproved targets', async () => {
    const { issue, state } = setup();
    state.login!.amr = ['pwd'];
    await expect(issue(request)).rejects.toMatchObject({ code: 'authentication_required' });
    state.login!.amr = login.amr;
    await expect(issue({ ...request, targetDigest: 'd'.repeat(64) }))
      .rejects.toMatchObject({ code: 'authority_refused' });
  });

  it('should refuse a repeated action issuance', async () => {
    const { issue } = setup();
    await issue(request);
    await expect(issue(request)).rejects.toMatchObject({ code: 'replay_refused' });
  });

  it('should refuse unknown or regressing issuer clocks', async () => {
    const { issue, state } = setup();
    await issue(request);
    state.now -= 1;
    await expect(issue({ ...request, actionId: 'BBBBBBBBBBBBBBBBBBBBBA' }))
      .rejects.toMatchObject({ code: 'authority_unavailable' });
    state.now = NaN;
    await expect(issue({ ...request, actionId: 'CCCCCCCCCCCCCCCCCCCCCA' }))
      .rejects.toMatchObject({ code: 'authority_unavailable' });
  });

  it('should sign EdDSA with the pinned IdP key and exact action binding', async () => {
    const evidence = await setup().issue(request);
    const { payload, protectedHeader } = await jwtVerify(evidence, keys.publicKey, {
      algorithms: ['EdDSA'], issuer: 'idp', audience: 'native-b', currentDate: new Date(now),
    });
    expect(protectedHeader).toEqual({ alg: 'EdDSA', kid: 'idp-1' });
    expect(payload).toMatchObject({ actionId: request.actionId, targetDigest: request.targetDigest,
      payloadDigest: request.payloadDigest, nonceId: 'nonce-1', operation: 'input' });
    await expect(verifyRemoteEvidence(evidence, { key: keys.publicKey, issuer: 'idp', kid: 'idp-1',
      audience: 'native-b', tenantId: 'tenant-1', workspaceId: 'workspace-1', now, request, login }))
      .resolves.toMatchObject({ sub: 'owner', actionId: request.actionId });
    await expect(verifyRemoteEvidence(evidence, { key: generateKeyPairSync('ed25519').publicKey,
      issuer: 'idp', kid: 'idp-1', audience: 'native-b', tenantId: 'tenant-1', workspaceId: 'workspace-1',
      now, request, login }))
      .rejects.toMatchObject({ code: 'authority_refused' });
  });

  it('should refuse revoked and unknown IdP keys and message-selected trust roots', async () => {
    const evidence = await setup().issue(request);
    const trust = { key: keys.publicKey, issuer: 'idp', kid: 'idp-1', audience: 'native-b',
      tenantId: 'tenant-1', workspaceId: 'workspace-1', now, request, login };
    await expect(verifyRemoteEvidence(evidence, { ...trust, revoked: true }))
      .rejects.toMatchObject({ code: 'authority_refused' });
    for (const header of [{ alg: 'EdDSA', kid: 'unknown' },
      { alg: 'EdDSA', kid: 'idp-1', jku: 'https://attacker.test/keys' }]) {
      const token = await new SignJWT(decodeJwt(evidence)).setProtectedHeader(header).sign(keys.privateKey);
      await expect(verifyRemoteEvidence(token, trust)).rejects.toMatchObject({ code: 'authority_refused' });
    }
  });

  it('should accept an acknowledged rotated key and refuse the old purpose ring', async () => {
    const pair = generateKeyPairSync('ed25519');
    const payload = decodeJwt(await setup().issue(request));
    const token = await new SignJWT(payload).setProtectedHeader({ alg: 'EdDSA', kid: 'idp-2' }).sign(pair.privateKey);
    const trust = { key: pair.publicKey, issuer: 'idp', kid: 'idp-2', audience: 'native-b',
      tenantId: 'tenant-1', workspaceId: 'workspace-1', now, request, login };
    await expect(verifyRemoteEvidence(token, trust)).resolves.toMatchObject({ sub: 'owner' });
    await expect(verifyRemoteEvidence(token, { ...trust, key: keys.publicKey, kid: 'idp-1' }))
      .rejects.toMatchObject({ code: 'authority_refused' });
  });

  it('should refuse captured jti replay through the injected native verifier fake after restart', async () => {
    const evidence = await setup().issue(request);
    const consumed = new Set<string>();
    const nativePort = () => ({ async verifyAndConsume(token: string, intent: typeof request) {
      const proof = await verifyRemoteEvidence(token, { key: keys.publicKey, issuer: 'idp', kid: 'idp-1',
        audience: 'native-b', tenantId: 'tenant-1', workspaceId: 'workspace-1', now, request: intent, login });
      if (consumed.has(proof.jti)) throw Object.assign(new Error('replay_refused'), { code: 'replay_refused' });
      consumed.add(proof.jti);
      return proof.actionId;
    } });
    await expect(nativePort().verifyAndConsume(evidence, request)).resolves.toBe(request.actionId);
    await expect(nativePort().verifyAndConsume(evidence, request)).rejects.toMatchObject({ code: 'replay_refused' });
    const next = { ...request, actionId: 'BBBBBBBBBBBBBBBBBBBBBA' };
    const replay = await new SignJWT({ ...decodeJwt(evidence), actionId: next.actionId })
      .setProtectedHeader({ alg: 'EdDSA', kid: 'idp-1' }).sign(keys.privateKey);
    await expect(nativePort().verifyAndConsume(replay, next)).rejects.toMatchObject({ code: 'replay_refused' });
    expect(consumed.size).toBe(1);
  });

  it.each([
    { iss: 'other-idp' }, { sub: 'other-owner' }, { sid: 'other-login' }, { sessionVersion: 2 },
    { aud: 'other-native' }, { amr: ['pwd'] }, { auth_time: now / 1000 }, { jti: '' },
    { tenantId: 'other' }, { workspaceId: 'other' }, { targetDigest: 'd'.repeat(64) },
    { payloadDigest: 'd'.repeat(64) }, { actionId: 'BBBBBBBBBBBBBBBBBBBBBA' },
    { operation: 'permission-response' }, { nonceId: 'other' },
    { iat: now / 1000 - 120, exp: now / 1000 + 60 }, { exp: now / 1000 },
    { iat: now / 1000 + 1 }, { iat: now / 1000 + 0.5 }, { exp: null },
  ])('should refuse signed IdP claim substitution %j', async (change) => {
    const payload = decodeJwt(await setup().issue(request));
    const evidence = await new SignJWT({ ...payload, ...change })
      .setProtectedHeader({ alg: 'EdDSA', kid: 'idp-1' }).sign(keys.privateKey);
    await expect(verifyRemoteEvidence(evidence, { key: keys.publicKey, issuer: 'idp', kid: 'idp-1',
      audience: 'native-b', tenantId: 'tenant-1', workspaceId: 'workspace-1', now, request, login }))
      .rejects.toHaveProperty('code');
  });
});
