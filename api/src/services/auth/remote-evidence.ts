import { randomBytes, sign, type KeyObject } from 'node:crypto';
import { z } from 'zod';
import { RemoteAuthorityError, remoteCounter, remoteEvidenceRequestSchema, remoteId,
  requireRemoteDeadline, requireRemoteVersion, type RemoteEvidenceRequest } from './remote-contract';
import { remoteCanonicalJson } from './remote-json';
export { verifyRemoteEvidence } from './remote-evidence-verify';

export const remoteLoginSchema = z.object({
  sub: remoteId, sid: remoteId, sessionVersion: remoteCounter, authTime: remoteCounter,
  amr: z.array(remoteId).min(1).max(16), expiresAt: remoteCounter,
}).strict();
export type RemoteLogin = z.infer<typeof remoteLoginSchema>;
export interface RemoteApprovedTarget { audience: string; tenantId: string; workspaceId: string }
export interface RemoteEvidenceIssuerPorts {
  issuer: string; kid: string; key: KeyObject; now(): number;
  session(credential: string): Promise<RemoteLogin | null>;
  approvedTarget(digest: string, actor: RemoteLogin): Promise<RemoteApprovedTarget | null>;
  reserve(sid: string, actionId: string, expiresAt: Date): Promise<boolean>;
  commit(login: RemoteLogin, request: RemoteEvidenceRequest, operation: () => string): string;
}
export function createRemoteEvidenceIssuer(ports: RemoteEvidenceIssuerPorts) {
  let lastNow = -1;
  const readNow = () => {
    const now = ports.now();
    if (!Number.isSafeInteger(now) || now < 0 || now < lastNow)
      throw new RemoteAuthorityError('authority_unavailable');
    lastNow = now;
    return now;
  };
  return async (input: unknown): Promise<string> => {
    requireRemoteVersion(input);
    const parsed = remoteEvidenceRequestSchema.safeParse(input);
    if (!parsed.success) throw new RemoteAuthorityError('invalid_request');
    const request = parsed.data;
    const now = readNow();
    const current = remoteLoginSchema.safeParse(await ports.session(request.sessionCredential));
    if (!current.success) throw new RemoteAuthorityError('authentication_required');
    const login = current.data;
    if (login.sid !== request.sid || login.sessionVersion !== request.sessionVersion
      || login.expiresAt <= now + 5000 || login.authTime * 1000 > now
      || !['hwk', 'user', 'mfa'].every((method) => login.amr.includes(method)))
      throw new RemoteAuthorityError('authentication_required');
    const approved = await ports.approvedTarget(request.targetDigest, login);
    if (!approved || ![approved.audience, approved.tenantId, approved.workspaceId]
      .every((id) => remoteId.safeParse(id).success)) throw new RemoteAuthorityError('authority_refused');
    if (ports.key.type !== 'private' || ports.key.asymmetricKeyType !== 'ed25519'
      || !remoteId.safeParse(ports.issuer).success || !remoteId.safeParse(ports.kid).success)
      throw new RemoteAuthorityError('authority_unavailable');
    const iat = Math.floor(now / 1000);
    const exp = Math.min(iat + 60, Math.floor(login.expiresAt / 1000));
    requireRemoteDeadline(iat * 1000, exp * 1000, now);
    // This namespace is independent of native jti/nonce consumption and K-app dedup.
    if (!await ports.reserve(login.sid, request.actionId, new Date(now + 90 * 86_400_000)))
      throw new RemoteAuthorityError('replay_refused');
    const refreshed = remoteLoginSchema.safeParse(await ports.session(request.sessionCredential));
    if (!refreshed.success || remoteCanonicalJson(refreshed.data) !== remoteCanonicalJson(login))
      throw new RemoteAuthorityError('authentication_required');
    return ports.commit(login, request, () => {
      requireRemoteDeadline(iat * 1000, exp * 1000, readNow());
      const claims = {
      iss: ports.issuer, sub: login.sub, sid: login.sid, sessionVersion: login.sessionVersion,
      tenantId: approved.tenantId, workspaceId: approved.workspaceId, auth_time: login.authTime,
      amr: login.amr, aud: approved.audience, iat, exp, jti: randomBytes(16).toString('base64url'),
      actionId: request.actionId, targetDigest: request.targetDigest, operation: request.operation,
      payloadDigest: request.payloadDigest, nonceId: request.nonceId,
      };
      const header = Buffer.from(JSON.stringify({ alg: 'EdDSA', kid: ports.kid })).toString('base64url');
      const payload = Buffer.from(JSON.stringify(claims)).toString('base64url');
      const input = `${header}.${payload}`;
      return `${input}.${sign(null, Buffer.from(input), ports.key).toString('base64url')}`;
    });
  };
}
