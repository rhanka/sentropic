// Vitest alias target for the frozen identity contract suite on the SQLite
// local profile (lot A2.1). Same contract as the PostgreSQL shim: full barrel
// re-export, createInMemoryIdentityStores overridden to durable A2.1 stores
// in a fresh temp store file per call; other lots' slices stay in memory.

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createInMemoryIdentityStores as createInMemoryStores,
  openSqliteIdentityStores,
  type IdentityStores,
} from '../../../src/index.js';
import { registerCleanup } from './cleanup-registry.js';

export * from '../../../src/index.js';

export const createInMemoryIdentityStores = (): IdentityStores => {
  const base = createInMemoryStores();
  const dir = mkdtempSync(join(tmpdir(), 'cm-identity-profile-'));
  const handle = openSqliteIdentityStores({ path: join(dir, 'identity.db'), moduleId: 'cluster-mesh-identity' });
  registerCleanup(() => {
    handle.close();
    rmSync(dir, { recursive: true, force: true });
  });
  return {
    ...base,
    accounts: handle.stores.accounts,
    proofs: handle.stores.proofs,
    invitations: handle.stores.invitations,
    deviceCodes: handle.stores.deviceCodes,
    sessions: handle.stores.sessions,
    audit: handle.stores.audit,
  };
};
