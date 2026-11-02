import { createHash, randomUUID } from 'node:crypto';
import { applyPostgresIdentityCustodySchemaV1, bindPostgresIdentityTransactionV1, createIdentityCustodyImporterV1,
  identityA22PostgresDdl, identityEnforcementPgSchema, identitySchemaStatements, IdentityCustodyErrorV1,
  type IdentityImportBatchV1, type PostgresIdentityBindingV1 } from '@sentropic/cluster-mesh';
import type { PoolClient } from 'pg';
import { A4_IDENTITY_MIGRATION_ID, type AppCmCutoverConfiguration } from './cm-cutover-config';
import { cmCutoverCheckpointReceipt } from './cm-cutover-checkpoint';
import { connectorCustodyDdl } from './cm-connector-custody-values';
import { prepareA4ConnectorImport } from './cm-import-connectors';
import { readA4MetadataInvitations } from './cm-import-invitations';
import { a4CheckpointHistoricalFields } from './cm-import-manifest';
import { importLegacyRemoteIntents } from './cm-import-remote';
import { reconcileA4RemoteSnapshot } from './cm-import-remote-snapshot';
import { mapA4IdentitySource, readA4IdentitySource } from './cm-import-source';
import { invalidA4Import } from './cm-import-values';
import { cmIdentityUnitOfWork } from './cm-transaction';
import { rebindA4BusinessReferences } from './cm-cutover-references';

