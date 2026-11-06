import type { PoolClient } from 'pg';
import { readMigrationFiles } from 'drizzle-orm/migrator';
import { identityCustodySchemaAssetV1 } from '@sentropic/cluster-mesh';
import { loadCmCutoverCheckpoint } from '../services/identity/cm-cutover-checkpoint';
import { connectorCustodyAssetSha256 } from '../services/identity/cm-connector-custody-values';
import { a4MappingAssetSha256 } from '../services/identity/cm-import-manifest';
import { getWebAuthnConfig } from '../services/webauthn-config';
import { canonical, custody, protectedJson, requestSchema, sha256 } from './cm-preprod-contract';

export async function verifyPreprod(client: PoolClient) {
  const request = requestSchema.parse(await protectedJson(`${custody}/request.json`));
  const rp = getWebAuthnConfig();
  const checkpoint = await loadCmCutoverCheckpoint(`${custody}/checkpoint.json`, {
    mappingSha256: a4MappingAssetSha256({ rpId: rp.rpID, origins: typeof rp.origin === 'string' ? [rp.origin] : [...rp.origin] }),
    identityAssetSha256: identityCustodySchemaAssetV1('postgres').assetSha256,
    connectorAssetSha256: connectorCustodyAssetSha256,
  });
  if (checkpoint.candidateCommit !== request.candidateCommit || checkpoint.purpose !== 'cutover') throw new Error('candidate_mismatch');
  const migration = readMigrationFiles({ migrationsFolder: './drizzle/control' }).find(row => row.folderMillis === 1793577600000);
  if (!migration) throw new Error('migration_missing');
  await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  try {
    await client.query("SET LOCAL statement_timeout = '30000'");
    for (const table of ['public.__drizzle_control_migrations', 'control.app_cm_identity_cutover', 'cm_identity.identity_import_receipts']) {
      const relation = await client.query('SELECT to_regclass($1) AS relation', [table]);
      if (!relation.rows[0]?.relation) throw new Error('evidence_missing');
    }
    const journal = await client.query('SELECT hash FROM public.__drizzle_control_migrations WHERE created_at = 1793577600000');
    if (journal.rows.length !== 1 || journal.rows[0].hash !== migration.hash) throw new Error('journal_invalid');
    const pre = await client.query(`SELECT detail->>'candidateCommit' AS candidate,
      detail->>'sourceSnapshotDigest' AS source, detail->>'rehearsalReceiptRef' AS rehearsal,
      detail->>'remoteSnapshotDigest' AS remote, detail->>'mappingSha256' AS mapping,
      detail->'importReceipt'->>'manifestDigest' AS manifest
      FROM control.app_cm_identity_cutover WHERE cutover_id='a4-identity-cutover' AND phase='pre-deletion-checkpoint'`);
    const before = pre.rows[0];
    if (pre.rows.length !== 1 || before.candidate !== checkpoint.candidateCommit || before.source !== checkpoint.sourceSnapshotDigest
      || before.remote !== checkpoint.remoteSnapshotDigest || before.mapping !== checkpoint.mappingSha256
      || before.rehearsal !== checkpoint.rehearsalReceiptRef || !/^[a-f0-9]{64}$/.test(before.manifest)) throw new Error('d11_invalid');
    const imported = await client.query(`SELECT receipt_json::jsonb->>'sourceSnapshotDigest' AS source,
      receipt_json::jsonb->>'manifestDigest' AS manifest, receipt_json::jsonb->>'migrationId' AS migration,
      receipt_json::jsonb->>'verificationMaterialPreserved' AS verification,
      receipt_json::jsonb->>'identitiesPreserved' AS identities, receipt_json::jsonb->>'lifecyclePreserved' AS lifecycle
      FROM cm_identity.identity_import_receipts WHERE migration_id='0015_app_cm_identity_cutover'`);
    const receipt = imported.rows[0];
    if (imported.rows.length !== 1 || receipt.source !== before.source || receipt.manifest !== before.manifest
      || receipt.migration !== '0015_app_cm_identity_cutover'
      || [receipt.verification, receipt.identities, receipt.lifecycle].some(value => value !== 'true')) throw new Error('receipt_invalid');
    const post = await client.query(`SELECT detail->>'legacy_tables_dropped' AS dropped
      FROM control.app_cm_identity_cutover WHERE cutover_id='a4-identity-cutover-completed' AND phase='post-deletion-attestation'`);
    const legacy = await client.query("SELECT to_regclass('public.users') AS relation");
    if (post.rows.length !== 1 || post.rows[0].dropped !== 'true' || legacy.rows[0].relation !== null) throw new Error('deletion_unverified');
    return sha256(canonical({ candidate: checkpoint.candidateCommit, journal: migration.hash,
      source: before.source, remote: before.remote, manifest: before.manifest, d11: true, legacyDropped: true }));
  } finally { await client.query('ROLLBACK'); }
}

export async function runCmPreprodVerification() {
  const { pool } = await import('../db/client');
  try {
    const client = await pool.connect();
    try { process.stdout.write(`verificationSha256=${await verifyPreprod(client)}\n`); } finally { client.release(); }
  } catch { process.stderr.write(`failureSha256=${sha256('preprod-a4-verification-failed')}\n`); process.exitCode = 1; }
  finally { await pool.end(); }
}
