import { createHash } from 'node:crypto';

import { eq } from 'drizzle-orm';

import { db } from '../../db/client';
import { oauthClients } from '../../db/schema';

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
