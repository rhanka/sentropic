import { describe, expect, it } from 'vitest';

import { MuseRuntimeClient } from '../../src/transport/muse-runtime-client.js';

const auth = {
  auth: {
    material: {
      type: 'account-transport' as const, provider: 'muse' as const,
      accessToken: 'secret-muse-token', accountId: 'acct_muse_1',
    },
    descriptor: { sourceType: 'account-transport' as const, accountProviderId: 'muse' as const },
  },
};

const request = {
  providerId: 'muse' as const, modelId: 'muse-spark-1.3-contributor',
  messages: [{ role: 'user', content: 'hello' }] as const,
};

describe('Muse auth classification (no transport misreport)', () => {
  it('carries a typed auth code on 401 so consumers map it to reauth', async () => {
    const client = new MuseRuntimeClient({
      fetch: async () => new Response('denied', { status: 401 }),
    });
    const error = await client.generate({ ...request }, auth).catch((e: unknown) => e as Error & { status?: number; code?: string });
    expect(error.status).toBe(401);
    expect(error.code).toBe('AUTHENTICATION_FAILED');
  });

  it('carries a typed auth code on 403', async () => {
    const client = new MuseRuntimeClient({
      fetch: async () => new Response('denied', { status: 403 }),
    });
    const error = await client.generate({ ...request }, auth).catch((e: unknown) => e as Error & { status?: number; code?: string });
    expect(error.status).toBe(403);
    expect(error.code).toBe('AUTHENTICATION_FAILED');
  });
});
