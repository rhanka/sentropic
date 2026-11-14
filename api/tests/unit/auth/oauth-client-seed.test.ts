import { describe, expect, it, vi } from 'vitest';

const observed = vi.hoisted(() => ({ inserts: [] as Record<string, unknown>[], updates: [] as Record<string, unknown>[] }));
vi.mock('../../../src/db/client', () => ({ db: {
  insert: () => ({ values: (values: Record<string, unknown>) => {
    observed.inserts.push(values);
    return { onConflictDoUpdate: async ({ set }: { set: Record<string, unknown> }) => { observed.updates.push(set); } };
  } }),
  select: () => ({ from: () => ({ where: () => ({ limit: async () => [] }) }) }),
} }));
vi.mock('../../../src/services/identity/cm-transaction', () => ({}));
vi.mock('../../../src/services/identity/cm-service-clients', () => ({}));

import { seedOAuthClients } from '../../../src/services/auth/oauth-client-seed';

describe('OAuth client seed tenant policy', () => {
  it('should seed design-system without a tenant and retain tenant checks on sample RPs', async () => {
    await seedOAuthClients();
    expect(observed.inserts.map(({ clientId, requireTenant }) => ({ clientId, requireTenant }))).toEqual([
      { clientId: 'example-mock-rp', requireTenant: true },
      { clientId: 'example-dpop-rp', requireTenant: true },
      { clientId: 'design-system', requireTenant: false },
    ]);
    expect(observed.updates.map(row => row.requireTenant)).toEqual([true, true, false]);
  });
});
