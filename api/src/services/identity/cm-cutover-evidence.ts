import type { PoolClient } from 'pg';
import { readMigrationFiles } from 'drizzle-orm/migrator';
import { A4_CONTROL_MIGRATION_TIMESTAMP, A4_IDENTITY_MIGRATION_ID } from './cm-cutover-config';

/** Legacy identity tables dropped by control migration 0015 (`0015_app_cm_identity_cutover.sql`). */
export const a4DroppedLegacyTables = ['users', 'webauthn_credentials', 'webauthn_challenges', 'email_verification_codes',
  'magic_links', 'auth_invite_tokens', 'user_sessions', 'identities', 'tenants', 'tenant_memberships',
  'workspace_memberships'] as const;

export interface A4CutoverEvidence {
  readonly journalHash: string;
  readonly candidate: string | null;
  readonly source: string;
  readonly remote: string | null;
  readonly mapping: string | null;
  readonly rehearsal: string | null;
  readonly manifest: string;
}

const relationExists = async (client: PoolClient, relation: string): Promise<boolean> =>
  Boolean((await client.query<{ relation: string | null }>('SELECT to_regclass($1) AS relation', [relation])).rows[0]?.relation);

/** True once the A4 control migration is journaled; the boot then never re-runs the identity import. */
export async function isA4CutoverJournaled(client: PoolClient): Promise<boolean> {
  if (!await relationExists(client, 'public.__drizzle_control_migrations')) return false;
  const applied = await client.query('SELECT 1 FROM public.__drizzle_control_migrations WHERE created_at = $1',
    [A4_CONTROL_MIGRATION_TIMESTAMP]);
  return applied.rows.length > 0;
}

/** Read and cross-check the durable A4 cutover evidence: journal hash against this code revision,
 *  both D11 records, the CM import receipt and the deletion of every legacy identity table.
 *  Fail-closed; the caller owns the (read-only) transaction. */
export async function readA4CutoverEvidence(client: PoolClient): Promise<A4CutoverEvidence> {
  const migration = readMigrationFiles({ migrationsFolder: './drizzle/control' })
    .find(row => row.folderMillis === A4_CONTROL_MIGRATION_TIMESTAMP);
  if (!migration) throw new Error('migration_missing');
  for (const table of ['public.__drizzle_control_migrations', 'control.app_cm_identity_cutover', 'cm_identity.identity_import_receipts']) {
    if (!await relationExists(client, table)) throw new Error('evidence_missing');
  }
  const journal = await client.query('SELECT hash FROM public.__drizzle_control_migrations WHERE created_at = $1',
    [A4_CONTROL_MIGRATION_TIMESTAMP]);
  if (journal.rows.length !== 1 || journal.rows[0].hash !== migration.hash) throw new Error('journal_invalid');
  const pre = await client.query(`SELECT detail->>'candidateCommit' AS candidate,
    detail->>'sourceSnapshotDigest' AS source, detail->>'rehearsalReceiptRef' AS rehearsal,
    detail->>'remoteSnapshotDigest' AS remote, detail->>'mappingSha256' AS mapping,
    detail->'importReceipt'->>'manifestDigest' AS manifest
    FROM control.app_cm_identity_cutover WHERE cutover_id='a4-identity-cutover' AND phase='pre-deletion-checkpoint'`);
  const before = pre.rows[0];
  if (pre.rows.length !== 1 || !/^[a-f0-9]{64}$/.test(before.source ?? '') || !/^[a-f0-9]{64}$/.test(before.manifest ?? '')) {
    throw new Error('d11_invalid');
  }
  const imported = await client.query(`SELECT receipt_json::jsonb->>'sourceSnapshotDigest' AS source,
    receipt_json::jsonb->>'manifestDigest' AS manifest, receipt_json::jsonb->>'migrationId' AS migration,
    receipt_json::jsonb->>'verificationMaterialPreserved' AS verification,
    receipt_json::jsonb->>'identitiesPreserved' AS identities, receipt_json::jsonb->>'lifecyclePreserved' AS lifecycle
    FROM cm_identity.identity_import_receipts WHERE migration_id=$1`, [A4_IDENTITY_MIGRATION_ID]);
  const receipt = imported.rows[0];
  if (imported.rows.length !== 1 || receipt.source !== before.source || receipt.manifest !== before.manifest
    || receipt.migration !== A4_IDENTITY_MIGRATION_ID
    || [receipt.verification, receipt.identities, receipt.lifecycle].some(value => value !== 'true')) throw new Error('receipt_invalid');
  const post = await client.query(`SELECT detail->>'legacy_tables_dropped' AS dropped
    FROM control.app_cm_identity_cutover WHERE cutover_id='a4-identity-cutover-completed' AND phase='post-deletion-attestation'`);
  if (post.rows.length !== 1 || post.rows[0].dropped !== 'true') throw new Error('deletion_unverified');
  for (const table of a4DroppedLegacyTables) {
    if (await relationExists(client, `public.${table}`)) throw new Error('deletion_unverified');
  }
  return { journalHash: migration.hash, candidate: before.candidate, source: before.source, remote: before.remote,
    mapping: before.mapping, rehearsal: before.rehearsal, manifest: before.manifest };
}
