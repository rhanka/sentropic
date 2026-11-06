import { IdentityCustodyErrorV1 } from '@sentropic/cluster-mesh';
import type { CmIdentityTransaction } from './cm-transaction';

export interface CmSelfDeletionContinuation {
  readonly userId: string;
  readonly sessionId: string;
  readonly credentialHash: string;
  readonly disabledAt: string;
}
export const cmSelfDeletionProofId = (userId: string, hash: string) => `self-delete:${userId}:${hash}`;

/** The caller holds the subject lock; stale credentials refuse before any mutation. */
export async function recordCmSelfDeletion(tx: CmIdentityTransaction, userId: string,
  sessionId: string, credentialHash: string, at: string): Promise<void> {
  const session = await tx.custody.sessions.findById(sessionId);
  if (!session || session.userId !== userId || session.sessionTokenHash !== credentialHash
    || session.revokedAt || session.expiresAt <= at) throw new IdentityCustodyErrorV1('login_binding_mismatch');
  await tx.hostTransaction.query(`INSERT INTO public.oauth_dpop_proofs (jti, created_at, expires_at)
    VALUES ($1, $2, $3) ON CONFLICT (jti) DO UPDATE SET created_at = EXCLUDED.created_at, expires_at = EXCLUDED.expires_at`,
  [cmSelfDeletionProofId(userId, credentialHash), at,
    new Date(Math.min(Date.parse(session.expiresAt), Date.parse(at) + 300_000)).toISOString()]);
}

/** Used both at HTTP admission and by each locked V2 authorization phase. */
export async function resolveCmSelfDeletion(tx: CmIdentityTransaction,
  input: Omit<CmSelfDeletionContinuation, 'disabledAt'> & { readonly disabledAt?: string }): Promise<CmSelfDeletionContinuation | null> {
  const account = await tx.stores.accounts.findAccount(input.userId);
  const profile = await tx.custody.profiles.find(input.userId);
  const session = await tx.custody.sessions.findById(input.sessionId);
  if (account?.accountStatus !== 'disabled' || profile?.legacyAccountStatus !== 'disabled_by_user'
    || profile.disabledReason !== 'user_deactivated' || !profile.disabledAt
    || (input.disabledAt !== undefined && input.disabledAt !== profile.disabledAt)
    || session?.userId !== input.userId || session.sessionTokenHash !== input.credentialHash || !session.revokedAt) return null;
  const proof = await tx.hostTransaction.query(`SELECT 1 FROM public.oauth_dpop_proofs
    WHERE jti = $1 AND created_at = $2::timestamptz AT TIME ZONE 'UTC'
      AND expires_at > clock_timestamp() AT TIME ZONE 'UTC'`,
  [cmSelfDeletionProofId(input.userId, input.credentialHash), profile.disabledAt]);
  return proof.rows.length ? { ...input, disabledAt: profile.disabledAt } : null;
}
