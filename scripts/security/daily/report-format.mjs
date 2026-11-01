import { canonicalize, sha256Hex } from './canonical-json.mjs';

export const DEADLINE_SCHEMA = { schemaId: 'DeadlineStatusV1', schemaVersion: 1, reportKind: 'deadline-status' };
export const MAX_DEADLINE_JSON_BYTES = 4 * 1024 * 1024;
export const MAX_RECORDS = 10000;
export const MAX_STRING_BYTES = 4 * 1024;

const TOP_LEVEL_KEYS = new Set([
  'schemaId',
  'schemaVersion',
  'reportKind',
  'repositoryId',
  'repositoryName',
  'asOfUtcDate',
  'deadlineKey',
  'reportId',
  'producer',
  'status',
  'coverage',
  'measurements',
  'debt',
  'units',
  'observed',
  'publication',
]);
const FORBIDDEN_KEYS = new Set([
  'scanKey',
  'attemptOrdinal',
  'executionAdmissionId',
  'attemptKind',
  'selectedAttemptOrdinal',
]);
const ACTIVE_PATTERN = /<\s*script|javascript:|on\w+\s*=/i;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export function deriveDeadlineKey(repositoryId, asOfUtcDate) {
  return `d1:${sha256Hex(canonicalize([1, repositoryId, asOfUtcDate]))}`;
}

export function deriveReportId(payload) {
  const { reportId: _omitted, ...rest } = payload;
  return `ds1-${sha256Hex(canonicalize(rest))}`;
}

function checkStrings(value, errors, path) {
  if (typeof value === 'string') {
    if (Buffer.byteLength(value, 'utf8') > MAX_STRING_BYTES) errors.push(`${path} exceeds 4 KiB`);
    if (ACTIVE_PATTERN.test(value)) errors.push(`${path} carries active content`);
  } else if (Array.isArray(value)) {
    value.forEach((entry, index) => checkStrings(entry, errors, `${path}[${index}]`));
  } else if (value !== null && typeof value === 'object') {
    for (const [key, entry] of Object.entries(value)) checkStrings(entry, errors, `${path}.${key}`);
  }
}

export function validateDeadlineStatus(doc, { repositoryAllowlist }) {
  const errors = [];
  if (doc.schemaId !== 'DeadlineStatusV1') errors.push('schemaId must be DeadlineStatusV1');
  if (doc.schemaVersion !== 1) errors.push('schemaVersion must be 1');
  if (doc.reportKind !== 'deadline-status') errors.push('reportKind must be deadline-status');
  for (const key of Object.keys(doc)) {
    if (!TOP_LEVEL_KEYS.has(key)) errors.push(`unknown field ${key}`);
    if (FORBIDDEN_KEYS.has(key)) errors.push(`full-scan field ${key} is forbidden in a deadline record`);
  }
  if (typeof doc.repositoryId !== 'number') errors.push('numeric repositoryId is required');
  if (!repositoryAllowlist?.includes(doc.repositoryName)) errors.push('repository name must come from the allowlist');
  if (!DATE_PATTERN.test(doc.asOfUtcDate ?? '')) errors.push('asOfUtcDate must be a UTC calendar date');
  if (doc.deadlineKey !== deriveDeadlineKey(doc.repositoryId, doc.asOfUtcDate)) errors.push('deadlineKey must recompute');
  if (doc.reportId !== deriveReportId(doc)) errors.push('reportId must recompute from the payload');
  const status = doc.status ?? {};
  if (status.scanStatus !== 'incomplete-scan') errors.push('deadline path admits only incomplete-scan');
  if (status.qualifyingForAbsence !== false) errors.push('deadline record never qualifies for absence');
  if (status.fullScanPerformed !== false) errors.push('deadline record never claims a full scan');
  if (!['blocked', 'qualified-linked'].includes(status.m1Status)) errors.push('m1Status must be blocked or qualified-linked');
  const records = [...(doc.coverage ?? []), ...(doc.measurements ?? []), ...(doc.debt ?? []), ...(doc.units ?? [])];
  if (records.length > MAX_RECORDS) errors.push('record count above the bound becomes report-bound');
  if (Buffer.byteLength(JSON.stringify(doc), 'utf8') > MAX_DEADLINE_JSON_BYTES) {
    errors.push('payload above 4 MiB becomes report-bound');
  }
  const target = doc.publication?.expectedTarget ?? '';
  if (!(target === 'security-reports' || target === '')) errors.push('expected target must be security-reports');
  checkStrings(doc, errors, 'doc');
  return errors;
}

function escapeCell(text) {
  return String(text).replace(/\|/g, '\\|').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function renderDeadlineMarkdown(doc) {
  const lines = [
    `# Deadline status ${escapeCell(doc.asOfUtcDate)}`,
    '',
    '## Coverage',
    `scanStatus=${escapeCell(doc.status?.scanStatus)} m1Status=${escapeCell(doc.status?.m1Status)}`,
    '',
    '## Provenance',
    `scheduledFor=${escapeCell(doc.producer?.scheduledFor)} inventory=${escapeCell(doc.producer?.inventorySourceSha)}`,
    '',
    '## Missing gates',
    ...((doc.coverage ?? []).map((gate) => `- ${escapeCell(gate.id)}: ${escapeCell(gate.status)}`)),
    '',
    '## Debt and expiry',
    `entries=${(doc.debt ?? []).length}`,
    '',
    '## Manual assignments',
    ...((doc.units ?? []).map((unit) => `- ${escapeCell(unit.unitKey ?? unit.lotKey ?? 'unit')}`)),
    '',
    '## Admissions and merges',
    `admissions=${(doc.observed?.admissions ?? []).length} merges=${(doc.observed?.merges ?? []).length}`,
    '',
    '## Shortfall',
    escapeCell(doc.publication?.boundStatus ?? 'within-bound'),
    '',
    '## Next due',
    `nextScheduledFor=${escapeCell(doc.publication?.nextScheduledFor ?? doc.producer?.scheduledFor)}`,
    '',
  ];
  return lines.join('\n');
}
