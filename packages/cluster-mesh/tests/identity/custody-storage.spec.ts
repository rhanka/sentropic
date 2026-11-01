// A2.0b custody storage behaviors on both profiles: CAS, compare-and-swap,
// state machines, expiry strictness, ordering and uniqueness.

import { describe, expect, it } from 'vitest';
import type { SingleUseProofV1 } from '../../src/index.js';
import { asOpHost, LATER, NOW, openPostgresEnv, openSqliteEnv, randomBase64Url, sha256Hex, syntheticCoseKey } from './a20b-helpers.js';
import type { CustodyOpHost } from '../../src/index.js';
import type { IdentityTransactionV1, IdentityUnitOfWorkV1 } from '../../src/index.js';

const WRITE = { mode: 'write' as const, deadlineMs: 5000 };
const READ = { mode: 'read' as const, deadlineMs: 5000 };

interface ProfileEnv {
  readonly unitOfWork: IdentityUnitOfWorkV1<CustodyOpHost>;
  readonly schema: string | null;
}

const credential = (proofId: string, userId: string) => ({
  proofId, userId, credentialId: randomBase64Url(32), publicKeyCose: syntheticCoseKey(proofId), counter: 0, revision: 0,
  rpId: 'idp.example.test', deviceName: null, transports: null, uv: false, deviceType: null, backedUp: null,
  createdAt: NOW, lastUsedAt: null, revokedAt: null,
});

const emailProof = (proofId: string, email: string, digest: { algorithm: 'sha256'; value: string }): SingleUseProofV1 => ({
  kind: 'email_code', proofId, userId: null, state: 'pending', revision: 0, createdAt: NOW, expiresAt: LATER,
  consumedAt: null, revokedAt: null, email, codeDigest: digest,
});

