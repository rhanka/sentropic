#!/usr/bin/env tsx
//
// BR-39 deploy (D7-a) — PROD-SAFE OIDC client registration.
//
// This is NOT the dev seed (`oauth-seed-clients.ts`), which bakes well-known
// dev-only secrets and localhost redirect URIs and MUST NEVER run in prod. This
// script registers ONE `oauth_clients` row, fully env-driven, with an idempotent
// upsert keyed on `client_id`. Re-running it is safe (it updates in place).
//
// Intended as a one-off post-deploy step (a kubectl Job or `npm run
// oauth:register-client`) run AGAINST the prod DB, after the IdP is deployed.
//
// Required env:
//   OAUTH_CLIENT_REDIRECT_URIS   comma-separated absolute https redirect URIs
//                                (e.g. https://design-system.sent-tech.ca/auth/oauth/callback,
//                                 or the claude.ai hosted callback
//                                 https://claude.ai/api/mcp/auth_callback for a non-DCR MCP client)
//   OAUTH_CLIENT_SECRET          the STRONG, generated client secret (plaintext);
//                                only its sha256 hash is stored. The plaintext is
//                                NEVER persisted and must live in the RP's own
//                                prod secret store.
// Optional env (defaults target the A0 first client, `design-system`):
//   OAUTH_CLIENT_ID              default "design-system"
//   OAUTH_CLIENT_NAME            default "Sentropic Design System"
//   OAUTH_CLIENT_SCOPES          comma-separated; default "openid,profile,email"
//   OAUTH_CLIENT_RESOURCE_INDICATORS  comma-separated absolute https resource URIs
//                                (RFC 8707 allowlist → the `resource_indicators` column). Absent
//                                ⇒ '{}' (default-deny: no `resource` value permitted on the
//                                authorization_code flow ⇒ invalid_target). For an MCP client
//                                bound to a resource, e.g. https://immo.sent-tech.ca/mcp.
//   OAUTH_CLIENT_TOKEN_AUTH      'client_secret_basic' (default, confidential) or 'none' (public
//                                client + PKCE, NO secret — e.g. a claude.ai MCP connector using
//                                Advanced-settings custom credentials). In 'none' mode
//                                OAUTH_CLIENT_SECRET is neither required nor stored.
//
// Free auth (sub + email): no tenant, no claim set. authorization_code + PKCE,
// client_secret_basic — matching the dev seed's `design-system` shape.

import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';

import { eq } from 'drizzle-orm';

import { db, pool } from '../db/client';
import { oauthClients } from '../db/schema';

const hashSecret = (secret: string): string => createHash('sha256').update(secret).digest('hex');

const parseList = (value: string): string[] =>
  value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);

const requireEnv = (source: NodeJS.ProcessEnv, name: string): string => {
  const value = source[name];
  if (!value || value.trim() === '') {
    throw new Error(`Missing required env ${name}`);
  }
  return value.trim();
};

export interface OAuthClientRegistrationValues {
  allowedScopes: string[];
  clientId: string;
  clientSecretHash: string | null;
  createdAt: Date;
  dpopBoundAccessTokens: boolean;
  grantTypes: string[];
  id: string;
  name: string;
  redirectUris: string[];
  requirePkce: boolean;
  resourceIndicators: string[];
  responseTypes: string[];
  tokenEndpointAuthMethod: string;
  updatedAt: Date;
}

/**
 * Pure, side-effect-free builder: parse the env into the `oauth_clients` row values, applying the
 * prod-safe guards. Kept separate from `main()` (the DB upsert) so it is unit-testable without a
 * database. Every returned array/field is validated here.
 */
