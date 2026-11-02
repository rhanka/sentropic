import { IdentityCustodyErrorV1, type IdentityExternalRevocationV1,
  type IdentityRevocationClaimV1 } from '@sentropic/cluster-mesh';
import { tombstoneRemoteSessions } from '../auth/remote-revocation';
import { revokeGoogleOAuthToken } from '../google-drive-oauth';
import { cmIdentityUnitOfWork } from './cm-transaction';
import { assertConnectorEnvelopeTuple, connectorCustodyAssertions, readConnectorEnvelope } from './cm-connector-custody-records';
import { readConnectorCapability } from './cm-connector-envelope';
import { requireConnectorProvider, validateConnectorCapability } from './cm-connector-custody-values';

const tuple = (record: IdentityExternalRevocationV1) => JSON.stringify([
  record.deliveryId, record.operationId, record.step, record.subjectId, record.targetKind,
  record.targetRef, record.custodyRef, record.createdAt,
]);

export async function deliverCmRevocation(claim: IdentityRevocationClaimV1): Promise<void> {
  const snapshot = await cmIdentityUnitOfWork.run({ mode: 'write', purpose: 'delivery', deadlineMs: 5_000, maxAttempts: 3 }, async tx => {
    const record = await tx.revocationOutbox.find(claim.record.deliveryId);
    if (!record || record.state !== 'pending' || tuple(record) !== tuple(claim.record)
      || record.claimOwner !== claim.workerId || record.claimVersion !== claim.claimVersion
      || !record.leaseUntil || record.leaseUntil <= new Date().toISOString()) {
      throw new IdentityCustodyErrorV1('identity_delivery_claim_conflict');
    }
    if (record.step !== 'connector_grants') return { record, envelope: null };
    await connectorCustodyAssertions.assertCaptured(record, tx);
    const envelope = await readConnectorEnvelope(record.deliveryId, tx);
    if (!envelope) throw new IdentityCustodyErrorV1('identity_revocation_custody_missing');
    return { record, envelope };
  });
  const { record, envelope } = snapshot;
  if (record.step === 'remote_reader_sessions' && record.custodyRef === null) {
    if (record.targetKind === 'subject' && record.targetRef === record.subjectId) {
      await tombstoneRemoteSessions({ sessionIds: [], userId: record.subjectId });
      return;
    }
    if (record.targetKind === 'login_session') {
      await tombstoneRemoteSessions({ sessionIds: [record.targetRef] });
      return;
    }
  }
  if (record.step === 'connector_grants' && envelope) {
    assertConnectorEnvelopeTuple(record, envelope);
    requireConnectorProvider(envelope.provider);
    const capability = readConnectorCapability(envelope, validateConnectorCapability);
    const result = await revokeGoogleOAuthToken({ token: capability.token });
    if (!result.revoked) throw new IdentityCustodyErrorV1('identity_revocation_custody_invalid');
    return;
  }
  throw new IdentityCustodyErrorV1('identity_cascade_participant_missing');
}
