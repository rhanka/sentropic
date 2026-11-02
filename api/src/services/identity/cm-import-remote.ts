import { z } from 'zod';
import type { IdentityImportRowV1 } from '@sentropic/cluster-mesh';
import { invalidA4Import } from './cm-import-values';
import { identityOperationId, pendingIdentityDelivery } from './cm-delivery-record';
import type { CmIdentityTransaction } from './cm-transaction';

const id = z.string().min(1).max(256).regex(/^[A-Za-z0-9_.:-]+$/);
const intentSchema = z.object({ sessionIds: z.array(id), userId: id.optional() }).strict();
export async function mapLegacyRemoteIntent(input: {
  readonly key: string; readonly value: string; readonly at: string;
  readonly resolveSessionOwner: (sessionId: string) => Promise<string | null>;
}): Promise<IdentityImportRowV1[]> {
  let decoded: unknown;
  try { decoded = JSON.parse(input.value); } catch { return invalidA4Import(); }
  const parsed = intentSchema.safeParse(decoded);
  if (!parsed.success) return invalidA4Import();
  const intent = parsed.data, operationId = identityOperationId(['legacy-remote-revoke', input.key]);
  const rows: IdentityImportRowV1[] = [];
  for (const sessionId of [...new Set(intent.sessionIds)].sort()) {
    const owner = await input.resolveSessionOwner(sessionId);
    if (owner && intent.userId && owner !== intent.userId) return invalidA4Import();
    const subjectId = owner ?? intent.userId;
    if (!subjectId) return invalidA4Import(); // A missing historical owner requires custodian evidence.
    rows.push({ entity: 'revocation_delivery', record: pendingIdentityDelivery(operationId, {
      step: 'remote_reader_sessions', subjectId, targetKind: 'login_session', targetRef: sessionId, custodyRef: null,
    }, input.at) });
  }
  if (intent.userId) rows.push({ entity: 'revocation_delivery', record: pendingIdentityDelivery(operationId, {
    step: 'remote_reader_sessions', subjectId: intent.userId, targetKind: 'subject', targetRef: intent.userId, custodyRef: null,
  }, input.at) });
  return rows;
}

export async function importLegacyRemoteIntents(tx: CmIdentityTransaction, at: string,
  resolveSessionOwner: (sessionId: string) => Promise<string | null>) {
  const result = await tx.hostTransaction.query<{ key: string; value: string }>(`SELECT key, value FROM public.settings
    WHERE key LIKE 'remote_session_revocation:%' AND user_id IS NULL ORDER BY key`);
  const rows: IdentityImportRowV1[] = [];
  for (const intent of result.rows) rows.push(...await mapLegacyRemoteIntent({ ...intent, at, resolveSessionOwner }));
  return { rows, sourceKeys: result.rows.map(row => row.key) };
}
