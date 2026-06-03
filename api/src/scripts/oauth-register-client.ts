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
//                                (e.g. https://design-system.sent-tech.ca/auth/oauth/callback)
//   OAUTH_CLIENT_SECRET          the STRONG, generated client secret (plaintext);
//                                only its sha256 hash is stored. The plaintext is
//                                NEVER persisted and must live in the RP's own
//                                prod secret store.
// Optional env (defaults target the A0 first client, `design-system`):
//   OAUTH_CLIENT_ID              default "design-system"
//   OAUTH_CLIENT_NAME            default "Sentropic Design System"
//   OAUTH_CLIENT_SCOPES          comma-separated; default "openid,profile,email"
//
// Free auth (sub + email): no tenant, no claim set. authorization_code + PKCE,
// client_secret_basic — matching the dev seed's `design-system` shape.

import { createHash } from 'node:crypto';

import { eq } from 'drizzle-orm';

import { db, pool } from '../db/client';
import { oauthClients } from '../db/schema';

const hashSecret = (secret: string): string => createHash('sha256').update(secret).digest('hex');

const parseList = (value: string): string[] =>
  value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);

const requireEnv = (name: string): string => {
  const value = process.env[name];
  if (!value || value.trim() === '') {
    throw new Error(`Missing required env ${name}`);
  }
  return value.trim();
};

const main = async (): Promise<void> => {
  const clientId = (process.env.OAUTH_CLIENT_ID ?? 'design-system').trim();
  const name = (process.env.OAUTH_CLIENT_NAME ?? 'Sentropic Design System').trim();

  const redirectUris = parseList(requireEnv('OAUTH_CLIENT_REDIRECT_URIS'));
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

  const clientSecret = requireEnv('OAUTH_CLIENT_SECRET');
  // Reject the well-known dev secret pattern to avoid registering a weak secret.
  if (/dev-only/i.test(clientSecret)) {
    throw new Error('Refusing a dev-only client secret. Provide a strong, generated secret.');
  }

  const scopes = parseList(process.env.OAUTH_CLIENT_SCOPES ?? 'openid,profile,email');

  const now = new Date();
  const values = {
    allowedScopes: scopes,
    clientId,
    clientSecretHash: hashSecret(clientSecret),
    createdAt: now,
    dpopBoundAccessTokens: false,
    grantTypes: ['authorization_code'],
    id: `client-${clientId}`,
    name,
    redirectUris,
    requirePkce: true,
    responseTypes: ['code'],
    tokenEndpointAuthMethod: 'client_secret_basic',
    updatedAt: now,
  };

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
        responseTypes: values.responseTypes,
        tokenEndpointAuthMethod: values.tokenEndpointAuthMethod,
        updatedAt: now,
      },
      target: oauthClients.clientId,
    });

  const [row] = await db
    .select({
      clientId: oauthClients.clientId,
      name: oauthClients.name,
      redirectUris: oauthClients.redirectUris,
    })
    .from(oauthClients)
    .where(eq(oauthClients.clientId, clientId))
    .limit(1);

  console.log(`Registered OAuth client: ${row?.clientId ?? clientId} (${row?.name ?? name})`);
  console.log(`  redirect URIs: ${(row?.redirectUris ?? redirectUris).join(', ')}`);
  console.log('  client secret was hashed (sha256); plaintext NOT stored.');
};

try {
  await main();
} catch (error) {
  console.error('Failed to register OAuth client:', error);
  process.exitCode = 1;
} finally {
  await pool.end();
}
