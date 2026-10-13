// K1 read boundaries and continuation (L3a v4.1 frozen §8). Three separate
// lifetimes: authority, continuation identity, retention/pin. Data-pure.

import {
  decodeCompoundKey,
  encodeCompoundKey,
  errResult,
  isIsoDateString,
  isNonEmptyString,
  isPositiveSafeInteger,
  isStorageModuleId,
  okResult,
  validatePageLimits,
  validateStorageScope,
  validateStoreIncarnation,
  type PageLimits,
  type StorageModuleId,
  type StorageScope,
  type ValidationResult,
} from './contracts.js';

export interface ChainCursorV1 {
  readonly formatVersion: 1;
  readonly moduleId: StorageModuleId;
  readonly scope: StorageScope;
  readonly incarnation: string;
  readonly selection: string;
  readonly head: string;
  readonly ordering: 'seq-asc';
  readonly position: string;
}

export const encodeChainCursor = (cursor: ChainCursorV1): string => {
  const raw = encodeCompoundKey([
    'chain-cursor',
    'v1',
    cursor.moduleId,
    cursor.scope.tenantId,
    cursor.scope.workspaceId,
    cursor.incarnation,
    cursor.selection,
    cursor.head,
    cursor.ordering,
    cursor.position,
  ]);
  return Buffer.from(raw, 'utf8').toString('base64url');
};

export const decodeChainCursor = (cursor: unknown): ChainCursorV1 | null => {
  if (typeof cursor !== 'string' || cursor.length === 0) return null;
  try {
    const raw = Buffer.from(cursor, 'base64url').toString('utf8');
    const parts = decodeCompoundKey(raw);
    if (!parts || parts.length !== 10 || parts[0] !== 'chain-cursor' || parts[1] !== 'v1') return null;
    const [, , moduleId, tenantId, workspaceId, incarnation, selection, head, ordering, position] = parts;
    if (!isStorageModuleId(moduleId)) return null;
    const scope = validateStorageScope({ tenantId, workspaceId });
    if (!scope.ok) return null;
    if (validateStoreIncarnation(incarnation).ok === false) return null;
    if (!isNonEmptyString(selection) || !isNonEmptyString(head)) return null;
    if (ordering !== 'seq-asc' || !isNonEmptyString(position)) return null;
    return {
      formatVersion: 1,
      moduleId,
      scope: { tenantId, workspaceId },
      incarnation,
      selection,
      head,
      ordering: 'seq-asc',
      position,
    };
  } catch {
    return null;
  }
};

export interface PageRequest {
  readonly limit: number;
  readonly cursor: string | null;
}

export const validatePageRequest = (request: PageRequest, limits?: PageLimits): ValidationResult => {
  const errors: string[] = [];
  if (!isPositiveSafeInteger(request.limit)) errors.push('limit must be a positive safe integer');
  if (request.cursor !== null && !isNonEmptyString(request.cursor)) errors.push('cursor must be null or non-empty');
  if (limits) {
    const validity = validatePageLimits(limits);
    if (!validity.ok) return validity;
    if (request.limit > limits.maxRecords) errors.push('limit exceeds maxRecords');
  }
  return errors.length === 0 ? okResult() : errResult(...errors);
};

export const READ_PAGE_OUTCOMES = ['page', 'incomplete', 'inaccessible'] as const;
export type ReadPageOutcome = (typeof READ_PAGE_OUTCOMES)[number];

export interface PageRecord {
  readonly id: string;
  readonly seq: number;
  readonly hash: string;
  readonly bytes: string;
}

export interface ReadPage {
  readonly outcome: ReadPageOutcome;
  readonly records: readonly PageRecord[];
  readonly nextCursor: string | null;
}

export const validateReadPage = (page: ReadPage, limits?: PageLimits): ValidationResult => {
  const errors: string[] = [];
  if (!READ_PAGE_OUTCOMES.includes(page.outcome)) errors.push('unknown page outcome');
  if (page.outcome === 'page' && page.records.length === 0 && page.nextCursor !== null) {
    errors.push('a successful empty page must not promise a next page');
  }
  if (limits) {
    const validity = validatePageLimits(limits);
    if (!validity.ok) return validity;
    if (page.records.length > limits.maxRecords) errors.push('page exceeds maxRecords');
    if (page.records.length > 0) {
      const encoded = Buffer.byteLength(JSON.stringify(page), 'utf8');
      if (encoded > limits.maxEncodedBytes) errors.push('page exceeds maxEncodedBytes');
      for (const record of page.records) {
        const single = Buffer.byteLength(
          JSON.stringify({ outcome: 'page', records: [record], nextCursor: null }),
          'utf8',
        );
        if (single > limits.maxEncodedBytes) {
          errors.push('an indivisible record that cannot fit yields incomplete');
          break;
        }
      }
    }
  }
  return errors.length === 0 ? okResult() : errResult(...errors);
};

// Immutable comments boundaries carry no clock-only expiry (§8.2): a
// retained root is reopened without TTL invalidation. An internal lease
// expiry alone never invalidates a no-expiry continuation.
export const assertNoClockOnlyExpiry = (policy: {
  readonly expiresAfterMs?: number | null;
  readonly retainedRoot?: boolean;
}): ValidationResult => {
  if (policy.expiresAfterMs != null && policy.retainedRoot === true) {
    return errResult('immutable boundaries have no clock-only expiry');
  }
  return okResult();
};

export interface LeasedSnapshot {
  readonly token: string;
  readonly queryVersion: string;
  readonly paramsHash: string;
  readonly order: string;
  readonly root: string;
  readonly incarnation: string;
  readonly expiresAt: string;
}

export const validateLeasedSnapshot = (snapshot: LeasedSnapshot, nowIso?: string): ValidationResult => {
  const errors: string[] = [];
  if (!isNonEmptyString(snapshot.token)) errors.push('lease requires a token');
  if (!isNonEmptyString(snapshot.queryVersion)) errors.push('lease requires a query version');
  if (!isNonEmptyString(snapshot.paramsHash)) errors.push('lease requires bound parameters');
  if (!isNonEmptyString(snapshot.order)) errors.push('lease requires an order');
  if (!isNonEmptyString(snapshot.root)) errors.push('lease requires a root');
  if (validateStoreIncarnation(snapshot.incarnation).ok === false) errors.push('lease requires an incarnation');
  if (!isIsoDateString(snapshot.expiresAt)) errors.push('lease requires an ISO expiry');
  else if (nowIso !== undefined) {
    if (!isIsoDateString(nowIso)) errors.push('now must be an ISO date string');
    else if (Date.parse(snapshot.expiresAt) <= Date.parse(nowIso)) errors.push('lease is expired');
  }
  return errors.length === 0 ? okResult() : errResult(...errors);
};
