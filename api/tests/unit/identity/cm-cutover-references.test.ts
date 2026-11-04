import type { PoolClient } from 'pg';
import { describe, expect, it } from 'vitest';

import { IdentityCustodyErrorV1 } from '@sentropic/cluster-mesh';

import { rebindA4BusinessReferences } from '../../../src/services/identity/cm-cutover-references';

const invalidImportCode = async (run: Promise<unknown>): Promise<string> => {
  const error = await run.then(() => { throw new Error('expected the rebind to fail'); }, (cause: unknown) => cause);
  expect(error).toBeInstanceOf(IdentityCustodyErrorV1);
  return (error as IdentityCustodyErrorV1).code;
};

interface QueryCall {
  readonly text: string;
  readonly params: readonly unknown[] | undefined;
}

const baseRow = {
  name: 'fk_org_tenant',
  child_schema: 'public',
  child_table: 'organizations',
  parent: 'tenants',
  child_columns: ['tenant_id'],
  parent_columns: ['id'],
  on_delete: 'a',
  on_update: 'a',
  deferrable: false,
  deferred: false,
  match: 's',
};

const makeClient = (fkRows: readonly unknown[]) => {
  const calls: QueryCall[] = [];
  const client = {
    query: async (text: string, params?: readonly unknown[]) => {
      calls.push({ text, params });
      if (text.startsWith('SELECT c.conname')) return { rows: fkRows };
      return { rows: [] };
    },
  };
  return { client: client as unknown as PoolClient, calls };
};

describe('rebindA4BusinessReferences', () => {
  it('rebinds a business edge to the cm_identity table with mapped columns', async () => {
    const { client, calls } = makeClient([baseRow]);
    await rebindA4BusinessReferences(client);
    const statements = calls.map(call => call.text);
    expect(statements.some(text => text.includes('DROP CONSTRAINT "fk_org_tenant"'))).toBe(true);
    const add = statements.find(text => text.includes('ADD CONSTRAINT "fk_org_tenant"'));
    expect(add).toContain('FOREIGN KEY ("tenant_id")');
    expect(add).toContain('REFERENCES cm_identity."cm_tenants" ("tenant_id")');
    const update = calls.find(call => call.text.startsWith('UPDATE control.app_cm_identity_cutover'));
    expect(update).toBeDefined();
    expect(JSON.parse(String(update?.params?.[0]))).toMatchObject({
      businessReferenceInventory: [
        { table: 'organizations', constraint: 'fk_org_tenant', disposition: 'rebound' },
      ],
    });
  });

  it('drops the constraint of a deleted legacy child without rebinding', async () => {
    const { client, calls } = makeClient([{
      ...baseRow,
      name: 'fk_session_user',
      child_table: 'user_sessions',
      parent: 'users',
      child_columns: ['user_id'],
      parent_columns: ['id'],
    }]);
    await rebindA4BusinessReferences(client);
    const statements = calls.map(call => call.text);
    expect(statements.some(text => text.includes('DROP CONSTRAINT "fk_session_user"'))).toBe(true);
    expect(statements.some(text => text.includes('ADD CONSTRAINT'))).toBe(false);
  });

  it('fails closed when the driver hands back a raw array literal', async () => {
    const { client } = makeClient([{ ...baseRow, parent_columns: '{id}' }]);
    expect(await invalidImportCode(rebindA4BusinessReferences(client))).toBe('identity_import_invalid');
  });

  it('fails closed when a column list is missing', async () => {
    const { client } = makeClient([{ ...baseRow, parent_columns: null }]);
    expect(await invalidImportCode(rebindA4BusinessReferences(client))).toBe('identity_import_invalid');
  });

  it('fails closed on an unmapped business parent', async () => {
    const { client } = makeClient([{ ...baseRow, parent: 'organizations' }]);
    expect(await invalidImportCode(rebindA4BusinessReferences(client))).toBe('identity_import_invalid');
  });
});
