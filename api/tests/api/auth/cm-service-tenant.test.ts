import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { db } from '../../../src/db/client';
import { serviceClients } from '../../../src/db/schema';
import { createOauthStateStoreAdapter } from '../../../src/services/auth/oauth-state-adapter';
import { createCmTenant, setCmTenantStatus } from '../../../src/services/identity/cm-tenancy';
import { bindCmAppDatabase, runCmIdentityWrite } from '../../../src/services/identity/cm-transaction';
import { authorizedTenants } from '../../../src/services/tenancy/enrollment-store';
import { cmDeleteTenants, cmQuery, cmTable } from '../../utils/cm-identity-test-store';

const clientId = 'a4-service-client';
const tenantId = 'a4-service-registry-id';
const slug = 'a4-service-slug';

describe('CM service-client tenant binding', () => {
  const cleanup = async () => {
    await db.delete(serviceClients).where(eq(serviceClients.clientId, clientId));
    await cmQuery(`DELETE FROM ${cmTable('cm_service_clients')} WHERE client_id = $1`, [clientId]);
    await cmDeleteTenants([tenantId]);
  };
  beforeEach(async () => {
    await cleanup();
    await createCmTenant({ tenantId, slug });
    await db.insert(serviceClients).values({ id: clientId, clientId, clientSecretHash: 'fixture-digest',
      allowedScopes: ['service:read'] });
  });
  afterEach(cleanup);

  const readClient = () => runCmIdentityWrite(transaction => createOauthStateStoreAdapter({
    database: bindCmAppDatabase(transaction), transactionBound: true,
  }).findServiceClient!(clientId));

  it('never infers a fixed tenant from app protocol metadata', async () => {
    expect(await readClient()).toMatchObject({ clientId, tenantId: null });
    expect(await authorizedTenants(clientId, 'connector')).toEqual([]);
  });

  it('uses the CM binding and publishes its immutable slug', async () => {
    await runCmIdentityWrite(transaction => transaction.stores.oauth.bindServiceClient({
      clientId, tenantId, boundAt: new Date().toISOString(),
    }));
    expect(await readClient()).toMatchObject({ clientId, tenantId: slug });
    expect(await authorizedTenants(clientId, 'connector')).toEqual([slug]);
    await setCmTenantStatus(tenantId, 'suspended');
    expect(await readClient()).toMatchObject({ clientId, tenantId: null });
    expect(await authorizedTenants(clientId, 'connector')).toEqual([]);
  });

  it('rolls back protocol credentials and a CM binding together', async () => {
    await expect(runCmIdentityWrite(async transaction => {
      await bindCmAppDatabase(transaction).update(serviceClients).set({ displayName: 'Not committed' })
        .where(eq(serviceClients.clientId, clientId));
      await transaction.stores.oauth.bindServiceClient({ clientId, tenantId, boundAt: new Date().toISOString() });
      throw new Error('injected_service_binding_failure');
    })).rejects.toThrow('injected_service_binding_failure');
    expect(await readClient()).toMatchObject({ tenantId: null, displayName: null });
  });
});
