// A2.0b auth binding on both profiles: HS256 ticket continuation without
// issuers, email-code algorithm/keyring union ordering, bound-session
// validate/refresh flows, stable social identities, digest-invitation client
// rules and one-shot magic links.

import { describe, expect, it } from 'vitest';
import type { IdentityUnitOfWorkV1 } from '../../src/index.js';
import { InvitationError } from '../../src/index.js';
import {
  assertCanonicalEmailV1,
  createHs256EmailTicketPort,
  createNodeIdentityDigestPort,
  emailCodePreimageV1,
  zeroizeV1,
} from '../../src/index.js';
import { asOpHost, LATER, NOW, openPostgresEnv, openSqliteEnv, pgEnabled, sha256Hex } from './a20b-helpers.js';
import type { CustodyOpHost } from '../../src/index.js';

const WRITE = { mode: 'write' as const, deadlineMs: 5000 };
const READ = { mode: 'read' as const, deadlineMs: 5000 };

interface ProfileEnv {
  readonly unitOfWork: IdentityUnitOfWorkV1<CustodyOpHost>;
}

const PROFILES = (pgEnabled ? ['postgres', 'sqlite'] : ['sqlite']) as const;

describe.each(PROFILES.map((profile) => ({ profile })))('A2.0b auth binding on $profile', ({ profile }) => {
  const openEnv = async (): Promise<ProfileEnv> => {
    if (profile === 'postgres') return { unitOfWork: asOpHost((await openPostgresEnv()).unitOfWork) };
    return { unitOfWork: asOpHost(openSqliteEnv().unitOfWork) };
  };

  it('signs HS256 email tickets without fabricating an issuer', async () => {
    const secret = new Uint8Array(32).fill(7);
    const port = createHs256EmailTicketPort(secret);
    const claims = { codeProofId: 'code-1', email: 'marie@example.test', issuedAt: NOW, expiresAt: LATER };
    const token = await port.sign(claims);
    expect(token.split('.')).toHaveLength(3);
    const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'));
    expect(payload).not.toHaveProperty('iss');
    expect(payload).toMatchObject({ codeProofId: 'code-1', email: 'marie@example.test' });
    const verified = await port.verify(new Uint8Array(Buffer.from(token, 'utf8')), '2026-11-01T12:15:00.000Z');
    expect(verified).toEqual(claims);
    const forImport = await port.verifyForImport(new Uint8Array(Buffer.from(token, 'utf8')));
    expect(forImport).toEqual(claims);
    await expect(port.verify(new Uint8Array(Buffer.from(token, 'utf8')), LATER)).rejects.toMatchObject({ code: 'identity_material_invalid' });
    const tampered = `${token.slice(0, -2)}ab`;
    await expect(port.verify(new Uint8Array(Buffer.from(tampered, 'utf8')), NOW)).rejects.toMatchObject({ code: 'identity_material_invalid' });
    secret.fill(0);
  });

  it('matches email codes across the SHA-256/HMAC-SHA256 union in one recency-ordered query', async () => {
    const env = await openEnv();
    const activeKey = new Uint8Array(32).fill(11);
    const previousKey = new Uint8Array(32).fill(13);
    const digest = createNodeIdentityDigestPort({ active: activeKey, previous: previousKey });
    const email = 'marie@example.test';
    assertCanonicalEmailV1(email);
    const preimage = emailCodePreimageV1(email, '123456');
    const hmacActive = await digest.hmacSha256('active', preimage);
    preimage.fill(0);
    const preimage2 = emailCodePreimageV1(email, '123456');
    const sha = await digest.sha256(preimage2);
    preimage2.fill(0);
    await env.unitOfWork.runWrite(WRITE, (tx) =>
      tx.hostTransaction.stores.singleUseProofs.insert({
        kind: 'email_code', proofId: 'union-hmac', userId: null, state: 'pending', revision: 0, createdAt: NOW, expiresAt: LATER,
        consumedAt: null, revokedAt: null, email, codeDigest: { algorithm: 'hmac-sha256', value: hmacActive, keyRef: 'active' },
      }));
    await env.unitOfWork.runWrite(WRITE, (tx) =>
      tx.hostTransaction.stores.singleUseProofs.insert({
        kind: 'email_code', proofId: 'union-sha', userId: null, state: 'pending', revision: 0, createdAt: NOW, expiresAt: LATER,
        consumedAt: null, revokedAt: null, email, codeDigest: { algorithm: 'sha256', value: sha },
      }));
    // Candidates are computed in keyring order (active HMAC, previous keys,
    // then legacy SHA-256), but the union is queried once and rows are ordered
    // by recency: equal createdAt ties break on bytewise descending proofId.
    const hmacPrevious = await digest.hmacSha256('previous', emailCodePreimageV1(email, '123456'));
    const found = await env.unitOfWork.runRead(READ, (tx) =>
      tx.hostTransaction.singleUseProofs.findLatestEmailCode(email, [
        { algorithm: 'hmac-sha256', value: hmacActive, keyRef: 'active' },
        { algorithm: 'sha256', value: sha },
        { algorithm: 'hmac-sha256', value: hmacPrevious, keyRef: 'previous' },
      ], NOW));
    expect(found?.proofId).toBe('union-sha');
    const foundHmac = await env.unitOfWork.runRead(READ, (tx) =>
      tx.hostTransaction.singleUseProofs.findLatestEmailCode(email, [{ algorithm: 'hmac-sha256', value: hmacActive, keyRef: 'active' }], NOW));
    expect(foundHmac?.proofId).toBe('union-hmac');
    const foundSha = await env.unitOfWork.runRead(READ, (tx) =>
      tx.hostTransaction.singleUseProofs.findLatestEmailCode(email, [{ algorithm: 'sha256', value: sha }], NOW));
    expect(foundSha?.proofId).toBe('union-sha');
    zeroizeV1(activeKey);
    zeroizeV1(previousKey);
  });

  it('consumes digest invitations under the client-partition rule', async () => {
    const env = await openEnv();
    const digest = sha256Hex('invite-client');
    await env.unitOfWork.runWrite(WRITE, (tx) =>
      tx.hostTransaction.stores.invitations.insert({
        invitationId: 'invite-client', email: 'marie@example.test', tenantId: 'org', workspaceId: null, clientId: 'app',
        tokenHash: digest, status: 'pending', expiresAt: LATER, createdAt: NOW, consumedAt: null, consumedByUserId: null, revision: 0,
      }));
    // A null presentation never crosses into a client-partitioned row.
    await expect(env.unitOfWork.runWrite(WRITE, (tx) =>
      tx.hostTransaction.stores.invitations.consumeByDigest({ tokenHash: digest, email: 'marie@example.test', clientId: null, userId: 'marie', expectedRevision: 0, at: NOW }),
    )).rejects.toBeInstanceOf(InvitationError);
    // A wrong client never crosses either.
    await expect(env.unitOfWork.runWrite(WRITE, (tx) =>
      tx.hostTransaction.stores.invitations.consumeByDigest({ tokenHash: digest, email: 'marie@example.test', clientId: 'other', userId: 'marie', expectedRevision: 0, at: NOW }),
    )).rejects.toBeInstanceOf(InvitationError);
    const consumed = await env.unitOfWork.runWrite(WRITE, (tx) =>
      tx.hostTransaction.stores.invitations.consumeByDigest({ tokenHash: digest, email: 'marie@example.test', clientId: 'app', userId: 'marie', expectedRevision: 0, at: NOW }));
    expect(consumed.status).toBe('consumed');
  });

  it('consumes magic links once for the exact email', async () => {
    const env = await openEnv();
    const tokenHash = sha256Hex('magic-1');
    await env.unitOfWork.runWrite(WRITE, (tx) =>
      tx.hostTransaction.stores.singleUseProofs.insert({
        kind: 'magic_link', proofId: 'magic-1', userId: null, state: 'pending', revision: 0, createdAt: NOW, expiresAt: LATER,
        consumedAt: null, revokedAt: null, email: 'marie@example.test', tokenHash,
      }));
    expect(await env.unitOfWork.runRead(READ, (tx) => tx.hostTransaction.stores.singleUseProofs.findMagicLink(tokenHash))).toMatchObject({ proofId: 'magic-1' });
    await expect(env.unitOfWork.runWrite(WRITE, (tx) =>
      tx.hostTransaction.singleUseProofs.consume({
        key: { kind: 'magic_link', proofId: 'magic-1' }, expectedRevision: 0, expectedUserId: null, bindUserId: 'marie',
        match: { kind: 'magic_link', email: 'wrong@example.test', tokenHash }, at: NOW,
      }),
    )).rejects.toMatchObject({ code: 'proof_binding_mismatch' });
    const consumed = await env.unitOfWork.runWrite(WRITE, (tx) =>
      tx.hostTransaction.singleUseProofs.consume({
        key: { kind: 'magic_link', proofId: 'magic-1' }, expectedRevision: 0, expectedUserId: null, bindUserId: 'marie',
        match: { kind: 'magic_link', email: 'marie@example.test', tokenHash }, at: NOW,
      }));
    expect(consumed).toMatchObject({ userId: 'marie', state: 'consumed' });
  });

  it('refuses refreshes with stale rotations or rebound logins', async () => {
    const env = await openEnv();
    await env.unitOfWork.runWrite(WRITE, (tx) =>
      tx.hostTransaction.stores.sessions.insert({
        sessionId: 'sess-auth', userId: 'u1', sessionTokenHash: sha256Hex('sess-auth'), refreshTokenHash: sha256Hex('refr-auth'),
        login: { mfaVerified: false, authTime: 1000, sessionVersion: 1000 },
        rotationVersion: 0, createdAt: NOW, expiresAt: LATER, revokedAt: null, deviceName: null, ipAddress: null, userAgent: null, lastActivityAt: null,
      }));
    const attempt = (login: { mfaVerified: boolean; authTime: number; sessionVersion: number }, next: string) =>
      env.unitOfWork.runWrite(WRITE, (tx) =>
        tx.hostTransaction.sessions.rotate({
          sessionId: 'sess-auth', userId: 'evil-u', expectedRefreshTokenHash: sha256Hex('refr-auth'), expectedRotationVersion: 0,
          verifiedLogin: login, nextSessionTokenHash: sha256Hex(next), nextRefreshTokenHash: sha256Hex(`${next}-r`), nextExpiresAt: LATER, at: NOW,
        }));
    await expect(attempt({ mfaVerified: false, authTime: 1000, sessionVersion: 1000 }, 'x')).rejects.toMatchObject({ code: 'login_binding_mismatch' });
    await expect(env.unitOfWork.runWrite(WRITE, (tx) =>
      tx.hostTransaction.sessions.rotate({
        sessionId: 'sess-auth', userId: 'u1', expectedRefreshTokenHash: sha256Hex('refr-auth'), expectedRotationVersion: 0,
        verifiedLogin: { mfaVerified: true, authTime: 1000, sessionVersion: 1000 },
        nextSessionTokenHash: sha256Hex('y'), nextRefreshTokenHash: sha256Hex('y-r'), nextExpiresAt: LATER, at: NOW,
      }),
    )).rejects.toMatchObject({ code: 'login_binding_mismatch' });
    await env.unitOfWork.runWrite(WRITE, (tx) => tx.hostTransaction.stores.sessions.revoke('sess-auth', NOW));
    await expect(env.unitOfWork.runWrite(WRITE, (tx) =>
      tx.hostTransaction.sessions.rotate({
        sessionId: 'sess-auth', userId: 'u1', expectedRefreshTokenHash: sha256Hex('refr-auth'), expectedRotationVersion: 0,
        verifiedLogin: { mfaVerified: false, authTime: 1000, sessionVersion: 1000 },
        nextSessionTokenHash: sha256Hex('z'), nextRefreshTokenHash: sha256Hex('z-r'), nextExpiresAt: LATER, at: NOW,
      }),
    )).rejects.toMatchObject({ code: 'login_binding_mismatch' });
  });
});
