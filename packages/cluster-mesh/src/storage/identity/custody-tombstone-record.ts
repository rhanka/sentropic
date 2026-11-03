import type { IdentityLegacyConnectorTombstoneV1 } from '../../identity-contracts/custody.js';

export const decodeLegacyConnectorTombstone = (row: Record<string, unknown>): IdentityLegacyConnectorTombstoneV1 => ({
  sourceEventId: String(row['source_event_id']), connectorAccountId: String(row['connector_account_id']),
  provider: String(row['provider']), subjectId: row['subject_id'] as string | null,
  disposition: row['disposition'] as IdentityLegacyConnectorTombstoneV1['disposition'],
  deliveryId: row['delivery_id'] as string | null, evidenceRef: row['evidence_ref'] as string | null,
  importedAt: String(row['imported_at']),
});
