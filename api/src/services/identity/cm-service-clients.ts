import { IdentityNotFoundError, TenantNotActiveError } from '@sentropic/cluster-mesh';
import { runCmIdentityRead, type CmIdentityTransaction } from './cm-transaction';

/** Fixed service-client authority lives exclusively in the CM tenant registry. */
export const findCmServiceClientTenant = (clientId: string): Promise<string | null> => runCmIdentityRead(async tx => {
  for (const tenant of await tx.stores.tenants.listTenants()) {
    if (tenant.status !== 'active') continue;
    const clients = await tx.stores.oauth.listTenantServiceClients(tenant.tenantId);
    if (clients.some(client => client.clientId === clientId)) return tenant.slug;
  }
  return null;
});

/** Host provisioning supplies an explicit slug and borrows its protocol transaction. */
export async function bindCmServiceClientTenant(tx: CmIdentityTransaction, clientId: string, slug: string) {
  const tenant = await tx.stores.tenants.findTenantBySlug(slug);
  if (!tenant) throw new IdentityNotFoundError('tenant', slug);
  if (tenant.status !== 'active') throw new TenantNotActiveError(tenant.tenantId);
  await tx.stores.oauth.bindServiceClient({ clientId, tenantId: tenant.tenantId, boundAt: new Date().toISOString() });
}
