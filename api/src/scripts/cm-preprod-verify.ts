import type { PoolClient } from 'pg';
import { identityCustodySchemaAssetV1 } from '@sentropic/cluster-mesh';
import { loadCmCutoverCheckpoint } from '../services/identity/cm-cutover-checkpoint';
import { readA4CutoverEvidence } from '../services/identity/cm-cutover-evidence';
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
  await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  try {
    await client.query("SET LOCAL statement_timeout = '30000'");
    const evidence = await readA4CutoverEvidence(client);
    if (evidence.candidate !== checkpoint.candidateCommit || evidence.source !== checkpoint.sourceSnapshotDigest
      || evidence.remote !== checkpoint.remoteSnapshotDigest || evidence.mapping !== checkpoint.mappingSha256
      || evidence.rehearsal !== checkpoint.rehearsalReceiptRef) throw new Error('d11_invalid');
    return sha256(canonical({ candidate: checkpoint.candidateCommit, journal: evidence.journalHash,
      source: evidence.source, remote: evidence.remote, manifest: evidence.manifest, d11: true, legacyDropped: true }));
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
