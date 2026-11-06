import type { AuthHonoInvitesPort } from '@sentropic/auth-hono';
import { createHash } from 'node:crypto';

import {
  consumeCmInvitationByTokenHash,
  findCmInvitationByTokenHash,
} from '../identity/cm-proofs';

/**
 * BR-39r L4 — single-use invitation-token store (`AuthHonoInvitesPort`).
 *
 * Lot A4: persistence moved to the cluster-mesh identity custody store
 * (`cm_identity.identity_invitation_digests`). The opaque `sit_`-prefixed token is
 * NEVER stored; only its SHA-256 digest is persisted (hash-at-rest, same encoding as
 * the legacy `auth_invite_tokens.token_hash`, so migrated rows stay readable).
 * `consume` is a compare-and-swap on the digest row (`consumeByDigest` with the
 * expected revision), so under concurrency EXACTLY ONE caller wins and receives the
 * bound email; every other caller (and every invalid/expired/already-consumed token)
 * gets `null`. The caller collapses all `null` outcomes into the C3 generic fallback
 * (no account-enumeration signal).
 */

export const hashInviteToken = (token: string): string =>
  createHash('sha256').update(token).digest('hex');

export const createInviteStoreAdapter = (): AuthHonoInvitesPort => ({
  async findValid(tokenHash, now) {
    const row = await findCmInvitationByTokenHash(tokenHash);
    if (!row || row.status !== 'pending' || row.expiresAt <= now) return null;
    return { clientId: row.clientId, email: row.email };
  },

  async consume(tokenHash, now, userId) {
    const existing = await findCmInvitationByTokenHash(tokenHash);
    if (!existing || existing.status !== 'pending' || existing.expiresAt <= now) return null;
    // Single atomic CAS: only the row that is still pending at the expected revision
    // mutates, and only the winning consume returns the row. No read-then-write race.
    const consumed = await consumeCmInvitationByTokenHash(tokenHash, existing.email, userId, now);
    return consumed ? { email: consumed.email } : null;
  },
});
