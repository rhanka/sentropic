import type { DigestInvitationV1, SocialIdentityV1 } from '@sentropic/cluster-mesh';
import { invalidA4Import, sourceBoolean as bool, sourceDigest as digest, sourceNullableText as nullable,
  sourceNullableTime as nullableTime, sourceText as text, sourceTime as time, type A4SourceRow } from './cm-import-values';

export const mapA4Invitation = (row: A4SourceRow): DigestInvitationV1 => ({
  invitationId: text(row.id), email: text(row.email).trim().toLowerCase(), clientId: nullable(row.client_id),
  tenantId: null, workspaceId: null,
  tokenHash: digest(row.token_hash), status: row.consumed_at === null ? 'pending' : 'consumed',
  expiresAt: time(row.expires_at), createdAt: time(row.created_at), consumedAt: nullableTime(row.consumed_at),
  consumedByUserId: nullable(row.consumed_by_user_id), revision: 0,
});

/** Counts only, never source tokens or fingerprints. The protected checkpoint
 * retains history; users request a fresh code and log in after every cutover. */
export function a4InvalidatedProofCounts(rows: ReadonlyMap<string, readonly A4SourceRow[]>) {
  const each = (table: string) => rows.get(table) ?? invalidA4Import();
  return { webauthn_challenge: each('webauthn_challenges').length,
    email_code: each('email_verification_codes').length,
    email_ticket: each('email_verification_codes').filter(row => nullable(row.verification_token) !== null).length,
    magic_link: each('magic_links').length,
    login_session: each('user_sessions').length,
    login_refresh_token: each('user_sessions').filter(row => nullable(row.refresh_token_hash) !== null).length };
}

export function mapA4Social(row: A4SourceRow): SocialIdentityV1 {
  if (row.token_secret !== null) return invalidA4Import();
  return { proofId: text(row.id), userId: text(row.user_id), provider: text(row.provider),
    providerSubject: text(row.provider_subject), providerTenant: nullable(row.provider_tenant),
    emailAtLink: nullable(row.email_at_link), emailVerifiedByProvider: bool(row.email_verified_by_provider),
    linkedAt: time(row.linked_at), lastLoginAt: nullableTime(row.last_login_at), revokedAt: null, revision: 0 };
}
