import { IdentityCustodyErrorV1, type IdentityRunOptionsV1 } from '@sentropic/cluster-mesh';

const readBudgetEntry = (
  record: Record<string, unknown>, name: string, mode: 'write' | 'read',
  purpose: 'delete' | 'import' = 'delete',
): IdentityRunOptionsV1 => {
  const entry = record[name];
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) throw new IdentityCustodyErrorV1('identity_material_invalid');
  const fields = entry as Record<string, unknown>;
  if (Object.keys(fields).length !== 2 || typeof fields.deadlineMs !== 'number'
    || !Number.isSafeInteger(fields.deadlineMs) || fields.deadlineMs < 1 || fields.deadlineMs > 600_000
    || (fields.maxAttempts !== 1 && fields.maxAttempts !== 2 && fields.maxAttempts !== 3)) {
    throw new IdentityCustodyErrorV1('identity_material_invalid');
  }
  return { mode, purpose, deadlineMs: fields.deadlineMs, maxAttempts: fields.maxAttempts };
};

/**
 * Optional budget entries beyond the person-deletion base set. The production
 * record carries them all; each loader validates the entries it consumes and
 * ignores the rest, so one protected JSON serves every qualification-gated
 * run (workspace deletion, replica export/validation/sync).
 */
const OPTIONAL_BUDGET_KEYS = ['workspace', 'replicaExport', 'replicaValidation', 'replicaSync'] as const;

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
  const extras = names.filter(key => !keys.includes(key));
  if (names.length !== keys.length + extras.length
    || extras.some(key => !(OPTIONAL_BUDGET_KEYS as readonly string[]).includes(key))) {
    throw new IdentityCustodyErrorV1('identity_material_invalid');
  }
  requireQualificationReceipt(record);
  return { reservation: readBudgetEntry(record, 'reservation', 'write'),
    deletion: readBudgetEntry(record, 'deletion', 'write'),
    diagnostic: readBudgetEntry(record, 'diagnostic', 'write'),
    read: readBudgetEntry(record, 'read', 'read'),
    ...(names.includes('workspace') ? { workspace: readBudgetEntry(record, 'workspace', 'write') } : {}) };
}

/**
 * Replica run budgets (preprod sync replacement, a4-cm-gaps-r2 §9.2): the same
 * protected `CM_IDENTITY_DELETION_BUDGETS_JSON` pattern, with `replicaExport`,
 * `replicaValidation` and `replicaSync` entries. Missing or malformed entries
 * refuse — never a request default, never a silent fallback.
 */
export function loadReplicaRunOptions(source: NodeJS.ProcessEnv = process.env): {
  readonly sync: IdentityRunOptionsV1;
  readonly validation: IdentityRunOptionsV1;
  readonly export: IdentityRunOptionsV1;
} {
  const record = readBudgetsRecord(source);
  requireQualificationReceipt(record);
  return {
    sync: readBudgetEntry(record, 'replicaSync', 'write', 'import'),
    validation: readBudgetEntry(record, 'replicaValidation', 'read', 'import'),
    export: readBudgetEntry(record, 'replicaExport', 'read', 'import'),
  };
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
