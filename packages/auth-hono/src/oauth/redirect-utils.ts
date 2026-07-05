import type { OauthClientRecord } from './state-store-types.js';

/**
 * Validate a redirect-style URI against a client's REGISTERED redirect URIs using the OAuth
 * authorize guards: exact-match in `client.redirectUris`, absolute URI, no fragment, no
 * credentials, https (or http for localhost dev). Returns an error message string on failure,
 * or `null` when the URI is valid.
 *
 * Shared by the `authorize` handler (callback `redirect_uri`) and the `end_session` handler
 * (RP-Initiated Logout `post_logout_redirect_uri`, C1). Reusing `redirectUris` keeps C1's
 * "REGISTERED redirect URIs" requirement additive-minimal (no schema migration).
 */
export const validateRedirectUri = (client: OauthClientRecord, redirectUri: string): string | null => {
  if (!client.redirectUris.includes(redirectUri)) return 'redirect_uri is not registered for this client.';

  let parsed: URL;
  try {
    parsed = new URL(redirectUri);
  } catch {
    return 'redirect_uri must be an absolute URI.';
  }

  if (parsed.hash) return 'redirect_uri must not contain a fragment.';
  if (parsed.username || parsed.password) return 'redirect_uri must not contain credentials.';
  if (parsed.protocol === 'https:') return null;
  if (parsed.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(parsed.hostname)) return null;
  return 'redirect_uri must use https except for localhost development callbacks.';
};
