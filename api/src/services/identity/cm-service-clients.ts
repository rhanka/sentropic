import { IdentityNotFoundError, TenantNotActiveError } from '@sentropic/cluster-mesh';
import { runCmIdentityRead, type CmIdentityTransaction } from './cm-transaction';

/** Fixed service-client authority lives exclusively in the CM tenant registry. */
export const findCmServiceClientBinding = (clientId: string) => runCmIdentityRead(async tx => {
  for (const tenant of await tx.stores.tenants.listTenants()) {
    const clients = await tx.stores.oauth.listTenantServiceClients(tenant.tenantId);
    const binding = clients.find(client => client.clientId === clientId);
    if (binding) return { binding, tenant };
  }
  return null;
});

export const findCmServiceClientTenant = async (clientId: string): Promise<string | null> => {
  const current = await findCmServiceClientBinding(clientId);
  return current?.tenant.status === 'active' ? current.tenant.slug : null;
};

/** Host provisioning supplies an explicit slug and borrows its protocol transaction. */
export async function bindCmServiceClientTenant(tx: CmIdentityTransaction, clientId: string, slug: string) {
  const tenant = await tx.stores.tenants.findTenantBySlug(slug);
  if (!tenant) throw new IdentityNotFoundError('tenant', slug);
  if (tenant.status !== 'active') throw new TenantNotActiveError(tenant.tenantId);
  await tx.stores.oauth.bindServiceClient({ clientId, tenantId: tenant.tenantId, boundAt: new Date().toISOString() });
}
