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

export const PASSKEY_FRESH_ACR = 'urn:sentropic:loa:passkey-fresh';
export const BEARER_ACR = 'urn:sentropic:loa:bearer';

export const resolveOAuthAcr = (session: AuthHonoSessionRecord): string =>
  session.mfaVerified ? PASSKEY_FRESH_ACR : BEARER_ACR;

/**
 * B2: RFC 8176 `amr` values derived from the session. A passkey ceremony with
 * user verification is a hardware-backed multi-factor event; any other session
 * (magic-link, federation) is a single-factor bearer event.
 */
export const resolveOAuthAmr = (session: AuthHonoSessionRecord): string[] =>
  session.mfaVerified ? ['hwk', 'user', 'mfa'] : ['pwd'];
