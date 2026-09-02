import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';

import { requireAuth } from '../../src/middleware/auth';
import { requireAdmin, requireRole } from '../../src/middleware/rbac';
import {
  adminRouter as historicalAdminRouter,
  tenantResolutionMetricsRouter as historicalTenantMetricsRouter,
} from '../fixtures/historical/admin-e338673c1/api/src/routes/api/admin';

const historicalAdminApp = requireRole('admin_app');
const historical = new Hono()
  .on('GET', '/api/v1/admin/tenant-resolution-metrics', requireAuth, requireAdmin)
  .route('/api/v1/admin/tenant-resolution-metrics', historicalTenantMetricsRouter)
  .on('POST', '/api/v1/admin/reset', requireAuth, historicalAdminApp)
  .on('GET', '/api/v1/admin/stats', requireAuth, historicalAdminApp)
  .on('GET', '/api/v1/admin/users', requireAuth, historicalAdminApp)
  .on('POST', '/api/v1/admin/users/:id/approve', requireAuth, historicalAdminApp)
  .on('POST', '/api/v1/admin/users/:id/disable', requireAuth, historicalAdminApp)
  .on('POST', '/api/v1/admin/users/:id/reactivate', requireAuth, historicalAdminApp)
  .on('DELETE', '/api/v1/admin/users/:id', requireAuth, historicalAdminApp)
  .route('/api/v1/admin', historicalAdminRouter);

const fixtureRoot = '../fixtures/historical/admin-e338673c1/api/src';
const bridgeDigests = [
  ['db/client.ts', 'a26b33f68913593f17d07f288b855d14e0f21e537592673a42d5ae28606a5b99'],
  ['db/schema.ts', '8889df5d01f5c72912771f78495164ea81b7dfd456c36b12de74c796de2e36d0'],
  [
    'services/connector-grant-teardown.ts',
    '6f8277ded1e3f479ad5943f43a9bc3aefc3214a3a5fc6229c2956bfdd8c71730',
  ],
  [
    'services/tenancy/tenant-resolution-metrics.ts',
    'b04c3c9603f23b989555619aebee3fdeb5a8f41fdb6020e547f959ffff7a1b3a',
  ],
] as const;

describe('cluster mesh admin cutover', () => {
  it('pins the executable predecessor source and unchanged authority bridges', () => {
    const source = readFileSync(new URL(`${fixtureRoot}/routes/api/admin.ts`, import.meta.url));
    expect(createHash('sha1').update(`blob ${source.byteLength}\0`).update(source).digest('hex'))
      .toBe('71ec3755c976b796fc12ffaaa7f6009ba1b24971');
    for (const [path, digest] of bridgeDigests) {
      const bridge = readFileSync(new URL(`${fixtureRoot}/${path}`, import.meta.url));
      expect(createHash('sha256').update(bridge).digest('hex'), path).toBe(digest);
    }
    expect(historical.routes).toEqual(expect.arrayContaining([
      expect.objectContaining({ method: 'GET', path: '/api/v1/admin/stats' }),
      expect.objectContaining({
        method: 'GET', path: '/api/v1/admin/tenant-resolution-metrics', handler: requireAdmin,
      }),
    ]));
  });
});
