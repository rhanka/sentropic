import type { OauthClientRecord } from './state-store-types.js';

/** RFC 8252 §7.3 loopback IP literals (`localhost` is §8.3 NOT RECOMMENDED and stays exact-match). */
const LOOPBACK_IP_AUTHORITIES: ReadonlySet<string> = new Set(['127.0.0.1', '[::1]']);

/**
 * True for a native-app loopback redirect REGISTERED WITHOUT A PORT (`http://127.0.0.1/callback`,
 * `http://[::1]/callback`). The raw authority is checked so `:80` never counts as port-less.
 */
export const isPortlessLoopbackRedirectUri = (uri: string): boolean => {
  const authority = /^http:\/\/([^/?#]*)/u.exec(uri)?.[1];
  return authority !== undefined && LOOPBACK_IP_AUTHORITIES.has(authority);
};

/**
 * Registered redirect match: exact string match, or RFC 8252 §7.3 — for a registered port-less
 * loopback IP URI, any port is accepted at request time. Scheme, host, path and query stay exact
 * (the request must equal the registered URI with only `:<port>` inserted).
 */
export const matchesRegisteredRedirectUri = (registered: readonly string[], requested: string): boolean => {
  if (registered.includes(requested)) return true;
  let port: string;
  try {
    port = new URL(requested).port;
  } catch {
    return false;
  }
  if (!port) return false;
  return registered.some((entry) => isPortlessLoopbackRedirectUri(entry) &&
    entry.replace(/^(http:\/\/(?:127\.0\.0\.1|\[::1\]))/u, `$1:${port}`) === requested);
};

/**
 * Validate a redirect-style URI against a client's REGISTERED redirect URIs using the OAuth
 * authorize guards: registered match (exact, or any port for a port-less loopback IP entry),
 * absolute URI, no fragment, no credentials, https (or http for loopback callbacks).
 * Returns an error message string on failure, or `null` when the URI is valid.
 *
 * Shared by the `authorize` handler (callback `redirect_uri`) and the `end_session` handler
 * (RP-Initiated Logout `post_logout_redirect_uri`, C1). Reusing `redirectUris` keeps C1's
 * "REGISTERED redirect URIs" requirement additive-minimal (no schema migration).
 */
export const validateRedirectUri = (client: OauthClientRecord, redirectUri: string): string | null => {
  if (!matchesRegisteredRedirectUri(client.redirectUris, redirectUri)) {
    return 'redirect_uri is not registered for this client.';
  }

  let parsed: URL;
  try {
    parsed = new URL(redirectUri);
  } catch {
    return 'redirect_uri must be an absolute URI.';
  }

  if (parsed.hash) return 'redirect_uri must not contain a fragment.';
  if (parsed.username || parsed.password) return 'redirect_uri must not contain credentials.';
  if (parsed.protocol === 'https:') return null;
  if (parsed.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname)) return null;
  return 'redirect_uri must use https except for loopback callbacks.';
};
