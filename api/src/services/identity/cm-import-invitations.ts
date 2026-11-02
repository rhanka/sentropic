import { createHash } from 'node:crypto';
import type { IdentityImportRowV1 } from '@sentropic/cluster-mesh';
import type { CmIdentityTransaction } from './cm-transaction';
import { sourceChoice, sourceNullableTime, sourceText } from './cm-import-values';

export async function readA4MetadataInvitations(tx: CmIdentityTransaction): Promise<IdentityImportRowV1[]> {
  const result = await tx.hostTransaction.query('SELECT * FROM cm_identity.identity_invitations ORDER BY invitation_id COLLATE "C" FOR UPDATE');
  return result.rows.map(row => ({ entity: 'invitation', record: {
    invitationId: sourceText(row.invitation_id), email: sourceText(row.email).trim().toLowerCase(),
    ...(row.tenant_id === null ? {} : { tenantId: sourceText(row.tenant_id) }),
    ...(row.workspace_id === null ? {} : { workspaceId: sourceText(row.workspace_id) }),
    tokenHash: createHash('sha256').update(sourceText(row.token)).digest('hex'), clientId: null,
    status: sourceChoice(row.status, ['pending', 'consumed', 'revoked']), expiresAt: sourceText(row.expires_at),
    createdAt: null, consumedAt: sourceNullableTime(row.consumed_at), consumedByUserId: null, revision: 0,
  } }));
}
