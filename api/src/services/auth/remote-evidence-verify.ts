import type { KeyObject } from 'node:crypto';
import { jwtVerify } from 'jose';
import { z } from 'zod';
import { RemoteAuthorityError, parseRemoteJson, remoteActionId, remoteCounter, remoteEvidenceRequestSchema,
  remoteHash, remoteId, remoteOperation, requireRemoteDeadline } from './remote-contract';
import type { RemoteLogin } from './remote-evidence';
import { remoteCanonicalJson } from './remote-json';

const claims = z.object({
  iss: remoteId, sub: remoteId, sid: remoteId, sessionVersion: remoteCounter,
  tenantId: remoteId, workspaceId: remoteId, auth_time: remoteCounter, amr: z.array(remoteId).min(1).max(16),
  aud: remoteId, iat: remoteCounter, exp: remoteCounter, jti: remoteActionId, actionId: remoteActionId,
  targetDigest: remoteHash, operation: remoteOperation, payloadDigest: remoteHash, nonceId: remoteId,
}).strict();
export interface RemoteEvidenceTrust {
  key: KeyObject; issuer: string; kid: string; audience: string; tenantId: string; workspaceId: string;
  now: number; request: unknown; login: RemoteLogin;
}
export async function verifyRemoteEvidence(evidence: string, trust: RemoteEvidenceTrust) {
  try {
    if (Buffer.byteLength(evidence) > 8192 || trust.key.type !== 'public'
      || trust.key.asymmetricKeyType !== 'ed25519') throw new Error();
    const parts = evidence.split('.');
    if (parts.length !== 3 || parts.some((part) => !/^[A-Za-z0-9_-]+$/.test(part)
      || Buffer.from(part, 'base64url').toString('base64url') !== part)) throw new Error();
    const header = z.object({ alg: z.literal('EdDSA'), kid: z.literal(trust.kid) }).strict()
      .parse(parseRemoteJson(Buffer.from(parts[0], 'base64url')));
    const payload = claims.parse(parseRemoteJson(Buffer.from(parts[1], 'base64url')));
    await jwtVerify(evidence, trust.key, { algorithms: [header.alg], issuer: trust.issuer,
      audience: trust.audience, currentDate: new Date(trust.now), clockTolerance: 0 });
    const request = remoteEvidenceRequestSchema.parse(trust.request);
    const expected = { iss: trust.issuer, sub: trust.login.sub, sid: trust.login.sid,
      sessionVersion: trust.login.sessionVersion, tenantId: trust.tenantId, workspaceId: trust.workspaceId,
      auth_time: trust.login.authTime, amr: trust.login.amr, aud: trust.audience,
      actionId: request.actionId, targetDigest: request.targetDigest, operation: request.operation,
      payloadDigest: request.payloadDigest, nonceId: request.nonceId };
    for (const key of Object.keys(expected) as Array<keyof typeof expected>) {
      if (remoteCanonicalJson(payload[key]) !== remoteCanonicalJson(expected[key])) throw new Error();
    }
    if (request.sid !== payload.sid || request.sessionVersion !== payload.sessionVersion
      || !['hwk', 'user', 'mfa'].every((method) => payload.amr.includes(method))
      || payload.auth_time > payload.iat || trust.login.expiresAt <= trust.now + 5000) throw new Error();
    requireRemoteDeadline(payload.iat * 1000, payload.exp * 1000, trust.now);
    return payload;
  } catch (error) {
    if (error instanceof RemoteAuthorityError) throw error;
    throw new RemoteAuthorityError('authority_refused');
  }
}
