import { createHash } from 'node:crypto';

import { eq } from 'drizzle-orm';

import { env } from '../../config/env';
import { db } from '../../db/client';
import { oauthClients, serviceClients } from '../../db/schema';

const REDIRECT_URIS = [
  'http://localhost:5397/auth/oauth/callback',
  'http://localhost:5173/auth/oauth/callback',
];

export interface SeededOAuthClient {
  clientId: string;
  dpopBoundAccessTokens: boolean;
  name: string;
}

export const seedOAuthClients = async (): Promise<SeededOAuthClient[]> => {
  const clients = [
    {
      clientId: 'example-mock-rp',
      clientSecret: 'example-mock-rp-secret-dev-only',
      dpopBoundAccessTokens: false,
      id: 'seed-example-mock-rp',
      name: 'Example Mock RP',
    },
    {
      clientId: 'example-dpop-rp',
      clientSecret: 'example-dpop-rp-secret-dev-only',
      dpopBoundAccessTokens: true,
      id: 'seed-example-dpop-rp',
      name: 'Example DPoP RP',
    },
  ];

  const now = new Date();
  const seeded: SeededOAuthClient[] = [];

  for (const client of clients) {
    const values = {
      allowedScopes: ['openid', 'profile', 'email'],
      clientId: client.clientId,
      clientSecretHash: hashSecret(client.clientSecret),
      createdAt: now,
      dpopBoundAccessTokens: client.dpopBoundAccessTokens,
      grantTypes: ['authorization_code'],
      id: client.id,
      name: client.name,
      redirectUris: REDIRECT_URIS,
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
        dpopBoundAccessTokens: oauthClients.dpopBoundAccessTokens,
        name: oauthClients.name,
      })
      .from(oauthClients)
      .where(eq(oauthClients.clientId, client.clientId))
      .limit(1);
    if (row) seeded.push(row);
  }

  return seeded;
};

const hashSecret = (secret: string): string => createHash('sha256').update(secret).digest('hex');

export interface SeededServiceClient {
  clientId: string;
  dpopBoundAccessTokens: boolean;
  displayName: string | null;
}

/**
 * Seed a sample S2S `service_clients` row plus the self-S2S dogfood client
 * (BR39d-D10). The dev/test/e2e secret is well-known and must never be used in
 * production. The resource indicator defaults to the configured service resource
 * URI (falls back to the local issuer).
 */
export const seedServiceClients = async (): Promise<SeededServiceClient[]> => {
  const resource =
    env.OAUTH_SERVICE_RESOURCE_URI ??
    env.OAUTH_ISSUER_URL ??
    `http://localhost:${process.env.API_PORT ?? env.PORT}`;

  const selfClientId = env.OAUTH_SELF_SERVICE_CLIENT_ID ?? 'sentropic-self-s2s';
  const selfClientSecret = env.OAUTH_SELF_SERVICE_CLIENT_SECRET ?? 'sentropic-self-s2s-secret-dev-only';

  const clients = [
    {
      allowedScopes: ['service:ping', 'service:read'],
      clientId: 'example-service-rp',
      clientSecret: 'example-service-rp-secret-dev-only',
      displayName: 'Example Service RP',
      dpopBoundAccessTokens: false,
      id: 'seed-example-service-rp',
    },
    {
      allowedScopes: ['service:ping'],
      clientId: selfClientId,
      clientSecret: selfClientSecret,
      displayName: 'Sentropic Self S2S (dogfood)',
      dpopBoundAccessTokens: false,
      id: 'seed-sentropic-self-s2s',
    },
  ];

  const now = new Date();
  const seeded: SeededServiceClient[] = [];

  for (const client of clients) {
    const values = {
      allowedScopes: client.allowedScopes,
      clientId: client.clientId,
      clientSecretHash: hashSecret(client.clientSecret),
      createdAt: now,
      displayName: client.displayName,
      dpopBoundAccessTokens: client.dpopBoundAccessTokens,
      id: client.id,
      resourceIndicators: [resource],
      revokedAt: null,
    };

    await db
      .insert(serviceClients)
      .values(values)
      .onConflictDoUpdate({
        set: {
          allowedScopes: values.allowedScopes,
          clientSecretHash: values.clientSecretHash,
          displayName: values.displayName,
          dpopBoundAccessTokens: values.dpopBoundAccessTokens,
          resourceIndicators: values.resourceIndicators,
          revokedAt: null,
        },
        target: serviceClients.clientId,
      });

    const [row] = await db
      .select({
        clientId: serviceClients.clientId,
        displayName: serviceClients.displayName,
        dpopBoundAccessTokens: serviceClients.dpopBoundAccessTokens,
      })
      .from(serviceClients)
      .where(eq(serviceClients.clientId, client.clientId))
      .limit(1);
    if (row) seeded.push(row);
  }

  return seeded;
};
