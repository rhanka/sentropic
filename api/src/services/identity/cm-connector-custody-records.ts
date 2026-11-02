import { IdentityCustodyErrorV1, type IdentityExternalRevocationV1 } from '@sentropic/cluster-mesh';
import type { CmIdentityTransaction } from './cm-transaction';
import { readConnectorCapability, type ConnectorCustodyEnvelope } from './cm-connector-envelope';
import { decodeConnectorEnvelope, invalidConnectorCustody, validateConnectorCapability } from './cm-connector-custody-values';

export const readConnectorEnvelope = async (deliveryId: string, tx: CmIdentityTransaction): Promise<ConnectorCustodyEnvelope | null> => {
  const result = await tx.hostTransaction.query(`SELECT custody_ref, delivery_id, connector_account_id, provider,
    envelope_version, key_ref, nonce, ciphertext, auth_tag, created_at
    FROM control.connector_revocation_custody WHERE delivery_id = $1`, [deliveryId]);
  return result.rows[0] ? decodeConnectorEnvelope(result.rows[0]) : null;
};

const immutableTuple = (record: IdentityExternalRevocationV1) => JSON.stringify([
  record.deliveryId, record.operationId, record.step, record.subjectId,
  record.targetKind, record.targetRef, record.custodyRef, record.createdAt,
]);
const requireRecord = async (record: IdentityExternalRevocationV1, tx: CmIdentityTransaction,
  state: 'pending' | 'delivered') => {
  if (tx.mode !== 'write' || tx.profile !== 'postgres') throw new IdentityCustodyErrorV1('identity_transaction_unbound');
  if (record.targetKind !== 'connector_grant' || record.step !== 'connector_grants' || !record.custodyRef
    || record.state !== state) return invalidConnectorCustody();
  const current = await tx.revocationOutbox.find(record.deliveryId);
  if (!current || current.state !== state || immutableTuple(current) !== immutableTuple(record)) return invalidConnectorCustody();
};

export const assertConnectorEnvelopeTuple = (record: IdentityExternalRevocationV1, envelope: ConnectorCustodyEnvelope): void => {
  if (envelope.custodyRef !== record.custodyRef || envelope.deliveryId !== record.deliveryId
    || envelope.connectorAccountId !== record.targetRef) invalidConnectorCustody();
  readConnectorCapability(envelope, bytes => { validateConnectorCapability(bytes); });
};

export const connectorCustodyAssertions = {
  async assertCaptured(record: IdentityExternalRevocationV1, tx: CmIdentityTransaction): Promise<void> {
    await requireRecord(record, tx, 'pending');
    const envelope = await readConnectorEnvelope(record.deliveryId, tx);
    if (!envelope) throw new IdentityCustodyErrorV1('identity_revocation_custody_missing');
    assertConnectorEnvelopeTuple(record, envelope);
  },
  async eraseAcknowledged(record: IdentityExternalRevocationV1, tx: CmIdentityTransaction): Promise<void> {
    await requireRecord(record, tx, 'delivered');
    const envelope = await readConnectorEnvelope(record.deliveryId, tx);
    if (!envelope) return; // An acknowledged replay cannot resurrect erased capability.
    assertConnectorEnvelopeTuple(record, envelope);
    const result = await tx.hostTransaction.query(`DELETE FROM control.connector_revocation_custody
      WHERE custody_ref = $1 AND delivery_id = $2`, [record.custodyRef, record.deliveryId]);
    if (result.rowCount !== 1) throw new IdentityCustodyErrorV1('identity_revocation_custody_missing');
  },
};
