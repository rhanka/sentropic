import { GitHub } from 'arctic';

import type { FederationProvider, FederationProviderIdentity } from './types';

/**
 * BR-39e Lot 2 — GitHub provider (OAuth2 only — GitHub issues NO OIDC id_token, per-provider matrix §4).
 *
 * `arctic` supplies the typed RP layer (authorization-URL builder + code→access-token exchange). GitHub
 * has no id_token, so there is no nonce/JWKS step: after the exchange the provider fetches the account
 * (`GET /user`) and the emails (`GET /user/emails`) with the access token to derive the identity —
 * `subject` = the STABLE numeric account id (D6), `email`/`emailVerified` = the PRIMARY email row.
 *
 * D1 (no-leak): the access token is used ONLY inside `verifyCallback` (the two REST calls) and is then
 * dropped — it never reaches the broker, the minted session, or the browser.
 *
 * D8/D9 consequences (enforced downstream in the broker/resolver, not here):
 *  - GitHub is NEVER on the auto-link allowlist → a verified-email collision routes to manual-link.
 *  - A private / unverified / absent primary email yields `{ email: null | <addr>, emailVerified: false }`
 *    → the resolver returns `email-challenge-required` (no silent no-email user).
 */

const GITHUB_API = 'https://api.github.com';
// GitHub REST requires a User-Agent header on every request; `user:email` grants `GET /user/emails`.
const GITHUB_USER_AGENT = 'sentropic-auth-idp';
const GITHUB_SCOPES = ['read:user', 'user:email'];

export interface GithubProviderConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  /** Injectable for tests; defaults to the global `fetch`. NEVER used to reach anything but GitHub. */
  fetchImpl?: typeof fetch;
}

interface GithubUserResponse {
  id: number;
  login?: string;
}

interface GithubEmailResponse {
  email: string;
  primary: boolean;
  verified: boolean;
  visibility: string | null;
}

const githubHeaders = (accessToken: string): Record<string, string> => ({
  Accept: 'application/vnd.github+json',
  Authorization: `Bearer ${accessToken}`,
  'User-Agent': GITHUB_USER_AGENT,
  'X-GitHub-Api-Version': '2022-11-28',
});

/**
 * Pure identity derivation from the two GitHub REST endpoints (unit-tested with a fake `fetch`).
 * `subject` is the numeric account id as a string (stable across email/username changes, D6/D13). The
 * email is the PRIMARY row; `emailVerified` is that row's `verified` flag. No primary / no rows ⇒
 * `{ email: null, emailVerified: false }`, which the resolver turns into an email challenge (D9).
 */
export async function fetchGithubIdentity(
  fetchImpl: typeof fetch,
  accessToken: string,
): Promise<FederationProviderIdentity> {
  const headers = githubHeaders(accessToken);

  const userRes = await fetchImpl(`${GITHUB_API}/user`, { headers });
  if (!userRes.ok) {
    throw new Error(`GitHub /user request failed with status ${userRes.status}.`);
  }
  const user = (await userRes.json()) as GithubUserResponse;
  if (typeof user.id !== 'number') {
    throw new Error('GitHub /user response is missing the numeric account id.');
  }
  const subject = String(user.id);

  const emailsRes = await fetchImpl(`${GITHUB_API}/user/emails`, { headers });
  if (!emailsRes.ok) {
    throw new Error(`GitHub /user/emails request failed with status ${emailsRes.status}.`);
  }
  const emails = (await emailsRes.json()) as GithubEmailResponse[];
  const primary = Array.isArray(emails) ? emails.find((entry) => entry.primary) ?? null : null;

  return {
    email: primary?.email ?? null,
    emailVerified: primary?.verified === true,
    subject,
  };
}

export const createGithubProvider = (config: GithubProviderConfig): FederationProvider => {
  const github = new GitHub(config.clientId, config.clientSecret, config.redirectUri);
  const fetchImpl = config.fetchImpl ?? fetch;

  return {
    id: 'github',

    createAuthorizationUrl({ state }) {
      // GitHub OAuth2 has no OIDC nonce and arctic's GitHub client takes no PKCE verifier; only the
      // CSRF `state` and the scopes travel upstream. The broker still binds state server-side (K-STATE).
      const url = github.createAuthorizationURL(state, GITHUB_SCOPES);
      return url.toString();
    },

    async verifyCallback({ code }): Promise<FederationProviderIdentity> {
      // Exchange the code for a GitHub access token directly from GitHub's token endpoint (TLS).
      const tokens = await github.validateAuthorizationCode(code);
      const accessToken = tokens.accessToken();

      // The access token is used ONLY for these two REST calls, then dropped (D1 no-leak).
      return fetchGithubIdentity(fetchImpl, accessToken);
    },
  };
};