export const buildOAuthClientRegistration = (
  source: NodeJS.ProcessEnv = process.env,
  now: Date = new Date(),
): OAuthClientRegistrationValues => {
  const clientId = (source.OAUTH_CLIENT_ID ?? 'design-system').trim();
  const name = (source.OAUTH_CLIENT_NAME ?? 'Sentropic Design System').trim();

  const redirectUris = parseList(requireEnv(source, 'OAUTH_CLIENT_REDIRECT_URIS'));
  if (redirectUris.length === 0) {
    throw new Error('OAUTH_CLIENT_REDIRECT_URIS must contain at least one redirect URI');
  }
  // Guard against accidentally registering dev/localhost URIs in prod.
  const insecure = redirectUris.filter(
    (uri) => !uri.startsWith('https://') || /localhost|127\.0\.0\.1/.test(uri),
  );
  if (insecure.length > 0) {
    throw new Error(
      `Refusing to register insecure/localhost redirect URIs: ${insecure.join(', ')}. ` +
        'Use absolute https:// URIs only.',
    );
  }

  // token_endpoint_auth_method: 'client_secret_basic' (confidential, default) or 'none' (public
  // client + PKCE, no secret — e.g. a claude.ai MCP connector via Advanced-settings custom creds).
  const tokenEndpointAuthMethod = (source.OAUTH_CLIENT_TOKEN_AUTH ?? 'client_secret_basic').trim();
  if (tokenEndpointAuthMethod !== 'client_secret_basic' && tokenEndpointAuthMethod !== 'none') {
    throw new Error(
      `Unsupported OAUTH_CLIENT_TOKEN_AUTH '${tokenEndpointAuthMethod}'. ` +
        "Use 'client_secret_basic' (confidential) or 'none' (public + PKCE).",
    );
  }
  const isPublicClient = tokenEndpointAuthMethod === 'none';

  // Public clients carry NO secret (PKCE is the proof); confidential clients require a strong one,
  // stored only as its sha256 hash (plaintext never persisted).
  let clientSecretHash: string | null = null;
  if (!isPublicClient) {
    const clientSecret = requireEnv(source, 'OAUTH_CLIENT_SECRET');
    // Reject the well-known dev secret pattern to avoid registering a weak secret.
    if (/dev-only/i.test(clientSecret)) {
      throw new Error('Refusing a dev-only client secret. Provide a strong, generated secret.');
    }
    clientSecretHash = hashSecret(clientSecret);
  }

  const scopes = parseList(source.OAUTH_CLIENT_SCOPES ?? 'openid,profile,email');

  // RFC 8707 resource-indicator allowlist. Absent ⇒ [] (default-deny). Each entry must be an
  // absolute https URI (the token audience a client may request on the authorization_code flow).
  const resourceIndicators = parseList(source.OAUTH_CLIENT_RESOURCE_INDICATORS ?? '');
  const invalidResources = resourceIndicators.filter((uri) => !isAbsoluteHttpsUri(uri));
  if (invalidResources.length > 0) {
    throw new Error(
      `Refusing invalid resource indicators: ${invalidResources.join(', ')}. ` +
        'Use absolute https:// resource URIs only.',
    );
  }

  return {
    allowedScopes: scopes,
    clientId,
    clientSecretHash,
    createdAt: now,
    dpopBoundAccessTokens: false,
    grantTypes: ['authorization_code'],
    id: `client-${clientId}`,
    name,
    redirectUris,
    requirePkce: true,
    resourceIndicators,
    responseTypes: ['code'],
    tokenEndpointAuthMethod,
    updatedAt: now,
  };
};

const isAbsoluteHttpsUri = (value: string): boolean => {
  try {
    return new URL(value).protocol === 'https:';
  } catch {
    return false;
  }
};

const main = async (): Promise<void> => {
  const values = buildOAuthClientRegistration();

  await db
    .insert(oauthClients)
    .values(values)
    .onConflictDoUpdate({
      set: {
        allowedScopes: values.allowedScopes,
        clientSecretHash: values.clientSecretHash,
        dpopBoundAccessTokens: values.dpopBoundAccessTokens,
        grantTypes: values.grantTypes,
        name: values.name,
        redirectUris: values.redirectUris,
        requirePkce: values.requirePkce,
        resourceIndicators: values.resourceIndicators,
        responseTypes: values.responseTypes,
        tokenEndpointAuthMethod: values.tokenEndpointAuthMethod,
        updatedAt: values.updatedAt,
      },
      target: oauthClients.clientId,
    });

  const [row] = await db
    .select({
      clientId: oauthClients.clientId,
      name: oauthClients.name,
      redirectUris: oauthClients.redirectUris,
      resourceIndicators: oauthClients.resourceIndicators,
    })
    .from(oauthClients)
    .where(eq(oauthClients.clientId, values.clientId))
    .limit(1);

  console.log(`Registered OAuth client: ${row?.clientId ?? values.clientId} (${row?.name ?? values.name})`);
  console.log(`  redirect URIs: ${(row?.redirectUris ?? values.redirectUris).join(', ')}`);
  console.log(`  resource indicators: ${(row?.resourceIndicators ?? values.resourceIndicators).join(', ') || '(none)'}`);
  console.log('  client secret was hashed (sha256); plaintext NOT stored.');
};

// Only run the DB upsert when executed directly (kubectl Job / `npm run oauth:register-client`).
// Importing this module (e.g. from a unit test of `buildOAuthClientRegistration`) is side-effect-free.
const entrypoint = process.argv[1];
const invokedDirectly = entrypoint !== undefined && import.meta.url === pathToFileURL(entrypoint).href;

if (invokedDirectly) {
  try {
    await main();
  } catch (error) {
    console.error('Failed to register OAuth client:', error);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}
