// A2.0b security evidence on both profiles: exact hash preimages, keyed
// digests, caller-buffer ownership and zeroization, log redaction canaries
// and secret-at-rest scans over every custody row.

import { describe, expect, it } from 'vitest';
import type { IdentityUnitOfWorkV1 } from '../../src/index.js';
import {
  createNodeIdentityDigestPort,
  emailCodePreimageV1,
  hashPresentedTokenV1,
  issueInvitationTokenV1,
  issueSessionTokenMaterialV1,
  scrubIdentityErrorForLog,
  zeroizeV1,
} from '../../src/index.js';
import { asOpHost, NOW, openPostgresEnv, openSqliteEnv, randomBase64Url, sha256Hex, syntheticCoseKey } from './a20b-helpers.js';
import type { CustodyOpHost } from '../../src/index.js';

const WRITE = { mode: 'write' as const, deadlineMs: 5000 };
const READ = { mode: 'read' as const, deadlineMs: 5000 };

const KNOWN_SHA256_ABC = 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad';
// RFC 4231 test case 1: key 20x0x0b, data "Hi There".
const RFC4231_TC1 = 'b0344c61d8db38535ca8afceaf0bf12b881dc200c9833da726e9bda251e';

describe.each([{ profile: 'postgres' }, { profile: 'sqlite' }])('A2.0b custody security on $profile', ({ profile }) => {
  const openEnv = async (): Promise<{ unitOfWork: IdentityUnitOfWorkV1<CustodyOpHost> }> => {
    if (profile === 'postgres') return { unitOfWork: asOpHost((await openPostgresEnv()).unitOfWork) };
    return { unitOfWork: asOpHost(openSqliteEnv().unitOfWork) };
  };

  it('produces exact SHA-256 and HMAC-SHA256 vectors', async () => {
    const port = createNodeIdentityDigestPort({ active: new Uint8Array(20).fill(0x0b) });
    const bytes = new Uint8Array(Buffer.from('abc', 'utf8'));
    expect(await port.sha256(bytes)).toBe(KNOWN_SHA256_ABC);
    const message = new Uint8Array(Buffer.from('Hi There', 'utf8'));
    const hmac = await port.hmacSha256('active', message);
    expect(hmac).toBe(RFC4231_TC1);
  });

  it('uses exact documented preimages for email codes and invitations', async () => {
    const preimage = emailCodePreimageV1('marie@example.test', '123456');
    expect(Buffer.from(preimage).toString('utf8')).toBe(JSON.stringify(['cm-email-code', '1', 'marie@example.test', '123456']));
    const left = Buffer.from(preimage).toString('utf8');
    preimage.fill(0);
    expect(left).toContain('cm-email-code');
    const issued = issueInvitationTokenV1();
    expect(issued.token.startsWith('sit_')).toBe(true);
    expect(hashPresentedTokenV1(issued.token)).toBe(sha256Hex(issued.token));
    const session = issueSessionTokenMaterialV1();
    expect(session.session.token.startsWith('sit_')).toBe(true);
    expect(session.refresh.token.startsWith('sit_')).toBe(true);
    expect(session.session.token).not.toBe(session.refresh.token);
    for (const material of [issued.material, session.session.material, session.refresh.material]) {
      expect(material.byteLength).toBe(32);
      zeroizeV1(material);
      expect(material.every((byte) => byte === 0)).toBe(true);
    }
    issued.material.fill(0);
  });

  it('borrows caller buffers without retaining or zeroing them', async () => {
    const port = createNodeIdentityDigestPort({});
    const input = new Uint8Array(Buffer.from('borrowed', 'utf8'));
    const snapshot = Uint8Array.from(input);
    const first = await port.sha256(input);
    expect(Array.from(input)).toEqual(Array.from(snapshot));
    input[0] ^= 0xff;
    const second = await port.sha256(input);
    expect(second).not.toBe(first);
    expect(port.equal(new Uint8Array([1, 2]), new Uint8Array([1, 2]))).toBe(true);
    expect(port.equal(new Uint8Array([1, 2]), new Uint8Array([1, 3]))).toBe(false);
    expect(port.equal(new Uint8Array([1]), new Uint8Array([1, 2]))).toBe(false);
  });

  it('keeps raw tokens and codes out of error messages and logs', async () => {
    const env = await openEnv();
    const secret = `tok-${randomBase64Url(16)}-marie@example.test`;
    const email = 'marie@example.test';
    await env.unitOfWork.runWrite(WRITE, (tx) =>
      tx.hostTransaction.stores.singleUseProofs.insert({
        kind: 'email_code', proofId: 'sec-1', userId: null, state: 'pending', revision: 0, createdAt: NOW, expiresAt: '2026-11-01T13:00:00.000Z',
        consumedAt: null, revokedAt: null, email, codeDigest: { algorithm: 'sha256', value: sha256Hex(secret) },
      }));
    const failure = await env.unitOfWork.runWrite(WRITE, (tx) =>
      tx.hostTransaction.singleUseProofs.consume({
        key: { kind: 'email_code', proofId: 'sec-1' }, expectedRevision: 0, expectedUserId: null, bindUserId: null,
        match: { kind: 'email_code', email, digest: { algorithm: 'sha256', value: sha256Hex('wrong') } }, at: NOW,
      }),
    ).then(
      () => { throw new Error('must not consume'); },
      (error: unknown) => error,
    );
    const scrubbed = scrubIdentityErrorForLog(failure);
    expect(scrubbed).toEqual({ code: 'proof_binding_mismatch' });
    expect(JSON.stringify(scrubbed)).not.toContain('marie@example.test');
    expect(String((failure as Error).message)).not.toContain(secret);
    expect(String((failure as Error).message)).not.toContain(email);
  });

  it('stores only digests: custody rows never contain presented material', async () => {
    const env = await openEnv();
    const presentedToken = `sit_${randomBase64Url(24)}`;
    const presentedCode = randomBase64Url(12);
    const credentialCose = syntheticCoseKey('sec-cred');
    await env.unitOfWork.runWrite(WRITE, async (tx) => {
      const host = tx.hostTransaction;
      await host.journal.insertAccountCore({ userId: 'sec-u', email: 'sec@example.test', accountStatus: 'active', globalRole: 'editor', createdAt: NOW, updatedAt: NOW });
      await host.journal.ensureLiveFence('sec-u', NOW);
      await host.stores.profiles.put({ userId: 'sec-u', emailVerified: true, displayName: null, approvalDueAt: null, approvedAt: null, approvedByUserId: null, disabledAt: null, disabledReason: null, legacyAccountStatus: null });
      await host.stores.credentials.insert({
        proofId: 'sec-cred', userId: 'sec-u', credentialId: randomBase64Url(32), publicKeyCose: credentialCose, counter: 0, revision: 0,
        rpId: 'idp.example.test', deviceName: null, transports: null, uv: false, deviceType: null, backedUp: null,
        createdAt: NOW, lastUsedAt: null, revokedAt: null,
      });
      await host.stores.singleUseProofs.insert({
        kind: 'email_code', proofId: 'sec-code', userId: null, state: 'pending', revision: 0, createdAt: NOW, expiresAt: '2026-11-01T13:00:00.000Z',
        consumedAt: null, revokedAt: null, email: 'sec@example.test', codeDigest: { algorithm: 'sha256', value: sha256Hex(presentedCode) },
      });
      await host.stores.invitations.insert({
        invitationId: 'sec-invite', email: 'sec@example.test', tenantId: null, workspaceId: null, clientId: null,
        tokenHash: hashPresentedTokenV1(presentedToken), status: 'pending', expiresAt: '2026-11-01T13:00:00.000Z',
        createdAt: NOW, consumedAt: null, consumedByUserId: null, revision: 0,
      });
      await host.stores.sessions.insert({
        sessionId: 'sec-sess', userId: 'sec-u', sessionTokenHash: sha256Hex('sec-session-token'), refreshTokenHash: sha256Hex('sec-refresh-token'),
        login: { mfaVerified: false, authTime: 1000, sessionVersion: 1000 },
        rotationVersion: 0, createdAt: NOW, expiresAt: '2026-11-01T13:00:00.000Z', revokedAt: null, deviceName: null, ipAddress: null, userAgent: null, lastActivityAt: null,
      });
    });
    const forbidden = [presentedToken, presentedCode, 'sec-session-token', 'sec-refresh-token'];
    await env.unitOfWork.runRead(READ, async (tx) => {
      const rows: string[] = [];
      const credential = await tx.hostTransaction.stores.credentials.findById('sec-cred');
      rows.push(JSON.stringify(credential));
      const proof = await tx.hostTransaction.stores.singleUseProofs.find({ kind: 'email_code', proofId: 'sec-code' });
      rows.push(JSON.stringify(proof));
      const invitation = await tx.hostTransaction.stores.invitations.findById('sec-invite');
      rows.push(JSON.stringify(invitation));
      const session = await tx.hostTransaction.stores.sessions.findById('sec-sess');
      rows.push(JSON.stringify(session));
      for (const serialized of rows) {
        for (const secret of forbidden) {
          expect(serialized).not.toContain(secret);
        }
      }
      // Digests are present and verify against the presented material.
      expect(JSON.stringify(rows)).toContain(sha256Hex(presentedCode));
      expect(JSON.stringify(rows)).toContain(hashPresentedTokenV1(presentedToken));
    });
  });
});
