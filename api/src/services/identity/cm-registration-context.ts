import type { OAuthContinuationCodec } from '@sentropic/auth-hono';
import { IdentityCustodyErrorV1 } from '@sentropic/cluster-mesh';

export interface CmRegistrationPresentation {
  readonly email: string;
  readonly verificationToken?: string;
  readonly oauthContinuation?: string;
}
interface ContextInput {
  readonly presentation: CmRegistrationPresentation;
  readonly email: string;
  readonly now: Date;
  readonly continuationCodec: OAuthContinuationCodec;
  readonly digest: { sha256(bytes: Uint8Array): Promise<string> };
  readonly invitations: { findByDigest(digest: string): Promise<{ email: string; clientId: string | null } | null> };
  readonly ticketTokens: { verify(bytes: Uint8Array, at: string): Promise<{ email: string }> };
}

/** Only stored proof bindings and verified continuation claims establish trusted context. */
export async function resolveCmRegistrationContext(input: ContextInput) {
  const { presentation, email, now } = input, token = presentation.verificationToken;
  if (!token) return null;
  const bytes = new TextEncoder().encode(token);
  try {
    if (token.startsWith('sit_')) {
      const invitation = await input.invitations.findByDigest(await input.digest.sha256(bytes));
      if (!invitation || invitation.email !== email) return null;
      if (invitation.clientId === null) return { email, clientId: null };
      if (!presentation.oauthContinuation) return null;
      const state = await Promise.resolve().then(() => input.continuationCodec.unseal(presentation.oauthContinuation!))
        .catch(() => null);
      if (!state || state.clientId !== invitation.clientId || typeof state.expiresAt !== 'string' ||
        !(Date.parse(state.expiresAt) > now.getTime())) return null;
      return { email, clientId: state.clientId };
    }
    const claims = await input.ticketTokens.verify(bytes, now.toISOString());
    return claims.email === email ? { email, clientId: null } : null;
  } catch (error) {
    if (error instanceof IdentityCustodyErrorV1 && error.code === 'proof_binding_mismatch') return null;
    throw error;
  } finally { bytes.fill(0); }
}
