import { IdentityCustodyErrorV1 } from '@sentropic/cluster-mesh';
import type { CmIdentityTransaction } from './cm-transaction';

// Existing personal data/credential ownership is deleted; shared objects retain
// nullable attribution. Historical append-only actor ids are not authorizers.
const deleted = [
  ['chat_message_feedback', 'user_id'], ['chat_generation_traces', 'user_id'], ['chat_sessions', 'user_id'],
  ['document_connector_accounts', 'user_id'], ['extension_tool_permissions', 'user_id'],
  ['llm_account_leases', 'user_id'], ['llm_provider_accounts', 'owner_user_id'],
  ['authorization_codes', 'user_id'], ['oauth_refresh_tokens', 'user_id'], ['oauth_tokens', 'user_id'],
  ['oauth_consents', 'user_id'], ['settings', 'user_id'], ['sessions', 'user_id'], ['comments', 'created_by'],
] as const;
const detached = [
  ['oauth_clients', 'owner_user_id'], ['revoked_tokens', 'user_id'], ['workspaces', 'owner_user_id'],
  ['llm_provider_accounts', 'owner_user_id'],
  ['comments', 'assigned_to'], ['plans', 'owner_user_id'], ['plans', 'created_by_user_id'],
  ['todos', 'owner_user_id'], ['todos', 'created_by_user_id'], ['tasks', 'assignee_user_id'], ['tasks', 'created_by_user_id'],
  ['agent_definitions', 'created_by_user_id'], ['workflow_definitions', 'created_by_user_id'], ['guardrails', 'created_by_user_id'],
] as const;
const historical = new Set(['execution_events.actor_id']);
const referenceColumns = [...new Set([...deleted, ...detached].map(([table, column]) => `${table}.${column}`))];

/** Refuse newly added person references until their business disposition is reviewed. */
export async function assertCmBusinessReferenceInventory(tx: CmIdentityTransaction): Promise<void> {
  const result = await tx.hostTransaction.query<{ table_name: string; column_name: string }>(`
    SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = 'public'
      AND column_name IN ('user_id','owner_user_id','created_by_user_id','assignee_user_id','created_by','assigned_to','actor_id')`);
  for (const row of result.rows) {
    const key = `${row.table_name}.${row.column_name}`;
    if (!referenceColumns.includes(key) && !historical.has(key)) {
      throw new IdentityCustodyErrorV1('identity_cascade_participant_missing');
    }
  }
}

export async function deleteCmBusinessSubjectReferences(userId: string, tx: CmIdentityTransaction) {
  const deletedByTable: Record<string, number> = {}, detachedByTable: Record<string, number> = {};
  for (const [table, column] of deleted) {
    const personalScope = table === 'llm_provider_accounts' ? " AND scope = 'user'" : '';
    const result = await tx.hostTransaction.query(`DELETE FROM public."${table}" WHERE "${column}" = $1${personalScope}`, [userId]);
    deletedByTable[table] = (deletedByTable[table] ?? 0) + (result.rowCount ?? 0);
  }
  const grouped = new Map<string, string[]>();
  for (const [table, column] of detached) grouped.set(table, [...(grouped.get(table) ?? []), column]);
  for (const [table, columns] of grouped) {
    const assignments = columns.map(column => `"${column}" = CASE WHEN "${column}" = $1 THEN NULL ELSE "${column}" END`).join(', ');
    const predicate = columns.map(column => `"${column}" = $1`).join(' OR ');
    const result = await tx.hostTransaction.query(`UPDATE public."${table}" SET ${assignments} WHERE ${predicate}`, [userId]);
    detachedByTable[table] = (detachedByTable[table] ?? 0) + (result.rowCount ?? 0);
  }
  return { deletedByTable, detachedByTable };
}

export async function assertNoCmBusinessSubjectReferences(userId: string, tx: CmIdentityTransaction): Promise<void> {
  for (const [table, column] of [...deleted, ...detached]) {
    const result = await tx.hostTransaction.query(`SELECT 1 FROM public."${table}" WHERE "${column}" = $1 LIMIT 1`, [userId]);
    if (result.rows.length) throw new IdentityCustodyErrorV1('identity_material_invalid');
  }
}
