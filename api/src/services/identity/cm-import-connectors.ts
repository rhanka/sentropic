import type { IdentityImportRowV1, IdentityLegacyConnectorTombstoneV1 } from '@sentropic/cluster-mesh';
import { createAppConnectorCustody, type ConnectorSourceScope } from './cm-connector-custody';
import { identityDeliveryId, identityOperationId, pendingIdentityDelivery } from './cm-delivery-record';
import { invalidA4Import, sourceText } from './cm-import-values';
import type { CmIdentityTransaction } from './cm-transaction';

/** Every historical source event is accounted for, regardless of event-bus dispatch. */
export async function prepareA4ConnectorImport(tx: CmIdentityTransaction, at: string) {
  const inventory = new Map<string, ConnectorSourceScope>();
  const custody = createAppConnectorCustody(async (source, input, active) => {
    const expected = inventory.get(input.deliveryId);
    if (active !== tx || !expected || source.id !== expected.id || source.userId !== expected.userId
      || source.workspaceId !== expected.workspaceId || source.provider !== expected.provider
      || input.workspaceIdsToDelete.length !== 0) return invalidA4Import();
  });
  const events = await tx.hostTransaction.query<{ id: string; envelope: Record<string, unknown> }>(
    `SELECT id, envelope FROM control.event_outbox
     WHERE channel = 'connector_grant_events' AND envelope->>'type' = 'connector.grant.orphaned' ORDER BY id COLLATE "C"`);
  const rows: IdentityImportRowV1[] = [];
  const counts = { queued: 0, unresolved: 0, acknowledged: 0 };
  for (const event of events.rows) {
    const connectorAccountId = sourceText(event.envelope.accountId), provider = sourceText(event.envelope.provider);
    const result = await tx.hostTransaction.query<{ id: string; user_id: string; workspace_id: string; provider: string }>(
      'SELECT id, user_id, workspace_id, provider FROM public.document_connector_accounts WHERE id = $1 FOR UPDATE', [connectorAccountId]);
    const source = result.rows[0];
    let accounting: IdentityLegacyConnectorTombstoneV1 = { sourceEventId: event.id, connectorAccountId, provider,
      subjectId: source?.user_id ?? null, disposition: 'unresolved', deliveryId: null, evidenceRef: null, importedAt: at };
    if (source) {
      if (source.provider !== provider) return invalidA4Import();
      const operationId = identityOperationId(['legacy-connector-revoke', event.id]);
      const deliveryId = identityDeliveryId(operationId, 'connector_grants', 'connector_grant', connectorAccountId);
      inventory.set(deliveryId, { id: source.id, userId: source.user_id, workspaceId: source.workspace_id, provider });
      const captured = await custody.capture({ deliveryId, connectorAccountId, subjectId: source.user_id,
        workspaceIdsToDelete: [], at }, tx);
      if (captured.kind === 'captured') {
        if (captured.reference.deliveryId !== deliveryId || captured.reference.connectorAccountId !== connectorAccountId
          || captured.reference.provider !== provider) return invalidA4Import();
        rows.push({ entity: 'revocation_delivery', record: pendingIdentityDelivery(operationId, {
          step: 'connector_grants', subjectId: source.user_id, targetKind: 'connector_grant', targetRef: connectorAccountId,
          custodyRef: captured.reference.custodyRef,
        }, at) });
        accounting = { ...accounting, disposition: 'queued', deliveryId };
      }
    }
    counts[accounting.disposition] += 1;
    rows.push({ entity: 'legacy_connector_tombstone', record: accounting });
  }
  // An event-bus acknowledgement is never promoted to provider acknowledgement.
  return { custody, rows, sourceEventIds: events.rows.map(event => event.id), counts };
}