describe.each([{ profile: 'postgres' }, { profile: 'sqlite' }])('A2.0b custody storage on $profile', ({ profile }) => {
  const openEnv = async (): Promise<ProfileEnv> => {
    if (profile === 'postgres') {
      const pg = await openPostgresEnv();
      return { unitOfWork: asOpHost(pg.unitOfWork), schema: pg.schema };
    }
    return { unitOfWork: asOpHost(openSqliteEnv().unitOfWork), schema: null };
  };
  const write = async (env: ProfileEnv, fn: (tx: IdentityTransactionV1<CustodyOpHost>) => Promise<void>): Promise<void> => {
    await env.unitOfWork.runWrite(WRITE, async (tx) => {
      await fn(tx);
    });
  };

  it('advances credential counters exactly once per revision', async () => {
    const env = await openEnv();
    await write(env, (tx) => tx.hostTransaction.stores.credentials.insert(credential('c1', 'u1')).then(() => undefined));
    const advanced = await env.unitOfWork.runWrite(WRITE, (tx) =>
      tx.hostTransaction.stores.credentials.compareAndSwapCounter({ proofId: 'c1', userId: 'u1', expectedCounter: 0, expectedRevision: 0, newCounter: 0, at: NOW }));
    expect(advanced.counter).toBe(0);
    expect(advanced.revision).toBe(1);
    await expect(env.unitOfWork.runWrite(WRITE, (tx) =>
      tx.hostTransaction.stores.credentials.compareAndSwapCounter({ proofId: 'c1', userId: 'other', expectedCounter: 0, expectedRevision: 1, newCounter: 1, at: NOW }),
    )).rejects.toMatchObject({ code: 'proof_binding_mismatch' });
    await expect(env.unitOfWork.runWrite(WRITE, (tx) =>
      tx.hostTransaction.stores.credentials.compareAndSwapCounter({ proofId: 'c1', userId: 'u1', expectedCounter: 5, expectedRevision: 1, newCounter: 6, at: NOW }),
    )).rejects.toMatchObject({ code: 'webauthn_credential_stale' });
    await env.unitOfWork.runWrite(WRITE, (tx) => tx.hostTransaction.stores.credentials.revoke('c1', 'u1', LATER));
    await expect(env.unitOfWork.runWrite(WRITE, (tx) =>
      tx.hostTransaction.stores.credentials.compareAndSwapCounter({ proofId: 'c1', userId: 'u1', expectedCounter: 0, expectedRevision: 2, newCounter: 1, at: LATER }),
    )).rejects.toMatchObject({ code: 'identity_material_missing' });
  });

  it('consumes single-use proofs once and purges only terminal rows', async () => {
    const env = await openEnv();
    const digest = { algorithm: 'sha256' as const, value: sha256Hex('code-1') };
    await write(env, async (tx) => {
      await tx.hostTransaction.stores.singleUseProofs.insert(emailProof('e1', 'a@example.test', digest));
      await tx.hostTransaction.stores.singleUseProofs.insert(emailProof('e2', 'a@example.test', digest));
    });
    const latest = await env.unitOfWork.runRead(READ, (tx) =>
      tx.hostTransaction.singleUseProofs.findLatestEmailCode('a@example.test', [digest], NOW));
    expect(latest?.proofId).toBe('e2');
    await expect(env.unitOfWork.runWrite(WRITE, (tx) =>
      tx.hostTransaction.singleUseProofs.revoke({ kind: 'email_code', proofId: 'e1' }, 7, NOW),
    )).rejects.toMatchObject({ code: 'proof_state_conflict' });
    await env.unitOfWork.runWrite(WRITE, (tx) =>
      tx.hostTransaction.singleUseProofs.revoke({ kind: 'email_code', proofId: 'e1' }, 0, NOW));
    const purged = await env.unitOfWork.runWrite(WRITE, (tx) => tx.hostTransaction.singleUseProofs.purgeExpired(LATER));
    expect(purged).toBe(0);
    await write(env, (tx) => tx.hostTransaction.stores.singleUseProofs.insert({
      kind: 'magic_link', proofId: 'm1', userId: null, state: 'consumed', revision: 1, createdAt: NOW, expiresAt: NOW,
      consumedAt: NOW, revokedAt: null, email: 'a@example.test', tokenHash: sha256Hex('m1'),
    }));
    const purgedTerminal = await env.unitOfWork.runWrite(WRITE, (tx) => tx.hostTransaction.singleUseProofs.purgeExpired(LATER));
    expect(purgedTerminal).toBe(1);
  });

  it('exchanges email codes for tickets exactly once', async () => {
    const env = await openEnv();
    const digest = { algorithm: 'sha256' as const, value: sha256Hex('code-9') };
    await write(env, (tx) => tx.hostTransaction.stores.singleUseProofs.insert(emailProof('code-9', 'a@example.test', digest)));
    const ticket = await env.unitOfWork.runWrite(WRITE, (tx) =>
      tx.hostTransaction.emailTickets.exchangeCode({
        codeProofId: 'code-9', expectedRevision: 0, email: 'a@example.test', digest,
        ticket: { codeProofId: 'code-9', email: 'a@example.test', tokenHash: sha256Hex('ticket-9'), userId: null, state: 'pending', revision: 0, createdAt: NOW, expiresAt: LATER, consumedAt: null, revokedAt: null },
        at: NOW,
      }));
    expect(ticket.tokenHash).toBe(sha256Hex('ticket-9'));
    await expect(env.unitOfWork.runWrite(WRITE, (tx) =>
      tx.hostTransaction.emailTickets.exchangeCode({
        codeProofId: 'code-9', expectedRevision: 1, email: 'a@example.test', digest,
        ticket: { codeProofId: 'code-9', email: 'a@example.test', tokenHash: sha256Hex('ticket-9b'), userId: null, state: 'pending', revision: 0, createdAt: NOW, expiresAt: LATER, consumedAt: null, revokedAt: null },
        at: NOW,
      }),
    )).rejects.toMatchObject({ code: 'proof_state_conflict' });
    const consumed = await env.unitOfWork.runWrite(WRITE, (tx) =>
      tx.hostTransaction.emailTickets.consume({ tokenHash: sha256Hex('ticket-9'), email: 'a@example.test', expectedRevision: 0, bindUserId: 'u9', at: NOW }));
    expect(consumed).toMatchObject({ userId: 'u9', state: 'consumed' });
    await expect(env.unitOfWork.runWrite(WRITE, (tx) =>
      tx.hostTransaction.emailTickets.consume({ tokenHash: sha256Hex('ticket-9'), email: 'a@example.test', expectedRevision: 1, bindUserId: 'u9', at: NOW }),
    )).rejects.toMatchObject({ code: 'proof_state_conflict' });
  });

  it('rotates bound sessions with single-winner rotation versions', async () => {
    const env = await openEnv();
    const session = {
      sessionId: 's1', userId: 'u1', sessionTokenHash: sha256Hex('sess-1'), refreshTokenHash: sha256Hex('refr-1'),
      login: { mfaVerified: true, authTime: 1000, sessionVersion: 1000 },
      rotationVersion: 0, createdAt: NOW, expiresAt: LATER, revokedAt: null, deviceName: 'd', ipAddress: 'ip', userAgent: 'ua', lastActivityAt: null,
    };
    await write(env, (tx) => tx.hostTransaction.stores.sessions.insert(session));
    const bySession = await env.unitOfWork.runRead(READ, (tx) => tx.hostTransaction.stores.sessions.findBySessionTokenHash(sha256Hex('sess-1')));
    expect(bySession?.userId).toBe('u1');
    const byRefresh = await env.unitOfWork.runRead(READ, (tx) => tx.hostTransaction.stores.sessions.findByRefreshTokenHash(sha256Hex('refr-1')));
    expect(byRefresh?.sessionId).toBe('s1');
    const rotated = await env.unitOfWork.runWrite(WRITE, (tx) =>
      tx.hostTransaction.sessions.rotate({
        sessionId: 's1', userId: 'u1', expectedRefreshTokenHash: sha256Hex('refr-1'), expectedRotationVersion: 0,
        verifiedLogin: { mfaVerified: true, authTime: 1000, sessionVersion: 1000 },
        nextSessionTokenHash: sha256Hex('sess-2'), nextRefreshTokenHash: sha256Hex('refr-2'), nextExpiresAt: '2026-11-01T13:00:00.000Z', at: NOW,
      }));
    expect(rotated.rotationVersion).toBe(1);
    expect(rotated.expiresAt).toBe('2026-11-01T13:00:00.000Z');
    await expect(env.unitOfWork.runWrite(WRITE, (tx) =>
      tx.hostTransaction.sessions.rotate({
        sessionId: 's1', userId: 'u1', expectedRefreshTokenHash: sha256Hex('refr-1'), expectedRotationVersion: 0,
        verifiedLogin: { mfaVerified: true, authTime: 1000, sessionVersion: 1000 },
        nextSessionTokenHash: sha256Hex('sess-3'), nextRefreshTokenHash: sha256Hex('refr-3'), nextExpiresAt: '2026-11-01T13:00:00.000Z', at: NOW,
      }),
    )).rejects.toMatchObject({ code: 'login_refresh_conflict' });
    await env.unitOfWork.runWrite(WRITE, (tx) => tx.hostTransaction.stores.sessions.touchActivity('s1', LATER));
    const touched = await env.unitOfWork.runRead(READ, (tx) => tx.hostTransaction.stores.sessions.findById('s1'));
    expect(touched?.lastActivityAt).toBe(LATER);
  });

  it('keeps social subjects stable across unlink and relink', async () => {
    const env = await openEnv();
    const link = (proofId: string, userId: string) => ({
      proofId, userId, provider: 'github', providerSubject: 'subject-1', providerTenant: null, emailAtLink: 'a@example.test',
      emailVerifiedByProvider: true, linkedAt: NOW, lastLoginAt: null, revokedAt: null, revision: 0,
    });
    await write(env, (tx) => tx.hostTransaction.stores.social.insert(link('p1', 'u1')));
    await expect(write(env, (tx) => tx.hostTransaction.stores.social.insert(link('p2', 'u2')))).rejects.toMatchObject({ code: 'social_subject_conflict' });
    const found = await env.unitOfWork.runRead(READ, (tx) => tx.hostTransaction.stores.social.findBySubject('github', 'subject-1'));
    expect(found?.proofId).toBe('p1');
    await env.unitOfWork.runWrite(WRITE, (tx) => tx.hostTransaction.stores.social.touchLogin('p1', 0, NOW));
    await expect(env.unitOfWork.runWrite(WRITE, (tx) => tx.hostTransaction.stores.social.touchLogin('p1', 0, NOW))).rejects.toMatchObject({ code: 'proof_state_conflict' });
    await env.unitOfWork.runWrite(WRITE, (tx) => tx.hostTransaction.stores.social.unlink('p1', 'u1', 1, NOW));
    expect(await env.unitOfWork.runRead(READ, (tx) => tx.hostTransaction.stores.social.findBySubject('github', 'subject-1'))).toBeNull();
    await write(env, (tx) => tx.hostTransaction.stores.social.insert(link('p3', 'u2')));
    expect(await env.unitOfWork.runRead(READ, (tx) => tx.hostTransaction.stores.social.findBySubject('github', 'subject-1'))).toMatchObject({ proofId: 'p3', userId: 'u2' });
  });

  it('applies custody schema assets idempotently with digest validation', async () => {
    const env = await openEnv();
    const { identityCustodySchemaAssetV1 } = await import('../../src/index.js');
    const asset = identityCustodySchemaAssetV1(profile);
    expect(asset.migrationId).toBe('A2.0b/1');
    expect(asset.statements.length).toBeGreaterThan(15);
    if (profile === 'sqlite') {
      const { applySqliteIdentityCustodySchemaV1, SqliteCustodyHandle } = await import('../../src/index.js');
      const apply = (appliedAt: string, digest: string) =>
        env.unitOfWork.runWrite(WRITE, (tx) =>
          applySqliteIdentityCustodySchemaV1({
            binding: { transactionId: tx.transactionId, hostTransaction: null, connection: (tx.hostTransaction as SqliteCustodyHandle).connection, readOnly: false },
            expectedAssetSha256: digest,
            appliedAt,
          }));
      const first = await apply(NOW, asset.assetSha256);
      expect(first).toMatchObject({ migrationId: 'A2.0b/1', contractVersion: '1.1.0', profile: 'sqlite', appliedAt: NOW });
      const second = await apply(LATER, asset.assetSha256);
      expect(second.appliedAt).toBe(NOW);
      await expect(apply(NOW, sha256Hex('wrong'))).rejects.toMatchObject({ code: 'identity_contract_unavailable' });
    } else {
      const { applyPostgresIdentityCustodySchemaV1, PostgresCustodyHandle } = await import('../../src/index.js');
      const apply = (appliedAt: string, digest: string) =>
        env.unitOfWork.runWrite(WRITE, (tx) =>
          applyPostgresIdentityCustodySchemaV1({
            schema: env.schema ?? '',
            binding: { transactionId: tx.transactionId, hostTransaction: null, session: (tx.hostTransaction as PostgresCustodyHandle).session, readOnly: false },
            expectedAssetSha256: digest,
            appliedAt,
          }));
      const first = await apply(NOW, asset.assetSha256);
      expect(first).toMatchObject({ migrationId: 'A2.0b/1', contractVersion: '1.1.0', profile: 'postgres', appliedAt: NOW });
      const second = await apply(LATER, asset.assetSha256);
      expect(second.appliedAt).toBe(NOW);
      await expect(apply(NOW, sha256Hex('wrong'))).rejects.toMatchObject({ code: 'identity_contract_unavailable' });
    }
  });
});
