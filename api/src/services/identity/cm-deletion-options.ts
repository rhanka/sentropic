import { IdentityCustodyErrorV1, type IdentityRunOptionsV1 } from '@sentropic/cluster-mesh';

const readBudgetEntry = (
  record: Record<string, unknown>, name: string, mode: 'write' | 'read',
): IdentityRunOptionsV1 => {
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

const readBudgetsRecord = (source: NodeJS.ProcessEnv): Record<string, unknown> => {
  let value: unknown;
  try { value = JSON.parse(source.CM_IDENTITY_DELETION_BUDGETS_JSON ?? 'null'); }
  catch { throw new IdentityCustodyErrorV1('identity_material_invalid'); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new IdentityCustodyErrorV1('identity_material_missing');
  return value as Record<string, unknown>;
};

const requireQualificationReceipt = (record: Record<string, unknown>): void => {
  if (typeof record.qualificationReceiptRef !== 'string' || !record.qualificationReceiptRef.trim()) {
    throw new IdentityCustodyErrorV1('identity_material_invalid');
  }
};

/** Deletion budgets must come from qualification, never the request default. */
export function loadCmDeletionOptions(source: NodeJS.ProcessEnv = process.env) {
  const record = readBudgetsRecord(source);
  const keys = ['reservation', 'deletion', 'diagnostic', 'read', 'qualificationReceiptRef'];
  const names = Object.keys(record);
  // The workspace operation's entry joins the same protected JSON; the person
  // operation ignores it but must not reject a record that carries it.
  const hasWorkspace = names.includes('workspace');
  if (names.length !== keys.length + (hasWorkspace ? 1 : 0)
    || names.some(key => !keys.includes(key) && key !== 'workspace')) {
    throw new IdentityCustodyErrorV1('identity_material_invalid');
  }
  requireQualificationReceipt(record);
  return { reservation: readBudgetEntry(record, 'reservation', 'write'),
    deletion: readBudgetEntry(record, 'deletion', 'write'),
    diagnostic: readBudgetEntry(record, 'diagnostic', 'write'),
    read: readBudgetEntry(record, 'read', 'read'),
    ...(hasWorkspace ? { workspace: readBudgetEntry(record, 'workspace', 'write') } : {}) };
}

/**
 * Workspace-operation budgets (a4-cm-gaps-r2 §10.7 series 4): the same
 * protected `CM_IDENTITY_DELETION_BUDGETS_JSON` pattern, with a `workspace`
 * entry holding this operation's deletion budget. A missing or malformed
 * workspace entry refuses — never a request default.
 */
export function loadCmWorkspaceDeletionOptions(source: NodeJS.ProcessEnv = process.env): {
  readonly deletion: IdentityRunOptionsV1;
} {
  const record = readBudgetsRecord(source);
  requireQualificationReceipt(record);
  return { deletion: readBudgetEntry(record, 'workspace', 'write') };
}
