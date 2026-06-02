import type {
  AuthHonoPorts,
  AuthHonoSessionClaims,
  AuthHonoSessionRecord,
  AuthHonoUserRecord,
} from '../ports.js';

export interface OAuthResolvedSession {
  claims: AuthHonoSessionClaims;
  sessionRecord: AuthHonoSessionRecord;
  user: AuthHonoUserRecord;
}

export const resolveOAuthSession = async (
  request: Request,
  ports: AuthHonoPorts
): Promise<OAuthResolvedSession | null> => {
  const token = ports.cookies.readSessionToken(request);
  if (!token) return null;

  const claims = await ports.tokens.verifySessionToken(token);
  if (!claims) return null;

  const tokenHash = await ports.tokens.hashSecret(token);
  const sessionRecord = await ports.sessions.findByTokenHash(tokenHash);
  const now = ports.clock.now();
  if (
    !sessionRecord ||
    sessionRecord.id !== claims.sessionId ||
    sessionRecord.userId !== claims.userId ||
    sessionRecord.revokedAt ||
    sessionRecord.expiresAt <= now
  ) {
    return null;
  }

  const user = await ports.users.findById(claims.userId);
  if (!user) return null;

  const decision = await ports.accountPolicy.canAuthenticate(user, now);
  if (!decision.allowed) return null;

  await ports.sessions.touch(sessionRecord.id, now);
  return { claims, sessionRecord, user };
};

export const resolveOAuthAcr = (session: AuthHonoSessionRecord): string =>
  session.mfaVerified ? 'urn:sentropic:loa:passkey-fresh' : 'urn:sentropic:loa:bearer';
