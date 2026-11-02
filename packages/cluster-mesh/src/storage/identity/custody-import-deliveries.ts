import { createHash } from 'node:crypto';
import type { IdentityImportBatchV1, IdentityExternalRevocationV1 } from '../../identity-contracts/custody.js';
import type { CustodyOpHost } from './custody-host.js';
import { boundIdentitySql } from './custody-transaction-ports.js';

export const identityDeliveryId = (operationId: string, step: string, targetKind: string, targetRef: string): string =>
  createHash('sha256').update(JSON.stringify(['A2.0b-delivery', operationId, step, targetKind, targetRef])).digest('hex');

export const validLegacyConnectorInventory = (batch: IdentityImportBatchV1): boolean => {
  const ids = batch.legacyConnectorSourceEventIds;
  if (!Array.isArray(ids) || ids.some((id, i) => !id || (i > 0 && Buffer.compare(Buffer.from(ids[i - 1]), Buffer.from(id)) >= 0))) return false;
  const tombstones = batch.rows.filter((row) => row.entity === 'legacy_connector_tombstone').map((row) => row.record);
  if (tombstones.length !== ids.length || new Set(tombstones.map((row) => row.sourceEventId)).size !== ids.length) return false;
  if (tombstones.some((row) => !ids.includes(row.sourceEventId))) return false;
  const deliveries = batch.rows.filter((row) => row.entity === 'revocation_delivery').map((row) => row.record);
  if (new Set(deliveries.map((row) => row.deliveryId)).size !== deliveries.length) return false;
  for (const row of tombstones) {
    if (!row.connectorAccountId || !row.provider || !Number.isFinite(Date.parse(row.importedAt))) return false;
    if (row.disposition === 'unresolved') { if (row.deliveryId !== null || row.evidenceRef !== null) return false; }
    else if (row.disposition === 'acknowledged') { if (row.deliveryId !== null || !row.evidenceRef) return false; }
    else if (row.disposition === 'queued') {
      const delivery = deliveries.find((item) => item.deliveryId === row.deliveryId);
      const operationId = createHash('sha256').update(JSON.stringify(['legacy-connector-revoke', row.sourceEventId])).digest('hex');
      if (!delivery || !row.subjectId || row.evidenceRef !== null || delivery.state !== 'pending'
        || delivery.operationId !== operationId || delivery.step !== 'connector_grants' || delivery.targetKind !== 'connector_grant'
        || delivery.targetRef !== row.connectorAccountId || delivery.subjectId !== row.subjectId || !delivery.custodyRef
        || delivery.deliveryId !== identityDeliveryId(operationId, delivery.step, delivery.targetKind, delivery.targetRef)) return false;
    } else return false;
  }
  return deliveries.every((row) => row.deliveryId === identityDeliveryId(row.operationId, row.step, row.targetKind, row.targetRef)
    && !!row.subjectId && !!row.targetRef && (row.targetKind !== 'connector_grant' || !!row.custodyRef));
};

export const importRevocationDelivery = async (host: CustodyOpHost, record: IdentityExternalRevocationV1): Promise<void> => {
  const sql = boundIdentitySql(host);
  await sql.query(`INSERT INTO ${sql.table('identity_revocation_outbox')} (delivery_id,operation_id,step,subject_id,target_kind,target_ref,custody_ref,state,created_at,next_attempt_at,delivered_at,claim_owner,lease_until,claim_version,attempt_count) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [record.deliveryId,record.operationId,record.step,record.subjectId,record.targetKind,record.targetRef,record.custodyRef,record.state,record.createdAt,record.nextAttemptAt,record.deliveredAt,record.claimOwner,record.leaseUntil,record.claimVersion,record.attemptCount]);
};
