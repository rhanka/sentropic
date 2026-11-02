import { decodeJwt } from 'jose';
import { z } from 'zod';
import { db } from '../../db/client';
import { oauthDpopProofs } from '../../db/schema';
import type { IdentityAuthHonoTransactionBindingV1 } from '@sentropic/cluster-mesh';
import { withAppCmAuth } from '../identity/cm-auth-runtime';
import { RemoteAuthorityError, remoteCounter, remoteRawHash, remoteEvidenceRequestSchema, type RemoteEvidenceRequest } from './remote-contract';
import type { RemoteLogin } from './remote-evidence';
import { remoteCanonicalJson } from './remote-json';

const signedLogin = z.object({
  mfaVerified: z.boolean(), authTime: remoteCounter, sessionVersion: remoteCounter,
}).strict();

// Invoke only in the standalone issuer workload with its separate session-signing secret.
async function readRemoteLogin(binding: IdentityAuthHonoTransactionBindingV1, credential: string): Promise<RemoteLogin | null> {
  const validated = await binding.sessions.validateSessionToken(credential);
  if (!validated) return null;
  const payload = decodeJwt(credential); // Signature/current credential hash already verified above.
  const parsed = signedLogin.safeParse(payload.login);
  if (!parsed.success) return null;
  const login = parsed.data;
  const record = validated.sessionRecord;
  if (record.userId !== payload.userId || record.id !== payload.sessionId
    || record.userId !== validated.session.userId
    || !login.mfaVerified || !record.mfaVerified || login.sessionVersion !== record.createdAt.getTime()
    || login.authTime !== Math.floor(record.createdAt.getTime() / 1000)
    || typeof payload.exp !== 'number') return null;
  return {
    sub: record.userId, sid: record.id, sessionVersion: login.sessionVersion, authTime: login.authTime,
    amr: ['hwk', 'user', 'mfa'], expiresAt: Math.min(record.expiresAt.getTime(), payload.exp * 1000),
  };
}

export const resolveRemoteLogin = (credential: string): Promise<RemoteLogin | null> =>
  withAppCmAuth(async runner => {
    const result = await runner.complete('session_validate', binding => readRemoteLogin(binding, credential));
    return result.committed ? result.value : null;
  });

export async function reserveRemoteEvidence(sid: string, actionId: string, expiresAt: Date): Promise<boolean> {
  // Reuse the existing unique, expiring proof-fence table under a disjoint namespace.
  // No credential, proof bytes or nonce bytes are stored here.
  const jti = `remote-evidence:${remoteRawHash(JSON.stringify([sid, actionId]))}`;
  const rows = await db.insert(oauthDpopProofs).values({ jti, createdAt: new Date(), expiresAt })
    .onConflictDoNothing().returning({ jti: oauthDpopProofs.jti });
  return rows.length === 1;
}

export async function commitRemoteEvidence(login: RemoteLogin, input: RemoteEvidenceRequest, operation: () => string): Promise<string> {
  if (process.env.REMOTE_ACTION_ROLE !== 'auth-idp') throw new RemoteAuthorityError('authority_unavailable');
  try {
    return await withAppCmAuth(runner => runner.request(async (binding, tx) => {
      const parsed = remoteEvidenceRequestSchema.safeParse(input);
      if (!parsed.success) throw new RemoteAuthorityError('invalid_request');
      const request = parsed.data;
      const verified = await binding.ports.tokens.verifySessionToken(request.sessionCredential);
      if (!verified) throw new RemoteAuthorityError('authentication_required');
      await tx.lockSubject(verified.userId);
      const current = await readRemoteLogin(binding, request.sessionCredential);
      if (!current || current.sid !== request.sid || current.sessionVersion !== request.sessionVersion
        || current.expiresAt <= Date.now() + 5000 || remoteCanonicalJson(current) !== remoteCanonicalJson(login)) {
        throw new RemoteAuthorityError('authentication_required');
      }
      // Local signing stays under the same CM subject fence as refresh/revoke/delete.
      // A retry discards this signature; only the acknowledged commit releases it.
      return operation();
    }));
  } catch (error) {
    if (error instanceof RemoteAuthorityError) throw error;
    throw new RemoteAuthorityError('authority_unavailable');
  }
}
