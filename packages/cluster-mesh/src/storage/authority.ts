// K1 scope, authority and L6a identity accommodation (L3a v4.1 frozen §4).
// The merged L6a triangle is consumed structurally; engram stays neutral:
// this module never imports engram-live.

import {
  errResult,
  isDecimalCounter,
  isNonEmptyString,
  isStorageModuleId,
  isStorageOperation,
  okResult,
  validateGrantLifetime,
  validateStorageScope,
  type StorageModuleId,
  type StorageOperation,
  type StorageScope,
  type ValidationResult,
} from './contracts.js';

export interface ScopeGrant<A> {
  readonly token: string;
  readonly moduleId: StorageModuleId;
  readonly scope: StorageScope;
  readonly principalId: string;
  readonly operations: readonly StorageOperation[];
  readonly issuer: string;
  readonly authorityRevision: string;
  readonly policyRevision: string;
  readonly moduleAuthority: A;
  readonly lifetime: { readonly kind: 'invocation'; readonly invocationId: string } | { readonly kind: 'lease'; readonly expiresAt: string };
}

export const validateScopeGrant = (
  grant: unknown,
  opts: { readonly expectedModuleId?: StorageModuleId; readonly nowIso?: string } = {},
): ValidationResult => {
  if (typeof grant !== 'object' || grant === null) return errResult('grant must be an object');
  const candidate = grant as Record<string, unknown>;
  if (!isNonEmptyString(candidate['token'])) return errResult('grant requires a token');
  if (!isStorageModuleId(candidate['moduleId'])) return errResult('grant requires a known module');
  if (opts.expectedModuleId !== undefined && candidate['moduleId'] !== opts.expectedModuleId) {
    return errResult('grant module mismatch');
  }
  const scope = validateStorageScope(candidate['scope']);
  if (!scope.ok) return scope;
  if (!isNonEmptyString(candidate['principalId'])) return errResult('grant requires a principal');
  if (!Array.isArray(candidate['operations']) || candidate['operations'].length === 0) {
    return errResult('grant requires at least one operation');
  }
  if (!candidate['operations'].every(isStorageOperation)) return errResult('grant carries an unknown operation');
  if (!isNonEmptyString(candidate['issuer'])) return errResult('grant requires an issuer');
  if (!isDecimalCounter(candidate['authorityRevision'])) return errResult('grant requires a decimal authorityRevision');
  if (!isDecimalCounter(candidate['policyRevision'])) return errResult('grant requires a decimal policyRevision');
  if (!('moduleAuthority' in candidate)) return errResult('grant requires a moduleAuthority field');
  return validateGrantLifetime(candidate['lifetime'], opts.nowIso);
};

export const canOperate = (grant: Pick<ScopeGrant<unknown>, 'operations'>, operation: StorageOperation): boolean =>
  grant.operations.includes(operation);

export const REVALIDATION_POINTS = [
  'bind',
  'open-reader',
  'page',
  'post-wait-commit',
  'publication',
  'purge-step',
  'retry',
] as const;
export type RevalidationPoint = (typeof REVALIDATION_POINTS)[number];

// Structural view of the merged L6a identity triangle (engram PR #359):
// exact declaration/clone/worktree ids with separate declaration and binding
// revisions plus the complete optional product triplet. Syntax only;
// derivation and authorization stay with the neutral engram contract.
export interface LiveIdentityTriangle {
  readonly declarationId: string;
  readonly cloneId: string;
  readonly worktreeId: string;
  readonly declarationRevision: number;
  readonly bindingRevision?: number;
  readonly serverWorkspaceId?: string;
  readonly serverIssuer?: string;
}

// L6a-compatible opaque identity syntax (engram-live/contracts at 70ebdfee):
// trimmed non-empty, NUL-free, prefixed. Syntax only; derivation and
// authorization stay with the neutral engram contract.
const hasNul = (value: unknown): boolean => typeof value === 'string' && value.includes('\0');

const isOpaqueIdentity = (value: unknown, prefix: string): value is string =>
  typeof value === 'string' && value.trim().length > 0 && !hasNul(value) && value.startsWith(prefix);

const isIdentityField = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0 && !hasNul(value);

export const validateLiveIdentityTriangle = (triangle: unknown): ValidationResult => {
  if (typeof triangle !== 'object' || triangle === null) return errResult('triangle must be an object');
  const candidate = triangle as Record<string, unknown>;
  if (!isOpaqueIdentity(candidate['declarationId'], 'decl:')) {
    return errResult('triangle requires a decl: declarationId');
  }
  if (!isOpaqueIdentity(candidate['cloneId'], 'clone:')) {
    return errResult('triangle requires a clone: cloneId');
  }
  if (!isOpaqueIdentity(candidate['worktreeId'], 'wt:')) {
    return errResult('triangle requires a wt: worktreeId');
  }
  if (!Number.isSafeInteger(candidate['declarationRevision']) || (candidate['declarationRevision'] as number) < 1) {
    return errResult('triangle requires declarationRevision >= 1');
  }
  const serverWorkspaceId = candidate['serverWorkspaceId'];
  const serverIssuer = candidate['serverIssuer'];
  const bindingRevision = candidate['bindingRevision'];
  const hasWorkspace = serverWorkspaceId !== undefined;
  const hasIssuer = serverIssuer !== undefined;
  const hasBinding = bindingRevision !== undefined;
  if (hasWorkspace && !isIdentityField(serverWorkspaceId)) {
    return errResult('serverWorkspaceId must be non-empty when present');
  }
  if (hasIssuer && !isIdentityField(serverIssuer)) {
    return errResult('serverIssuer must be non-empty when present');
  }
  if (hasBinding && (!Number.isSafeInteger(bindingRevision) || (bindingRevision as number) < 1)) {
    return errResult('triangle requires bindingRevision >= 1 when present');
  }
  if ((hasWorkspace || hasIssuer || hasBinding) && !(hasWorkspace && hasIssuer && hasBinding)) {
    return errResult('product triplet requires serverWorkspaceId, serverIssuer and bindingRevision together');
  }
  return okResult();
};
