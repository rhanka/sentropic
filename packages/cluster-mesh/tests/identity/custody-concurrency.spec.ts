// A2.0b custody concurrency: compare-and-swap single-winner semantics for
// consumes, rotations and social links on both durable profiles.

import { describe, expect, it } from 'vitest';
import type { IdentityUnitOfWorkV1 } from '../../src/index.js';
import { asOpHost, LATER, NOW, openPostgresEnv, openSqliteEnv, pgEnabled, randomBase64Url, sha256Hex } from './a20b-helpers.js';
import type { CustodyOpHost } from '../../src/index.js';

const WRITE = { mode: 'write' as const, deadlineMs: 8000 };

interface ProfileEnv {
  readonly unitOfWork: IdentityUnitOfWorkV1<CustodyOpHost>;
  readonly concurrent: boolean;
}

const results = async (settled: readonly PromiseSettledResult<unknown>[]): Promise<{ readonly fulfilled: number; readonly codes: readonly string[] }> => ({
  fulfilled: settled.filter((entry) => entry.status === 'fulfilled').length,
  codes: settled.filter((entry) => entry.status === 'rejected').map((entry) => (entry.reason as { code?: string }).code ?? 'unknown'),
});

const PROFILES = (pgEnabled ? ['postgres', 'sqlite'] : ['sqlite']) as const;

describe.each(PROFILES.map((profile) => ({ profile })))('A2.0b custody concurrency on $profile', ({ profile }) => {
  const openEnv = async (): Promise<ProfileEnv> => {
    if (profile === 'postgres') return { unitOfWork: asOpHost((await openPostgresEnv()).unitOfWork), concurrent: true };
    return { unitOfWork: asOpHost(openSqliteEnv().unitOfWork), concurrent: false };
  };

  it('consumes one registration challenge exactly once', async () => {
    const env = await openEnv();
    const challenge = randomBase64Url(32);
    await env.unitOfWork.runWrite(WRITE, (tx) =>
      tx.hostTransaction.stores.singleUseProofs.insert({
        kind: 'webauthn_challenge', proofId: 'race', userId: null, state: 'pending', revision: 0, createdAt: NOW, expiresAt: LATER,
        consumedAt: null, revokedAt: null, challenge, purpose: 'registration', rpId: 'idp.example.test',
        allowedOrigins: ['https://idp.example.test'], userVerification: 'preferred',
      }));
    const attempt = (bindUserId: string) =>
      env.unitOfWork.runWrite(WRITE, (tx) =>
        tx.hostTransaction.singleUseProofs.consume({
          key: { kind: 'webauthn_challenge', proofId: 'race' }, expectedRevision: 0, expectedUserId: null, bindUserId,
          match: { kind: 'webauthn_challenge', challenge, purpose: 'registration', rpId: 'idp.example.test' }, at: NOW,
        }));
    const settled = env.concurrent
      ? await Promise.allSettled([attempt('u-a'), attempt('u-b')])
      : [await attempt('u-a').then((value) => ({ status: 'fulfilled' as const, value }), (reason: unknown) => ({ status: 'rejected' as const, reason })),
          await attempt('u-b').then((value) => ({ status: 'fulfilled' as const, value }), (reason: unknown) => ({ status: 'rejected' as const, reason }))];
    const outcome = await results(settled);
    expect(outcome.fulfilled).toBe(1);
    expect(outcome.codes).toEqual(['proof_state_conflict']);
  });

  it('rotates one session exactly once per rotation version', async () => {
    const env = await openEnv();
    await env.unitOfWork.runWrite(WRITE, (tx) =>
      tx.hostTransaction.stores.sessions.insert({
        sessionId: 'race-session', userId: 'u1', sessionTokenHash: sha256Hex('race-sess'), refreshTokenHash: sha256Hex('race-refr'),
        login: { mfaVerified: false, authTime: 1000, sessionVersion: 1000 },
        rotationVersion: 0, createdAt: NOW, expiresAt: LATER, revokedAt: null, deviceName: null, ipAddress: null, userAgent: null, lastActivityAt: null,
      }));
    const attempt = (tag: string) =>
      env.unitOfWork.runWrite(WRITE, (tx) =>
        tx.hostTransaction.sessions.rotate({
          sessionId: 'race-session', userId: 'u1', expectedRefreshTokenHash: sha256Hex('race-refr'), expectedRotationVersion: 0,
          verifiedLogin: { mfaVerified: false, authTime: 1000, sessionVersion: 1000 },
          nextSessionTokenHash: sha256Hex(`race-next-sess-${tag}`), nextRefreshTokenHash: sha256Hex(`race-next-refr-${tag}`),
          nextExpiresAt: LATER, at: NOW,
        }));
    const settled = env.concurrent
      ? await Promise.allSettled([attempt('a'), attempt('b')])
      : [await attempt('a').then((value) => ({ status: 'fulfilled' as const, value }), (reason: unknown) => ({ status: 'rejected' as const, reason })),
          await attempt('b').then((value) => ({ status: 'fulfilled' as const, value }), (reason: unknown) => ({ status: 'rejected' as const, reason }))];
    const outcome = await results(settled);
    expect(outcome.fulfilled).toBe(1);
    expect(outcome.codes).toEqual(['login_refresh_conflict']);
  });

  it('links one social subject exactly once', async () => {
    const env = await openEnv();
    const link = (proofId: string, userId: string) => ({
      proofId, userId, provider: 'github', providerSubject: 'race-subject', providerTenant: null, emailAtLink: null,
      emailVerifiedByProvider: false, linkedAt: NOW, lastLoginAt: null, revokedAt: null, revision: 0,
    });
    const attempt = (proofId: string, userId: string) =>
      env.unitOfWork.runWrite(WRITE, (tx) => tx.hostTransaction.stores.social.insert(link(proofId, userId)));
    const settled = env.concurrent
      ? await Promise.allSettled([attempt('p-a', 'u-a'), attempt('p-b', 'u-b')])
      : [await attempt('p-a', 'u-a').then((value) => ({ status: 'fulfilled' as const, value }), (reason: unknown) => ({ status: 'rejected' as const, reason })),
          await attempt('p-b', 'u-b').then((value) => ({ status: 'fulfilled' as const, value }), (reason: unknown) => ({ status: 'rejected' as const, reason }))];
    const outcome = await results(settled);
    expect(outcome.fulfilled).toBe(1);
    expect(outcome.codes).toEqual(['social_subject_conflict']);
  });
});
