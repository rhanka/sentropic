import type { PoolClient } from 'pg';
import { invalidA4Import } from './cm-import-values';

const legacy = ['users', 'webauthn_credentials', 'webauthn_challenges', 'email_verification_codes',
  'magic_links', 'auth_invite_tokens', 'user_sessions', 'identities', 'tenants', 'tenant_memberships', 'workspace_memberships'];
const destinations: Readonly<Record<string, { table: string; columns: Readonly<Record<string, string>> }>> = {
  users: { table: 'identity_user_accounts', columns: { id: 'user_id' } },
  tenants: { table: 'cm_tenants', columns: { id: 'tenant_id' } },
  user_sessions: { table: 'identity_login_sessions', columns: { id: 'session_id' } },
  webauthn_credentials: { table: 'identity_webauthn_credentials', columns: { id: 'proof_id' } },
  identities: { table: 'identity_social_links', columns: { id: 'proof_id' } },
  auth_invite_tokens: { table: 'identity_invitation_digests', columns: { id: 'invitation_id' } },
  tenant_memberships: { table: 'cm_tenant_memberships', columns: { tenant_id: 'tenant_id', user_id: 'user_id' } },
  workspace_memberships: { table: 'cm_workspace_members', columns: { workspace_id: 'workspace_id', user_id: 'user_id' } },
};
const quote = (identifier: string): string => `"${identifier.replaceAll('"', '""')}"`;
const actions: Readonly<Record<string, string>> = { a: 'NO ACTION', r: 'RESTRICT', c: 'CASCADE', n: 'SET NULL', d: 'SET DEFAULT' };
const action = (code: string): string => actions[code] ?? invalidA4Import();
interface SourceForeignKey {
  name: string; child_schema: string; child_table: string; parent: string;
  child_columns: string[]; parent_columns: string[]; on_delete: string; on_update: string;
  deferrable: boolean; deferred: boolean; match: string;
}

/** Preserve actual business reference actions instead of dropping referential integrity. */
export async function rebindA4BusinessReferences(client: PoolClient): Promise<void> {
  const result = await client.query<SourceForeignKey>(`SELECT c.conname AS name, ns.nspname AS child_schema,
    child.relname AS child_table, parent.relname AS parent, c.confdeltype AS on_delete, c.confupdtype AS on_update,
    c.condeferrable AS deferrable, c.condeferred AS deferred, c.confmatchtype AS match,
    ARRAY(SELECT a.attname FROM unnest(c.conkey) WITH ORDINALITY k(num, ord)
      JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.num ORDER BY k.ord) AS child_columns,
    ARRAY(SELECT a.attname FROM unnest(c.confkey) WITH ORDINALITY k(num, ord)
      JOIN pg_attribute a ON a.attrelid = c.confrelid AND a.attnum = k.num ORDER BY k.ord) AS parent_columns
    FROM pg_constraint c JOIN pg_class child ON child.oid = c.conrelid JOIN pg_namespace ns ON ns.oid = child.relnamespace
    JOIN pg_class parent ON parent.oid = c.confrelid JOIN pg_namespace pn ON pn.oid = parent.relnamespace
    WHERE c.contype = 'f' AND pn.nspname = 'public' AND parent.relname = ANY($1::text[])
    ORDER BY ns.nspname COLLATE "C", child.relname COLLATE "C", c.conname COLLATE "C"`, [legacy]);
  const inventory = [];
  for (const foreignKey of result.rows) {
    const table = `${quote(foreignKey.child_schema)}.${quote(foreignKey.child_table)}`;
    const deletedChild = foreignKey.child_schema === 'public' && legacy.includes(foreignKey.child_table);
    const movedWorkspaceEdge = foreignKey.child_schema === 'public' && foreignKey.child_table === 'workspaces'
      && foreignKey.child_columns.length === 1 && foreignKey.child_columns[0] === 'tenant_id';
    const destination = destinations[foreignKey.parent];
    if (!deletedChild && !movedWorkspaceEdge && !destination) return invalidA4Import();
    const targetColumns = deletedChild || movedWorkspaceEdge ? [] : foreignKey.parent_columns
      .map(column => destination.columns[column] ?? invalidA4Import());
    await client.query(`ALTER TABLE ${table} DROP CONSTRAINT ${quote(foreignKey.name)}`);
    if (!deletedChild && !movedWorkspaceEdge) {
      const match = foreignKey.match === 's' ? 'SIMPLE' : foreignKey.match === 'f' ? 'FULL' : invalidA4Import();
      await client.query(`ALTER TABLE ${table} ADD CONSTRAINT ${quote(foreignKey.name)}
        FOREIGN KEY (${foreignKey.child_columns.map(quote).join(', ')})
        REFERENCES cm_identity.${quote(destination.table)} (${targetColumns.map(quote).join(', ')})
        MATCH ${match} ON UPDATE ${action(foreignKey.on_update)} ON DELETE ${action(foreignKey.on_delete)}
        ${foreignKey.deferrable ? `DEFERRABLE INITIALLY ${foreignKey.deferred ? 'DEFERRED' : 'IMMEDIATE'}` : 'NOT DEFERRABLE'}`);
    }
    inventory.push({ schema: foreignKey.child_schema, table: foreignKey.child_table, constraint: foreignKey.name,
      columns: foreignKey.child_columns, sourceParent: foreignKey.parent,
      destination: deletedChild || movedWorkspaceEdge ? null : destination.table,
      disposition: deletedChild ? 'legacy_table_deleted' : movedWorkspaceEdge ? 'cm_directory_edge' : 'rebound',
      onDelete: action(foreignKey.on_delete), onUpdate: action(foreignKey.on_update) });
  }
  await client.query(`UPDATE control.app_cm_identity_cutover SET detail = detail || $1::jsonb
    WHERE cutover_id = 'a4-identity-cutover'`, [JSON.stringify({ businessReferenceInventory: inventory })]);
}
