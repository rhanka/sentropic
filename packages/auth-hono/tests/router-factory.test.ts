import { describe, expect, it } from 'vitest';

import { createAuthRouter } from '../src/index.js';

describe('createAuthRouter', () => {
  it('mounts a health endpoint for host readiness checks', async () => {
    const router = createAuthRouter();

    const response = await router.request('/health');

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      status: 'ok',
      service: 'auth',
    });
  });
});
