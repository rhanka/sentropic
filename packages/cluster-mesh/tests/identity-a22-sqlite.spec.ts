// Identity core lot A2.2: SQLite profile specs. One `:memory:` database per
// test, so every case starts from an empty durable store on the local profile.

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { applySqliteIdentitySchema, createSqliteIdentityStores } from '../src/index.js';
import {
  replayContractMembershipCycle,
  runGapSection1,
  runShadowStrictReplay,
  runUniquenessAliasTransition,
  type A22BackendStores,
} from './identity-a22-scenarios.js';

function setupSqlite(): A22BackendStores {
  const db = new DatabaseSync(':memory:');
  applySqliteIdentitySchema(db);
  return createSqliteIdentityStores(db);
}

describe('A2.2 tenants, memberships and workspaces on SQLite', () => {
  it('should replay the frozen contract cycle over durable stores', async () => {
    await replayContractMembershipCycle(setupSqlite());
  });

  it('should enforce uniqueness, aliases and the transition table', async () => {
    await runUniquenessAliasTransition(setupSqlite());
  });

  it('should replay shadow against strict with divergence metrics', async () => {
    await runShadowStrictReplay(setupSqlite());
  });

  it('should separate account approval from membership approval end to end', async () => {
    await runGapSection1(setupSqlite());
  });

  it('should keep the SQLite file usable across reopen', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'a22-sqlite-'));
    try {
      const path = join(dir, 'identity.db');
      const first = new DatabaseSync(path);
      try {
        applySqliteIdentitySchema(first);
        const stores = createSqliteIdentityStores(first);
        await stores.tenants.createTenant({ tenantId: 't', slug: 's', status: 'active', createdAt: 'now' });
        expect((await stores.tenants.listTenants()).map((tenant) => tenant.tenantId)).toEqual(['t']);
      } finally {
        first.close();
      }
      const second = new DatabaseSync(path);
      try {
        const stores = createSqliteIdentityStores(second);
        expect((await stores.tenants.listTenants()).map((tenant) => tenant.tenantId)).toEqual(['t']);
      } finally {
        second.close();
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
