import { IdentityCustodyErrorV1, type IdentityRunOptionsV1 } from '@sentropic/cluster-mesh';

/** Deletion budgets must come from qualification, never the request default. */
export function loadCmDeletionOptions(source: NodeJS.ProcessEnv = process.env) {
  let value: unknown;
  try { value = JSON.parse(source.CM_IDENTITY_DELETION_BUDGETS_JSON ?? 'null'); }
  catch { throw new IdentityCustodyErrorV1('identity_material_invalid'); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new IdentityCustodyErrorV1('identity_material_missing');
  const record = value as Record<string, unknown>;
  const keys = ['reservation', 'deletion', 'diagnostic', 'read', 'qualificationReceiptRef'];
  if (Object.keys(record).length !== keys.length || Object.keys(record).some(key => !keys.includes(key))
    || typeof record.qualificationReceiptRef !== 'string' || !record.qualificationReceiptRef.trim()) {
    throw new IdentityCustodyErrorV1('identity_material_invalid');
  }
  const options = (name: string, mode: 'write' | 'read'): IdentityRunOptionsV1 => {
    const entry = record[name];
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw new IdentityCustodyErrorV1('identity_material_invalid');
    const fields = entry as Record<string, unknown>;
    if (Object.keys(fields).length !== 2 || typeof fields.deadlineMs !== 'number'
      || !Number.isSafeInteger(fields.deadlineMs) || fields.deadlineMs < 1 || fields.deadlineMs > 600_000
      || (fields.maxAttempts !== 1 && fields.maxAttempts !== 2 && fields.maxAttempts !== 3)) {
      throw new IdentityCustodyErrorV1('identity_material_invalid');
    }
    return { mode, purpose: 'delete', deadlineMs: fields.deadlineMs, maxAttempts: fields.maxAttempts };
  };
  return { reservation: options('reservation', 'write'), deletion: options('deletion', 'write'),
    diagnostic: options('diagnostic', 'write'), read: options('read', 'read') };
}
