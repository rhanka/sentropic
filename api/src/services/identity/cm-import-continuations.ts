import { createHash } from 'node:crypto';
import type { DigestInvitationV1, EmailRegistrationTicketV1, IdentityEmailTicketTokenPortV1,
  SocialIdentityV1 } from '@sentropic/cluster-mesh';
import { invalidA4Import, sourceBoolean as bool, sourceDigest as digest, sourceNullableText as nullable,
  sourceNullableTime as nullableTime, sourceText as text, sourceTime as time, type A4SourceRow } from './cm-import-values';

export const mapA4Invitation = (row: A4SourceRow): DigestInvitationV1 => ({
  invitationId: text(row.id), email: text(row.email).trim().toLowerCase(), clientId: nullable(row.client_id),
  tokenHash: digest(row.token_hash), status: row.consumed_at === null ? 'pending' : 'consumed',
  expiresAt: time(row.expires_at), createdAt: time(row.created_at), consumedAt: nullableTime(row.consumed_at),
  consumedByUserId: nullable(row.consumed_by_user_id), revision: 0,
});

export async function mapA4EmailTicket(row: A4SourceRow, verifier: IdentityEmailTicketTokenPortV1): Promise<EmailRegistrationTicketV1 | null> {
  if (row.verification_token === null) return null;
  if (!bool(row.used)) return invalidA4Import();
  const bytes = new TextEncoder().encode(text(row.verification_token));
  try {
    const claims = await verifier.verifyForImport(bytes);
    if (claims.codeProofId !== row.id || claims.email !== text(row.email).trim().toLowerCase()) return invalidA4Import();
    return { codeProofId: text(row.id), email: claims.email,
      tokenHash: createHash('sha256').update(bytes).digest('hex'), userId: null, state: 'pending', revision: 0,
      createdAt: claims.issuedAt, expiresAt: claims.expiresAt, consumedAt: null, revokedAt: null };
  } finally { bytes.fill(0); }
}

export function mapA4Social(row: A4SourceRow): SocialIdentityV1 {
  if (row.token_secret !== null) return invalidA4Import();
  return { proofId: text(row.id), userId: text(row.user_id), provider: text(row.provider),
    providerSubject: text(row.provider_subject), providerTenant: nullable(row.provider_tenant),
    emailAtLink: nullable(row.email_at_link), emailVerifiedByProvider: bool(row.email_verified_by_provider),
    linkedAt: time(row.linked_at), lastLoginAt: nullableTime(row.last_login_at), revokedAt: null, revision: 0 };
}
