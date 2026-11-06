import type { Context, Next } from 'hono';
import { requireAuth } from '../../middleware/auth';
import { withAppCmAuth } from './cm-auth-runtime';
import type { CmIdentityTransaction } from './cm-transaction';

const continuationId = (userId: string, hash: string) => `self-delete:${userId}:${hash}`;

/** A deactivation authorizes only its initiating credential to finish deletion. */
export async function recordCmSelfDeletion(tx: CmIdentityTransaction, userId: string,
  sessionId: string, at: string): Promise<void> {
  const session = await tx.custody.sessions.findById(sessionId);
  if (!session || session.userId !== userId) return;
  await tx.hostTransaction.query(`INSERT INTO public.oauth_dpop_proofs (jti, created_at, expires_at)
    VALUES ($1, $2, $3) ON CONFLICT (jti) DO UPDATE SET created_at = EXCLUDED.created_at, expires_at = EXCLUDED.expires_at`,
  [continuationId(userId, session.sessionTokenHash), at,
    new Date(Math.min(Date.parse(session.expiresAt), Date.parse(at) + 300_000)).toISOString()]);
}

/** This middleware is installed only on the account DELETE projection. */
export async function requireCmAccountAuth(c: Context, next: Next) {
  if (c.req.method !== 'DELETE') return requireAuth(c, next);
  let principal: { userId: string; sessionId: string } | null;
  try {
    principal = await withAppCmAuth(runner => runner.authenticate(async (binding, tx) => {
      const bearer = /^Bearer\s+(.+)$/i.exec(c.req.header('authorization') ?? '')?.[1]?.trim();
      const token = bearer || binding.ports.cookies.readSessionToken(c.req.raw);
      if (!token) return null;
      const claims = await binding.ports.tokens.verifySessionToken(token);
      if (!claims) return null;
      const account = await tx.stores.accounts.findAccount(claims.userId);
      const profile = await tx.custody.profiles.find(claims.userId);
      const session = await tx.custody.sessions.findById(claims.sessionId);
      const hash = await binding.ports.tokens.hashSecret(token);
      if (account?.accountStatus !== 'disabled' || profile?.legacyAccountStatus !== 'disabled_by_user'
        || profile.disabledReason !== 'user_deactivated' || !profile.disabledAt
        || session?.userId !== claims.userId || session.sessionTokenHash !== hash || !session.revokedAt) return null;
      const proof = await tx.hostTransaction.query(`SELECT 1 FROM public.oauth_dpop_proofs
        WHERE jti = $1 AND created_at = $2::timestamptz AT TIME ZONE 'UTC'
          AND expires_at > clock_timestamp() AT TIME ZONE 'UTC'`,
      [continuationId(claims.userId, hash), profile.disabledAt]);
      return proof.rows.length ? { userId: claims.userId, sessionId: claims.sessionId } : null;
    }));
  } catch {
    return c.json({ error: 'Authentication unavailable' }, 503);
  }
  if (!principal) return requireAuth(c, next);
  c.set('user', { ...principal, role: 'guest', workspaceId: '' });
  return next();
}
