// Vitest alias target for the frozen identity contract suite on the
// PostgreSQL profile (lot A2.1). Re-exports the real package barrel so every
// other import keeps its exact meaning; only createInMemoryIdentityStores is
// overridden to build durable A2.1 stores in a fresh control schema per call,
// with in-memory doubles for the parallel lots' disjoint slices.

import { randomUUID } from 'node:crypto';
import { testPgDriver } from '../../storage/pg-driver.js';
import type { InjectedPgDriver } from '../../../src/storage/postgres/protocol.js';
import {
  createInMemoryIdentityStores as createInMemoryStores,
  createPostgresIdentityStores,
  type IdentityStores,
} from '../../../src/index.js';
import { registerCleanup } from './cleanup-registry.js';

export * from '../../../src/index.js';

let driver: { readonly driver: InjectedPgDriver } | null = null;

const sharedDriver = (): InjectedPgDriver => {
  if (!driver) {
    const opened = testPgDriver();
    driver = { driver: opened.driver };
    registerCleanup(() => opened.close());
  }
  return driver.driver;
};

export const createInMemoryIdentityStores = (): IdentityStores => {
  const base = createInMemoryStores();
  if (!process.env.CM_PG_URL) return base;
  const pg = sharedDriver();
  const schema = `identity_${randomUUID().replaceAll('-', '').slice(0, 12)}`;
  const durable = createPostgresIdentityStores({ driver: pg, schema });
  registerCleanup(() =>
    pg
      .transaction({ isolation: 'serializable', readOnly: false, deadlineMs: 5000 }, async (session) => {
        await session.execute({ text: `DROP SCHEMA IF EXISTS "${schema}" CASCADE`, values: [] });
      })
      .catch(() => undefined),
  );
  return {
    ...base,
    accounts: durable.accounts,
    proofs: durable.proofs,
    invitations: durable.invitations,
    deviceCodes: durable.deviceCodes,
    sessions: durable.sessions,
    audit: durable.audit,
  };
};