/** One caller-owned SERIALIZABLE transaction: schema, capture, typed import and D11 evidence. */
export async function importAppCmIdentityInTransaction(client: PoolClient, config: AppCmCutoverConfiguration): Promise<void> {
  const state = await client.query('SHOW transaction_isolation');
  if (state.rows[0]?.transaction_isolation !== 'serializable') throw new IdentityCustodyErrorV1('identity_transaction_unbound');
  await client.query("SELECT set_config('statement_timeout', '30000', true)");
  const source = await readA4IdentitySource(client);
  const importedAt = new Date().toISOString();
  const remote = reconcileA4RemoteSnapshot(source.rows.get('user_sessions') ?? invalidA4Import(), config.remoteSnapshot, importedAt);
  await client.query(`CREATE TABLE IF NOT EXISTS control.app_cm_identity_cutover (
    cutover_id text PRIMARY KEY, phase text NOT NULL, detail jsonb NOT NULL, recorded_at timestamptz NOT NULL DEFAULT now())`);
  await client.query(`INSERT INTO control.app_cm_identity_cutover (cutover_id, phase, detail)
    VALUES ('a4-identity-cutover', 'pre-deletion-checkpoint', $1::jsonb)`, [JSON.stringify({
    ...cmCutoverCheckpointReceipt(config.checkpoint), sourceInventory: source.inventory,
    historicalFields: a4CheckpointHistoricalFields, remoteInventory: remote.inventory, sourceKeyState: config.sourceKeyState,
  })]);
  const binding: PostgresIdentityBindingV1<PoolClient> = { transactionId: randomUUID(), hostTransaction: client,
    readOnly: false, session: { async execute(statement) {
      const result = await client.query(statement.text, [...statement.values ?? []]);
      return { rows: result.rows, rowCount: result.rowCount };
    } } };
  await client.query('CREATE SCHEMA IF NOT EXISTS cm_identity');
  // Use merged schema statements; the old A2.2 helper's transaction wrapper cannot nest here.
  const tenancy = identityA22PostgresDdl('cm_identity');
  if (!tenancy.startsWith('BEGIN;\n') || !tenancy.endsWith('\nCOMMIT;')) throw new IdentityCustodyErrorV1('identity_contract_unavailable');
  await client.query(tenancy.slice('BEGIN;\n'.length, -'\nCOMMIT;'.length));
  await client.query('SET LOCAL search_path = public');
  for (const statement of identityEnforcementPgSchema('cm_identity')) await client.query(statement);
  for (const statement of identitySchemaStatements('postgres', 'cm_identity')) await client.query(statement);
  await applyPostgresIdentityCustodySchemaV1({ schema: 'cm_identity', binding,
    expectedAssetSha256: config.identityAsset.assetSha256, appliedAt: importedAt });
  await client.query(connectorCustodyDdl);
  const tx = bindPostgresIdentityTransactionV1({ schema: 'cm_identity', binding });
  const connectors = await prepareA4ConnectorImport(tx, importedAt);
  const oldInvitations = await readA4MetadataInvitations(tx);
  const pendingRemote = await importLegacyRemoteIntents(tx, importedAt, async sessionId =>
    remote.ownersBySessionId.get(sessionId) ?? (await tx.stores.sessions.findSession(sessionId))?.userId ?? null);
  const rows = [...await mapA4IdentitySource(source, { ...config.verifier, importedAt,
    ticketTokens: config.tokens.ticketTokens, remotelyRevokedSessionIds: remote.revokedSessionIds }),
  ...oldInvitations, ...pendingRemote.rows, ...connectors.rows];
  const manifestDigest = createHash('sha256').update(JSON.stringify({ mappingSha256: config.mappingSha256,
    sourceInventory: source.inventory, remoteInventory: remote.inventory, connectorInventory: connectors.counts,
    // Protected aggregate comparison only; no per-row fingerprint is published.
    rows: rows.map(row => JSON.stringify(row)).sort(), legacyRemoteKeys: pendingRemote.sourceKeys,
  })).digest('hex');
  const batch: IdentityImportBatchV1 = { contractVersion: '1.1.0', migrationId: A4_IDENTITY_MIGRATION_ID,
    sourceSnapshotRef: config.checkpoint.sourceSnapshotRef, sourceSnapshotDigest: config.checkpoint.sourceSnapshotDigest,
    manifestDigest, importedAt, rows, legacyConnectorSourceEventIds: connectors.sourceEventIds };
  const importer = createIdentityCustodyImporterV1({ unitOfWork: cmIdentityUnitOfWork, connectorCustody: connectors.custody,
    fence: { async assertExclusiveWriter(snapshotRef) {
      if (snapshotRef !== config.checkpoint.sourceSnapshotRef || !config.checkpoint.legacyWritersStopped
        || !config.checkpoint.remoteFileWriterStopped) return invalidA4Import();
    } }, importOptions: { mode: 'write', purpose: 'import', deadlineMs: 30000, maxAttempts: 1 },
    validationOptions: { mode: 'read', purpose: 'import', deadlineMs: 30000, maxAttempts: 1 } });
  // The CM importer itself verifies every captured pending connector before writing its receipt.
  const receipt = await importer.importBatchInTransaction(batch, tx);
  if (receipt.migrationId !== batch.migrationId || receipt.sourceSnapshotDigest !== batch.sourceSnapshotDigest
    || receipt.manifestDigest !== manifestDigest) return invalidA4Import();
  await client.query(`UPDATE control.app_cm_identity_cutover SET detail = detail || $1::jsonb
    WHERE cutover_id = 'a4-identity-cutover'`, [JSON.stringify({ importReceipt: receipt, manifestDigest,
    legacyRemoteIntentCount: pendingRemote.sourceKeys.length, legacyConnectorInventory: connectors.counts })]);
  const invitationIds = oldInvitations.map(row => row.entity === 'invitation' ? row.record.invitationId : invalidA4Import());
  await client.query('DELETE FROM cm_identity.identity_invitations WHERE invitation_id = ANY($1::text[])', [invitationIds]);
  await client.query('DELETE FROM public.settings WHERE key = ANY($1::text[]) AND user_id IS NULL', [pendingRemote.sourceKeys]);
  await rebindA4BusinessReferences(client);
  await client.query("SELECT set_config('app.a4_import_manifest_digest', $1, true)", [receipt.manifestDigest]);
}
