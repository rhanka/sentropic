import { decodeJwt } from 'jose';
import { z } from 'zod';
import { db } from '../../db/client';
import { oauthDpopProofs } from '../../db/schema';
import { authHonoSessionService } from './session-adapter';
import { remoteCounter, remoteRawHash } from './remote-contract';
import type { RemoteLogin } from './remote-evidence';

const signedLogin = z.object({
  mfaVerified: z.boolean(), authTime: remoteCounter, sessionVersion: remoteCounter,
}).strict();

// Invoke only in the standalone issuer workload with its separate session-signing secret.
export async function resolveRemoteLogin(credential: string): Promise<RemoteLogin | null> {
  const validated = await authHonoSessionService.validateSessionToken(credential);
  if (!validated) return null;
  const payload = decodeJwt(credential); // Signature/current credential hash already verified above.
  const parsed = signedLogin.safeParse(payload.login);
  if (!parsed.success) return null;
  const login = parsed.data;
  const record = validated.sessionRecord;
  if (!login.mfaVerified || !record.mfaVerified || login.sessionVersion !== record.createdAt.getTime()
    || login.authTime !== Math.floor(record.createdAt.getTime() / 1000)
    || typeof payload.exp !== 'number') return null;
  return {
    sub: record.userId, sid: record.id, sessionVersion: login.sessionVersion, authTime: login.authTime,
    amr: ['hwk', 'user', 'mfa'], expiresAt: Math.min(record.expiresAt.getTime(), payload.exp * 1000),
  };
}

export async function reserveRemoteEvidence(sid: string, actionId: string, expiresAt: Date): Promise<boolean> {
  // Reuse the existing unique, expiring proof-fence table under a disjoint namespace.
  // No credential, proof bytes or nonce bytes are stored here.
  const jti = `remote-evidence:${remoteRawHash(JSON.stringify([sid, actionId]))}`;
  const rows = await db.insert(oauthDpopProofs).values({ jti, createdAt: new Date(), expiresAt })
    .onConflictDoNothing().returning({ jti: oauthDpopProofs.jti });
  return rows.length === 1;
}
