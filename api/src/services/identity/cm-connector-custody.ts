import { randomUUID } from 'node:crypto';
import { IdentityCustodyErrorV1, type ConnectorRevocationCustodyPortV1 } from '@sentropic/cluster-mesh';
import type { PoolClient } from 'pg';
import type { CmIdentityTransaction } from './cm-transaction';
import { readConnectorCapability, sealConnectorCapability, type ConnectorCustodyEnvelope } from './cm-connector-envelope';
import { connectorCustodyAssertions, readConnectorEnvelope } from './cm-connector-custody-records';
import { invalidConnectorCustody, readSourceConnectorCapability, requireConnectorProvider } from './cm-connector-custody-values';

type Port = ConnectorRevocationCustodyPortV1<PoolClient>;
type Capture = Parameters<Port['capture']>[0];
export interface ConnectorSourceScope {
  readonly id: string; readonly userId: string; readonly workspaceId: string; readonly provider: string;
}
export type ConnectorCaptureScopeAssertion = (source: ConnectorSourceScope, input: Capture, tx: CmIdentityTransaction) => Promise<void>;

const captured = (envelope: ConnectorCustodyEnvelope) => ({ kind: 'captured' as const, reference: {
  custodyRef: envelope.custodyRef, deliveryId: envelope.deliveryId, connectorAccountId: envelope.connectorAccountId,
  provider: envelope.provider, createdAt: envelope.createdAt,
} });

/** Scope assertion comes from this attempt's guarded deletion plan or protected import inventory. */
export function createAppConnectorCustody(assertCaptureScope: ConnectorCaptureScopeAssertion): Port {
  return {
    ...connectorCustodyAssertions,
    async capture(input, tx) {
      if (tx.mode !== 'write' || tx.profile !== 'postgres') throw new IdentityCustodyErrorV1('identity_transaction_unbound');
      const result = await tx.hostTransaction.query<{
        id: string; user_id: string; workspace_id: string; provider: string; token_secret: string | null;
      }>(`SELECT id, user_id, workspace_id, provider, token_secret FROM public.document_connector_accounts
        WHERE id = $1 FOR UPDATE`, [input.connectorAccountId]);
      const row = result.rows[0];
      if (!row) throw new IdentityCustodyErrorV1('identity_revocation_custody_missing');
      if (row.user_id !== input.subjectId) return invalidConnectorCustody();
      requireConnectorProvider(row.provider);
      await assertCaptureScope({ id: row.id, userId: row.user_id, workspaceId: row.workspace_id, provider: row.provider }, input, tx);
      const plaintext = readSourceConnectorCapability(row.token_secret);
      if (plaintext === null) return { kind: 'no_capability' };
      try {
        const compare = (existing: ConnectorCustodyEnvelope) => {
          if (existing.deliveryId !== input.deliveryId || existing.connectorAccountId !== row.id || existing.provider !== row.provider
            || !readConnectorCapability(existing, bytes => bytes.equals(plaintext))) {
            throw new IdentityCustodyErrorV1('identity_operation_conflict');
          }
          return captured(existing);
        };
        const existing = await readConnectorEnvelope(input.deliveryId, tx);
        if (existing) return compare(existing);
        const envelope = sealConnectorCapability({ custodyRef: randomUUID(), deliveryId: input.deliveryId,
          connectorAccountId: row.id, provider: row.provider, keyRef: 'secret-crypto:v1' }, plaintext, input.at);
        await tx.hostTransaction.query(`INSERT INTO control.connector_revocation_custody
          (custody_ref, delivery_id, connector_account_id, provider, envelope_version, key_ref, nonce, ciphertext, auth_tag, created_at)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT (delivery_id) DO NOTHING`, [envelope.custodyRef,
          envelope.deliveryId, envelope.connectorAccountId, envelope.provider, envelope.envelopeVersion,
          envelope.keyRef, envelope.nonce, envelope.ciphertext, envelope.authTag, envelope.createdAt]);
        const stored = await readConnectorEnvelope(input.deliveryId, tx);
        if (!stored) throw new IdentityCustodyErrorV1('identity_revocation_custody_missing');
        return compare(stored);
      } finally { plaintext.fill(0); }
    },
  };
}
