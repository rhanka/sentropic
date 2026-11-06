import { describe, expect, it } from 'vitest';

import { IdentityCustodyErrorV1 } from '@sentropic/cluster-mesh';

import { createServiceTenantEnrollmentSource } from '../../../src/services/tenancy/enrollment-store';
import { withCmIdentityTransaction, type CmIdentityTransaction } from '../../../src/services/identity/cm-transaction';

/**
 * a4-cm-gaps-r2 §10.7 series 3 (P3): the service-tenancy enrollment source
 * is an attempt closure. Reusing it after its attempt ended must refuse
 * `identity_transaction_unbound` instead of reading enrollments on a foreign
 * or expired handle (stale-handle refusal).
 */

class ProbeQuery extends Error {}

const fakeTx = () => ({
  hostTransaction: {
    query: async () => { throw new ProbeQuery('query must not run on a stale handle'); },
  },
}) as unknown as CmIdentityTransaction;

describe('service-tenant enrollment source (attempt closure)', () => {
  it('refuses a source reused after its attempt ended', async () => {
    let source!: ReturnType<typeof createServiceTenantEnrollmentSource>;
    const tx = fakeTx();
    await withCmIdentityTransaction(tx, async () => {
      source = createServiceTenantEnrollmentSource(tx);
    });
    await expect(source.listEnrolledTenantIds('client-1')).rejects.toBeInstanceOf(IdentityCustodyErrorV1);
    await expect(source.listEnrolledTenantIds('client-1')).rejects.toMatchObject({
      code: 'identity_transaction_unbound',
    });
  });

  it('rejects a source built outside any attempt', async () => {
    const source = createServiceTenantEnrollmentSource(fakeTx());
    await expect(source.listEnrolledTenantIds('client-1')).rejects.toMatchObject({
      code: 'identity_transaction_unbound',
    });
  });
});
