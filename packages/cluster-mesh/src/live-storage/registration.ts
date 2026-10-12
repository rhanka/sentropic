// Live workspace declaration registration — engram plan L6a, S seat
// (spec/SPEC_LIVE_GIT_INDEXING.md §§2–3, 10, 12; owner Q4 A).
//
// Aligned on approved engram contract commit 70ebdfee9857ba381059896089e4f2d5c19363ea
// (PR rhanka/engram#359, merge 3b311dfb). Canonical id derivations, exact validators,
// explicit uncertainty states, product-binding trio coherence, and single-target revocation.

import { createHash } from 'node:crypto';

export const POLICY_VERSION = 'live-git-indexing/1';
export const EXPLICIT_LIVE_CAPABILITY = 'live' as const;
export const INITIAL_DECLARATION_REVISION = 1;
export const INITIAL_BINDING_REVISION = 1;

export const IDENTITY_UNCERTAINTY_STATES = ['missing_history', 'shallow_history'] as const;
export type IdentityUncertaintyState = (typeof IDENTITY_UNCERTAINTY_STATES)[number];

export const OID_ALGORITHMS = ['sha1', 'sha256'] as const;
export type OidAlgorithm = (typeof OID_ALGORITHMS)[number];

export const REVOCATION_REASONS = ['workspace-remove', 'owner-request', 'policy-withdrawn'] as const;
export type RevocationReason = (typeof REVOCATION_REASONS)[number];

export const ID_KINDS = ['clone', 'worktree', 'declaration'] as const;
export type IdKind = (typeof ID_KINDS)[number];

export const ID_PREFIXES: Readonly<Record<IdKind, string>> = {
  clone: 'clone:',
  worktree: 'wt:',
  declaration: 'decl:',
};

export interface ValidationResult {
  readonly ok: boolean;
  readonly errors: readonly string[];
}

export interface CloneIdentityDto {
  readonly hostScope: string;
  readonly commonDirRealpath: string;
  readonly commonDirProjectFingerprint?: string;
  readonly cloneId: string;
  readonly oidAlgorithm: OidAlgorithm;
  readonly identityUncertainty: readonly IdentityUncertaintyState[];
}

export interface WorktreeIdentityDto {
  readonly cloneId: string;
  readonly worktreeId: string;
  readonly worktreePath: string;
  readonly gitDir: string;
  readonly worktreeFingerprint?: string;
  readonly identityUncertainty: readonly IdentityUncertaintyState[];
}

export interface DeclarationIdentityDto {
  readonly declarationId: string;
  readonly cloneId: string;
  readonly worktreeId: string;
}

export interface DeriveCloneIdentityInput {
  readonly hostScope: string;
  readonly commonDirRealpath: string;
  readonly commonDirProjectFingerprint?: string;
  readonly identityUncertainty?: readonly IdentityUncertaintyState[];
  readonly oidAlgorithm: OidAlgorithm;
}

export interface DeriveWorktreeIdentityInput {
  readonly hostScope: string;
  readonly clone: Pick<CloneIdentityDto, 'cloneId'>;
  readonly worktreePath: string;
  readonly gitDir: string;
  readonly worktreeFingerprint?: string;
  readonly identityUncertainty?: readonly IdentityUncertaintyState[];
}

export interface DeriveDeclarationIdentityInput {
  readonly hostScope: string;
  readonly clone: Pick<CloneIdentityDto, 'cloneId'>;
  readonly worktree: Pick<WorktreeIdentityDto, 'worktreeId'>;
}

export const sha256Hex = (canonical: string): string =>
  createHash('sha256').update(canonical, 'utf8').digest('hex');

export function canonicalIdKey(kind: IdKind, components: readonly string[]): string {
  if (!isIdKind(kind)) throw new Error(`canonicalIdKey requires a known id kind (${ID_KINDS.join(', ')})`);
  for (const c of components) {
    if (typeof c !== 'string') throw new Error('canonicalIdKey requires string components');
    if (c.includes('\0')) throw new Error('canonicalIdKey refuses NUL in identity components');
  }
  return JSON.stringify([kind, ...components]);
}

export function normalizeCommonDirRealpath(realpath: string): string {
  if (realpath.length > 1) {
    const stripped = realpath.replace(/\/+$/, '');
    return stripped.length === 0 ? '/' : stripped;
  }
  return realpath;
}

export function isIdKind(v: unknown): v is IdKind {
  return typeof v === 'string' && (ID_KINDS as readonly string[]).includes(v);
}

export function isIdentityUncertaintyState(v: unknown): v is IdentityUncertaintyState {
  return typeof v === 'string' && (IDENTITY_UNCERTAINTY_STATES as readonly string[]).includes(v);
}

export function isRevocationReason(v: unknown): v is RevocationReason {
  return typeof v === 'string' && (REVOCATION_REASONS as readonly string[]).includes(v);
}

export function isSameClone(a: Pick<CloneIdentityDto, 'cloneId'>, b: Pick<CloneIdentityDto, 'cloneId'>): boolean {
  if (typeof a?.cloneId !== 'string' || !a.cloneId.trim() || typeof b?.cloneId !== 'string' || !b.cloneId.trim()) {
    throw new Error('isSameClone compares canonical clone ids: both references must carry a non-empty cloneId');
  }
  return a.cloneId === b.cloneId;
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const isNonEmptyString = (v: unknown): v is string =>
  typeof v === 'string' && v.trim().length > 0;
const isPositiveInteger = (v: unknown): v is number =>
  typeof v === 'number' && Number.isSafeInteger(v) && v > 0;
const hasNul = (v: unknown): boolean =>
  typeof v === 'string' && v.includes('\0');
const isOpaqueId = (v: unknown, prefix: string): v is string =>
  isNonEmptyString(v) && !hasNul(v) && v.startsWith(prefix);
const isCloneIdReference = (v: unknown): v is string =>
  isNonEmptyString(v) && v.startsWith(ID_PREFIXES.clone);
const isWorktreeIdReference = (v: unknown): v is string =>
  isNonEmptyString(v) && v.startsWith(ID_PREFIXES.worktree);
const isUncertaintyList = (v: unknown): v is readonly IdentityUncertaintyState[] =>
  Array.isArray(v) && v.every((s) => (IDENTITY_UNCERTAINTY_STATES as readonly string[]).includes(s));

function rejectUnknown(val: Record<string, unknown>, allowed: readonly string[], path: string, errs: string[]): void {
  for (const k of Object.keys(val)) {
    if (!allowed.includes(k)) errs.push(`${path}.${k} is not a known key`);
  }
}

const CLONE_KEYS = ['hostScope', 'commonDirRealpath', 'commonDirProjectFingerprint', 'cloneId', 'oidAlgorithm', 'identityUncertainty'] as const;
export function validateCloneIdentity(identity: unknown): ValidationResult {
  if (!isRecord(identity)) return { ok: false, errors: ['cloneIdentity must be an object'] };
  const errors: string[] = [];
  rejectUnknown(identity, CLONE_KEYS, 'cloneIdentity', errors);
  if (!isNonEmptyString(identity.hostScope) || hasNul(identity.hostScope)) errors.push('cloneIdentity.hostScope must be a non-empty string without NUL');
  if (!isNonEmptyString(identity.commonDirRealpath) || hasNul(identity.commonDirRealpath)) errors.push('cloneIdentity.commonDirRealpath must be a non-empty string without NUL');
  if (identity.commonDirProjectFingerprint !== undefined && (!isNonEmptyString(identity.commonDirProjectFingerprint) || hasNul(identity.commonDirProjectFingerprint))) {
    errors.push('cloneIdentity.commonDirProjectFingerprint, when present, must be a non-empty string without NUL');
  } else if (identity.commonDirProjectFingerprint === undefined && (!isUncertaintyList(identity.identityUncertainty) || !identity.identityUncertainty.includes('missing_history'))) {
    errors.push('cloneIdentity.commonDirProjectFingerprint is absent: identityUncertainty must explicitly contain "missing_history" (LIVE §12)');
  }
  if (!isOpaqueId(identity.cloneId, ID_PREFIXES.clone)) errors.push(`cloneIdentity.cloneId must be a non-empty opaque id starting with "${ID_PREFIXES.clone}"`);
  if (identity.oidAlgorithm !== 'sha1' && identity.oidAlgorithm !== 'sha256') errors.push('cloneIdentity.oidAlgorithm must be "sha1" or "sha256"');
  if (!isUncertaintyList(identity.identityUncertainty)) errors.push(`cloneIdentity.identityUncertainty must be an array of uncertainty states (${IDENTITY_UNCERTAINTY_STATES.join(', ')})`);
  return { ok: errors.length === 0, errors };
}

const WORKTREE_KEYS = ['cloneId', 'worktreeId', 'worktreePath', 'gitDir', 'worktreeFingerprint', 'identityUncertainty'] as const;
export function validateWorktreeIdentity(identity: unknown): ValidationResult {
  if (!isRecord(identity)) return { ok: false, errors: ['worktreeIdentity must be an object'] };
  const errors: string[] = [];
  rejectUnknown(identity, WORKTREE_KEYS, 'worktreeIdentity', errors);
  if (!isOpaqueId(identity.cloneId, ID_PREFIXES.clone)) errors.push(`worktreeIdentity.cloneId must be a non-empty opaque id starting with "${ID_PREFIXES.clone}"`);
  if (!isOpaqueId(identity.worktreeId, ID_PREFIXES.worktree)) errors.push(`worktreeIdentity.worktreeId must be a non-empty opaque id starting with "${ID_PREFIXES.worktree}"`);
  if (!isNonEmptyString(identity.worktreePath) || hasNul(identity.worktreePath)) errors.push('worktreeIdentity.worktreePath must be a non-empty string without NUL');
  if (!isNonEmptyString(identity.gitDir) || hasNul(identity.gitDir)) errors.push('worktreeIdentity.gitDir must be a non-empty string without NUL');
  if (identity.worktreeFingerprint !== undefined && (!isNonEmptyString(identity.worktreeFingerprint) || hasNul(identity.worktreeFingerprint))) {
    errors.push('worktreeIdentity.worktreeFingerprint, when present, must be a non-empty string without NUL');
  } else if (identity.worktreeFingerprint === undefined && (!isUncertaintyList(identity.identityUncertainty) || !identity.identityUncertainty.includes('missing_history'))) {
    errors.push('worktreeIdentity.worktreeFingerprint is absent: identityUncertainty must explicitly contain "missing_history" (LIVE §12)');
  }
  if (!isUncertaintyList(identity.identityUncertainty)) errors.push(`worktreeIdentity.identityUncertainty must be an array of uncertainty states (${IDENTITY_UNCERTAINTY_STATES.join(', ')})`);
  return { ok: errors.length === 0, errors };
}

export function deriveCloneIdentity(input: DeriveCloneIdentityInput): CloneIdentityDto {
  if (!isRecord(input)) throw new Error('deriveCloneIdentity requires a clone input object');
  if (!isNonEmptyString(input.hostScope)) throw new Error('deriveCloneIdentity requires a non-empty hostScope');
  if (!isNonEmptyString(input.commonDirRealpath)) throw new Error('deriveCloneIdentity requires a non-empty commonDirRealpath');
  const uncertainty = [...(input.identityUncertainty ?? [])];
  if (uncertainty.some((s) => !isIdentityUncertaintyState(s))) throw new Error(`identity uncertainty states must be one of ${IDENTITY_UNCERTAINTY_STATES.join(', ')}`);
  if (input.commonDirProjectFingerprint !== undefined && !isNonEmptyString(input.commonDirProjectFingerprint)) {
    throw new Error('deriveCloneIdentity requires a non-empty commonDirProjectFingerprint when present');
  }
  if (input.commonDirProjectFingerprint === undefined && !uncertainty.includes('missing_history')) {
    throw new Error('deriveCloneIdentity omits commonDirProjectFingerprint only under explicit "missing_history" uncertainty');
  }
  if (input.oidAlgorithm !== 'sha1' && input.oidAlgorithm !== 'sha256') throw new Error('deriveCloneIdentity requires oidAlgorithm "sha1" or "sha256"');
  const normalizedRealpath = normalizeCommonDirRealpath(input.commonDirRealpath);
  const canonical = canonicalIdKey('clone', [input.hostScope, normalizedRealpath, input.commonDirProjectFingerprint ?? '']);
  const identity: CloneIdentityDto = {
    hostScope: input.hostScope,
    commonDirRealpath: normalizedRealpath,
    ...(input.commonDirProjectFingerprint !== undefined ? { commonDirProjectFingerprint: input.commonDirProjectFingerprint } : {}),
    cloneId: `${ID_PREFIXES.clone}${sha256Hex(canonical)}`,
    oidAlgorithm: input.oidAlgorithm,
    identityUncertainty: uncertainty,
  };
  const checked = validateCloneIdentity(identity);
  if (!checked.ok) throw new Error(`invalid derived clone identity: ${checked.errors.join('; ')}`);
  return identity;
}

export function deriveWorktreeIdentity(input: DeriveWorktreeIdentityInput): WorktreeIdentityDto {
  if (!isRecord(input)) throw new Error('deriveWorktreeIdentity requires a worktree input object');
  if (!isRecord(input.clone) || !isCloneIdReference(input.clone.cloneId)) throw new Error('deriveWorktreeIdentity requires a derived clone carrying a canonical cloneId');
  if (!isNonEmptyString(input.hostScope)) throw new Error('deriveWorktreeIdentity requires a non-empty hostScope');
  if (!isNonEmptyString(input.worktreePath)) throw new Error('deriveWorktreeIdentity requires a non-empty worktreePath');
  if (!isNonEmptyString(input.gitDir)) throw new Error('deriveWorktreeIdentity requires a non-empty gitDir');
  const uncertainty = [...(input.identityUncertainty ?? [])];
  if (uncertainty.some((s) => !isIdentityUncertaintyState(s))) throw new Error(`identity uncertainty states must be one of ${IDENTITY_UNCERTAINTY_STATES.join(', ')}`);
  if (input.worktreeFingerprint !== undefined && !isNonEmptyString(input.worktreeFingerprint)) {
    throw new Error('deriveWorktreeIdentity requires a non-empty worktreeFingerprint when present');
  }
  if (input.worktreeFingerprint === undefined && !uncertainty.includes('missing_history')) {
    throw new Error('deriveWorktreeIdentity omits worktreeFingerprint only under explicit "missing_history" uncertainty');
  }
  const canonical = canonicalIdKey('worktree', [input.hostScope, input.gitDir]);
  const identity: WorktreeIdentityDto = {
    cloneId: input.clone.cloneId,
    worktreeId: `${ID_PREFIXES.worktree}${sha256Hex(canonical)}`,
    worktreePath: input.worktreePath,
    gitDir: input.gitDir,
    ...(input.worktreeFingerprint !== undefined ? { worktreeFingerprint: input.worktreeFingerprint } : {}),
    identityUncertainty: uncertainty,
  };
  const checked = validateWorktreeIdentity(identity);
  if (!checked.ok) throw new Error(`invalid derived worktree identity: ${checked.errors.join('; ')}`);
  return identity;
}

export function deriveDeclarationIdentity(input: DeriveDeclarationIdentityInput): DeclarationIdentityDto {
  if (!isRecord(input)) throw new Error('deriveDeclarationIdentity requires a declaration identity input object');
  if (!isRecord(input.clone) || !isCloneIdReference(input.clone.cloneId)) throw new Error('deriveDeclarationIdentity requires a derived clone carrying a canonical cloneId');
  if (!isRecord(input.worktree) || !isWorktreeIdReference(input.worktree.worktreeId)) throw new Error('deriveDeclarationIdentity requires a derived worktree carrying a canonical worktreeId');
  if (!isNonEmptyString(input.hostScope)) throw new Error('deriveDeclarationIdentity requires a non-empty hostScope');
  const canonical = canonicalIdKey('declaration', [input.hostScope, input.clone.cloneId, input.worktree.worktreeId]);
  return {
    declarationId: `${ID_PREFIXES.declaration}${sha256Hex(canonical)}`,
    cloneId: input.clone.cloneId,
    worktreeId: input.worktree.worktreeId,
  };
}

const PURGE_KEYS = ['purgePrivateSnapshots', 'purgeDerivedIndexes', 'revokeDecryptability', 'preserveCommittedHistory'] as const;
export function validatePrivatePurgeRequest(request: unknown): ValidationResult {
  if (!isRecord(request)) return { ok: false, errors: ['requestPrivatePurge must be an object'] };
  const errors: string[] = [];
  rejectUnknown(request, PURGE_KEYS, 'requestPrivatePurge', errors);
  if (request.purgePrivateSnapshots !== true) {
    errors.push('requestPrivatePurge.purgePrivateSnapshots must be true (revocation always purges private snapshots)');
  }
  if (request.purgeDerivedIndexes !== true) {
    errors.push('requestPrivatePurge.purgeDerivedIndexes must be true (revocation always purges derived indexes)');
  }
  if (request.revokeDecryptability !== true) {
    errors.push('requestPrivatePurge.revokeDecryptability must be true (revocation always revokes decryptability)');
  }
  if (request.preserveCommittedHistory !== true) {
    errors.push('requestPrivatePurge.preserveCommittedHistory must be true (revocation never deletes committed history)');
  }
  return { ok: errors.length === 0, errors };
}

const REVOCATION_KEYS = ['declarationId', 'tenant', 'cloneId', 'worktreeId', 'declarationRevision', 'reason', 'requestPrivatePurge'] as const;
export function validateDeclarationRevocation(revocation: unknown): ValidationResult {
  if (!isRecord(revocation)) return { ok: false, errors: ['revocation must be an object'] };
  const errors: string[] = [];
  rejectUnknown(revocation, REVOCATION_KEYS, 'revocation', errors);
  if (!isOpaqueId(revocation.declarationId, ID_PREFIXES.declaration)) errors.push(`revocation.declarationId must be a non-empty opaque id starting with "${ID_PREFIXES.declaration}"`);
  if (!isNonEmptyString(revocation.tenant) || hasNul(revocation.tenant)) errors.push('revocation.tenant must be a non-empty string without NUL');
  if (!isOpaqueId(revocation.cloneId, ID_PREFIXES.clone)) errors.push(`revocation.cloneId must be a non-empty opaque id starting with "${ID_PREFIXES.clone}"`);
  if (!isOpaqueId(revocation.worktreeId, ID_PREFIXES.worktree)) errors.push(`revocation.worktreeId must be a non-empty opaque id starting with "${ID_PREFIXES.worktree}"`);
  if (!isPositiveInteger(revocation.declarationRevision) || (revocation.declarationRevision as number) < INITIAL_DECLARATION_REVISION) {
    errors.push(`revocation.declarationRevision must be an integer >= ${INITIAL_DECLARATION_REVISION}`);
  }
  if (!isRevocationReason(revocation.reason)) errors.push(`revocation.reason must be one of ${REVOCATION_REASONS.join(', ')}`);
  const purge = validatePrivatePurgeRequest(revocation.requestPrivatePurge);
  if (!purge.ok) errors.push(...purge.errors.map((e) => `revocation.${e}`));
  return { ok: errors.length === 0, errors };
}

const DECLARATION_KEYS = ['tenant', 'principal', 'hostFingerprint', 'identityUncertainty', 'declarationId', 'cloneId', 'worktreeId', 'authorizedRoots', 'liveCapability', 'policyVersion', 'declarationRevision', 'serverWorkspaceId', 'serverIssuer', 'bindingRevision'] as const;
export function validateWorkspaceDeclaration(declaration: unknown): ValidationResult {
  if (!isRecord(declaration)) return { ok: false, errors: ['declaration must be an object'] };
  const errors: string[] = [];
  rejectUnknown(declaration, DECLARATION_KEYS, 'declaration', errors);
  if (!isNonEmptyString(declaration.tenant) || hasNul(declaration.tenant)) errors.push('declaration.tenant must be a non-empty string without NUL');
  if (!isNonEmptyString(declaration.principal) || hasNul(declaration.principal)) errors.push('declaration.principal must be a non-empty string without NUL');
  if (declaration.hostFingerprint !== undefined && (!isNonEmptyString(declaration.hostFingerprint) || hasNul(declaration.hostFingerprint))) {
    errors.push('declaration.hostFingerprint, when present, must be a non-empty string without NUL');
  } else if (declaration.hostFingerprint === undefined && (!isUncertaintyList(declaration.identityUncertainty) || !declaration.identityUncertainty.includes('missing_history'))) {
    errors.push('declaration.hostFingerprint is absent: identityUncertainty must explicitly contain "missing_history" (LIVE §12)');
  }
  if (!isUncertaintyList(declaration.identityUncertainty)) errors.push(`declaration.identityUncertainty must be an array of uncertainty states (${IDENTITY_UNCERTAINTY_STATES.join(', ')})`);
  if (!isOpaqueId(declaration.declarationId, ID_PREFIXES.declaration)) errors.push(`declaration.declarationId must be a non-empty opaque id starting with "${ID_PREFIXES.declaration}"`);
  if (!isOpaqueId(declaration.cloneId, ID_PREFIXES.clone)) errors.push(`declaration.cloneId must be a non-empty opaque id starting with "${ID_PREFIXES.clone}"`);
  if (!isOpaqueId(declaration.worktreeId, ID_PREFIXES.worktree)) errors.push(`declaration.worktreeId must be a non-empty opaque id starting with "${ID_PREFIXES.worktree}"`);
  if (!Array.isArray(declaration.authorizedRoots) || declaration.authorizedRoots.length === 0) {
    errors.push('declaration.authorizedRoots must be a non-empty array');
  } else if (declaration.authorizedRoots.some((r: unknown) => !isNonEmptyString(r) || hasNul(r))) {
    errors.push('declaration.authorizedRoots entries must be non-empty strings without NUL');
  }
  if (declaration.liveCapability !== EXPLICIT_LIVE_CAPABILITY) {
    errors.push('declaration.liveCapability must be the explicit string "live" (bind/upload is not activation)');
  }
  if (declaration.policyVersion !== POLICY_VERSION) {
    errors.push(`declaration.policyVersion must be the fixed live policy version "${POLICY_VERSION}"`);
  }
  if (!isPositiveInteger(declaration.declarationRevision) || (declaration.declarationRevision as number) < INITIAL_DECLARATION_REVISION) {
    errors.push(`declaration.declarationRevision must be an integer >= ${INITIAL_DECLARATION_REVISION}`);
  }
  const hasServerWorkspace = declaration.serverWorkspaceId !== undefined;
  const hasServerIssuer = declaration.serverIssuer !== undefined;
  const hasBindingRevision = declaration.bindingRevision !== undefined;
  if (hasServerWorkspace && (!isNonEmptyString(declaration.serverWorkspaceId) || hasNul(declaration.serverWorkspaceId))) errors.push('declaration.serverWorkspaceId, when present, must be a non-empty string without NUL');
  if (hasServerIssuer && (!isNonEmptyString(declaration.serverIssuer) || hasNul(declaration.serverIssuer))) errors.push('declaration.serverIssuer, when present, must be a non-empty string without NUL');
  if (hasBindingRevision && (!isPositiveInteger(declaration.bindingRevision) || (declaration.bindingRevision as number) < INITIAL_BINDING_REVISION)) {
    errors.push(`declaration.bindingRevision, when present, must be an integer >= ${INITIAL_BINDING_REVISION}`);
  }
  if ((hasServerWorkspace || hasServerIssuer || hasBindingRevision) && !(hasServerWorkspace && hasServerIssuer && hasBindingRevision)) {
    errors.push('the product binding must be the complete serverWorkspaceId + serverIssuer + bindingRevision triplet: a partial binding is not a valid product intent');
  }
  return { ok: errors.length === 0, errors };
}

export interface LiveWorkspaceDeclaration {
  readonly tenant: string;
  readonly principal: string;
  readonly hostFingerprint?: string;
  readonly identityUncertainty: readonly IdentityUncertaintyState[];
  readonly declarationId: string;
  readonly cloneId: string;
  readonly worktreeId: string;
  readonly authorizedRoots: readonly string[];
  readonly liveCapability: 'live';
  readonly policyVersion: string;
  readonly declarationRevision: number;
  readonly serverWorkspaceId?: string;
  readonly serverIssuer?: string;
  readonly bindingRevision?: number;
}
export type WorkspaceDeclarationDto = LiveWorkspaceDeclaration;

export const LIVE_REVOCATION_REASONS = REVOCATION_REASONS;
export type LiveRevocationReason = RevocationReason;

export interface LivePrivatePurgeRequest {
  readonly purgePrivateSnapshots: true;
  readonly purgeDerivedIndexes: true;
  readonly revokeDecryptability: true;
  readonly preserveCommittedHistory: true;
}
export type PrivatePurgeRequestDto = LivePrivatePurgeRequest;

export interface LiveDeclarationWithdrawal {
  readonly declarationId: string;
  readonly tenant: string;
  readonly cloneId: string;
  readonly worktreeId: string;
  readonly declarationRevision: number;
  readonly reason: LiveRevocationReason;
  readonly requestPrivatePurge: LivePrivatePurgeRequest;
}
export type DeclarationRevocationDto = LiveDeclarationWithdrawal;

export const NON_ACTIVATING_LIFECYCLE_KINDS = [
  'bind',
  'upload',
  'code-workspace-create',
  'session-open',
  'session-end',
] as const;
export type NonActivatingLifecycleKind = (typeof NON_ACTIVATING_LIFECYCLE_KINDS)[number];

export function isNonActivatingLifecycleKind(value: unknown): value is NonActivatingLifecycleKind {
  return (
    typeof value === 'string' &&
    (NON_ACTIVATING_LIFECYCLE_KINDS as readonly string[]).includes(value)
  );
}

export function classifyLifecycleEvent(kind: NonActivatingLifecycleKind): 'no-activation-change' {
  if (!isNonActivatingLifecycleKind(kind)) {
    throw new Error(`unknown lifecycle kind: ${String(kind)}`);
  }
  return 'no-activation-change';
}

export interface CreateLiveDeclarationInput {
  readonly tenant: string;
  readonly principal: string;
  readonly hostFingerprint?: string;
  readonly identityUncertainty: readonly IdentityUncertaintyState[];
  readonly declarationId: string;
  readonly cloneId: string;
  readonly worktreeId: string;
  readonly authorizedRoots: readonly string[];
  readonly liveCapability: 'live';
  readonly policyVersion: string;
  readonly serverWorkspaceId?: string;
  readonly serverIssuer?: string;
  readonly bindingRevision?: number;
}

export function createLiveDeclaration(input: CreateLiveDeclarationInput): LiveWorkspaceDeclaration {
  if (!isRecord(input as unknown)) throw new Error('createLiveDeclaration requires a declaration input object');
  const declaration: LiveWorkspaceDeclaration = {
    tenant: input.tenant,
    principal: input.principal,
    ...(input.hostFingerprint !== undefined ? { hostFingerprint: input.hostFingerprint } : {}),
    identityUncertainty: [...input.identityUncertainty],
    declarationId: input.declarationId,
    cloneId: input.cloneId,
    worktreeId: input.worktreeId,
    authorizedRoots: [...input.authorizedRoots],
    liveCapability: input.liveCapability,
    policyVersion: input.policyVersion,
    declarationRevision: INITIAL_DECLARATION_REVISION,
    ...(input.serverWorkspaceId !== undefined ? { serverWorkspaceId: input.serverWorkspaceId } : {}),
    ...(input.serverIssuer !== undefined ? { serverIssuer: input.serverIssuer } : {}),
    ...(input.bindingRevision !== undefined ? { bindingRevision: input.bindingRevision } : {}),
  };
  if (input.bindingRevision !== undefined && input.bindingRevision !== INITIAL_BINDING_REVISION) {
    throw new Error(`createLiveDeclaration requires the first product binding to carry bindingRevision ${INITIAL_BINDING_REVISION}`);
  }
  const checked = validateWorkspaceDeclaration(declaration);
  if (!checked.ok) throw new Error(`invalid live workspace declaration: ${checked.errors.join('; ')}`);
  return declaration;
}

const PATCH_KEYS = ['authorizedRoots', 'policyVersion', 'serverWorkspaceId', 'serverIssuer', 'bindingRevision'] as const;
export function reviseLiveDeclaration(previous: LiveWorkspaceDeclaration, patch: LiveDeclarationPatch): LiveWorkspaceDeclaration {
  const previousCheck = validateWorkspaceDeclaration(previous);
  if (!previousCheck.ok) throw new Error(`invalid previous declaration: ${previousCheck.errors.join('; ')}`);
  if (!isRecord(patch as unknown)) throw new Error('reviseLiveDeclaration requires a patch object');
  for (const k of Object.keys(patch)) {
    if (!PATCH_KEYS.includes(k as never)) throw new Error(`reviseLiveDeclaration refuses patch key "${k}": identity fields are immutable across revisions`);
  }
  const workspaceChanged = patch.serverWorkspaceId !== undefined && patch.serverWorkspaceId !== previous.serverWorkspaceId;
  const issuerChanged = patch.serverIssuer !== undefined && patch.serverIssuer !== previous.serverIssuer;
  const bindingTouched = patch.bindingRevision !== undefined || workspaceChanged || issuerChanged;
  let nextBindingRevision = previous.bindingRevision;
  if (bindingTouched) {
    if (patch.bindingRevision === undefined) throw new Error('reviseLiveDeclaration requires a fresh strictly increasing bindingRevision when the server workspace or issuer changes (revalidation)');
    if (previous.bindingRevision === undefined) {
      if (patch.bindingRevision !== INITIAL_BINDING_REVISION) throw new Error(`reviseLiveDeclaration requires the first product binding to carry bindingRevision ${INITIAL_BINDING_REVISION}`);
    } else if (patch.bindingRevision <= previous.bindingRevision) {
      throw new Error('reviseLiveDeclaration requires a strictly increasing bindingRevision (binding revisions are monotonic)');
    }
    nextBindingRevision = patch.bindingRevision;
  }
  const next: LiveWorkspaceDeclaration = {
    ...previous,
    authorizedRoots: patch.authorizedRoots !== undefined ? [...patch.authorizedRoots] : [...previous.authorizedRoots],
    policyVersion: patch.policyVersion !== undefined ? patch.policyVersion : previous.policyVersion,
    serverWorkspaceId: patch.serverWorkspaceId !== undefined ? patch.serverWorkspaceId : previous.serverWorkspaceId,
    serverIssuer: patch.serverIssuer !== undefined ? patch.serverIssuer : previous.serverIssuer,
    bindingRevision: nextBindingRevision,
    declarationRevision: previous.declarationRevision + 1,
  };
  const checked = validateWorkspaceDeclaration(next);
  if (!checked.ok) throw new Error(`invalid revised declaration: ${checked.errors.join('; ')}`);
  return next;
}

export function revokeLiveDeclaration(declaration: LiveWorkspaceDeclaration, reason: RevocationReason): LiveDeclarationWithdrawal {
  const checked = validateWorkspaceDeclaration(declaration);
  if (!checked.ok) throw new Error(`invalid declaration: ${checked.errors.join('; ')}`);
  if (!isRevocationReason(reason)) throw new Error(`invalid revocation reason: ${String(reason)}`);
  const revocation: LiveDeclarationWithdrawal = {
    declarationId: declaration.declarationId,
    tenant: declaration.tenant,
    cloneId: declaration.cloneId,
    worktreeId: declaration.worktreeId,
    declarationRevision: declaration.declarationRevision,
    reason,
    requestPrivatePurge: {
      purgePrivateSnapshots: true,
      purgeDerivedIndexes: true,
      revokeDecryptability: true,
      preserveCommittedHistory: true,
    },
  };
  const revocationCheck = validateDeclarationRevocation(revocation);
  if (!revocationCheck.ok) throw new Error(`invalid revocation: ${revocationCheck.errors.join('; ')}`);
  return revocation;
}

export interface LiveDeclarationStorePort {
  save(declaration: LiveWorkspaceDeclaration): Promise<void>;
  find(tenant: string, declarationId: string, cloneId?: string, worktreeId?: string): Promise<LiveWorkspaceDeclaration | null>;
  list(tenant?: string): Promise<readonly LiveWorkspaceDeclaration[]>;
  status(tenant: string, declarationId: string, cloneId?: string, worktreeId?: string): Promise<'declared' | 'withdrawn' | 'unknown'>;
  recordWithdrawal(withdrawal: LiveDeclarationWithdrawal, withdrawnAt: string): Promise<boolean>;
}

export interface LiveDeferredWorkPort {
  cancelDeferredWork(input: {
    readonly tenant: string;
    readonly declarationId: string;
    readonly cloneId: string;
    readonly worktreeId: string;
    readonly declarationRevision: number;
  }): Promise<number>;
}

export interface LivePrivatePurgePort {
  requestPrivatePurge(withdrawal: LiveDeclarationWithdrawal): Promise<void>;
}

export interface LiveDeclarationReplaySink {
  replayDeclaration(declaration: LiveWorkspaceDeclaration): Promise<void>;
}

export interface DeclareLiveDeclarationInput {
  readonly tenant: string;
  readonly principal: string;
  readonly hostFingerprint?: string;
  readonly identityUncertainty: readonly IdentityUncertaintyState[];
  readonly declarationId: string;
  readonly cloneId: string;
  readonly worktreeId: string;
  readonly authorizedRoots: readonly string[];
  readonly policyVersion: string;
  readonly serverWorkspaceId?: string;
  readonly serverIssuer?: string;
  readonly bindingRevision?: number;
}

export interface LiveDeclarationPatch {
  readonly authorizedRoots?: readonly string[];
  readonly policyVersion?: string;
  readonly serverWorkspaceId?: string;
  readonly serverIssuer?: string;
  readonly bindingRevision?: number;
}

export type LiveWithdrawalResult =
  | { readonly ok: true; readonly cancelledDeferredWork: number; readonly withdrawal: LiveDeclarationWithdrawal }
  | { readonly ok: false; readonly reason: 'unknown_declaration' };

export function createLiveDeclarationRegistration(input: {
  readonly store: LiveDeclarationStorePort;
  readonly deferredWork: LiveDeferredWorkPort;
  readonly privatePurge: LivePrivatePurgePort;
}) {
  return {
    async declare(declarationInput: DeclareLiveDeclarationInput): Promise<LiveWorkspaceDeclaration> {
      const declaration = createLiveDeclaration({
        ...declarationInput,
        liveCapability: 'live',
      });
      if (await input.store.status(declaration.tenant, declaration.declarationId, declaration.cloneId, declaration.worktreeId) !== 'unknown') {
        throw new Error(`live declaration already exists for ${declaration.tenant}/${declaration.declarationId}`);
      }
      await input.store.save(declaration);
      return declaration;
    },

    async revise(
      tenant: string,
      declarationId: string,
      patch: LiveDeclarationPatch,
      cloneId?: string,
      worktreeId?: string,
    ): Promise<LiveWorkspaceDeclaration> {
      const previous = await input.store.find(tenant, declarationId, cloneId, worktreeId);
      if (!previous || await input.store.status(tenant, declarationId, cloneId, worktreeId) !== 'declared') {
        throw new Error(`no live declaration for ${tenant}/${declarationId}`);
      }
      const next = reviseLiveDeclaration(previous, patch);
      await input.store.save(next);
      return next;
    },

    async withdraw(withdrawal: {
      readonly tenant: string;
      readonly declarationId: string;
      readonly cloneId: string;
      readonly worktreeId: string;
      readonly reason: RevocationReason;
      readonly withdrawnAt: string;
    }): Promise<LiveWithdrawalResult> {
      if (!isRevocationReason(withdrawal.reason)) {
        throw new Error(`invalid withdrawal reason: ${String(withdrawal.reason)}`);
      }
      const declaration = await input.store.find(
        withdrawal.tenant,
        withdrawal.declarationId,
        withdrawal.cloneId,
        withdrawal.worktreeId,
      );
      if (!declaration
        || await input.store.status(
          withdrawal.tenant,
          withdrawal.declarationId,
          withdrawal.cloneId,
          withdrawal.worktreeId,
        ) !== 'declared') {
        return { ok: false, reason: 'unknown_declaration' };
      }
      const request = revokeLiveDeclaration(declaration, withdrawal.reason);
      const cancelledDeferredWork = await input.deferredWork.cancelDeferredWork({
        tenant: request.tenant,
        declarationId: request.declarationId,
        cloneId: request.cloneId,
        worktreeId: request.worktreeId,
        declarationRevision: request.declarationRevision,
      });
      await input.privatePurge.requestPrivatePurge(request);
      const recorded = await input.store.recordWithdrawal(request, withdrawal.withdrawnAt);
      return recorded ? { ok: true, cancelledDeferredWork, withdrawal: request }
        : { ok: false, reason: 'unknown_declaration' };
    },

    async status(tenant: string, declarationId: string, cloneId?: string, worktreeId?: string): Promise<'declared' | 'withdrawn' | 'unknown'> {
      return input.store.status(tenant, declarationId, cloneId, worktreeId);
    },

    async list(tenant?: string): Promise<readonly LiveWorkspaceDeclaration[]> {
      return input.store.list(tenant);
    },

    async replay(sink: LiveDeclarationReplaySink): Promise<number> {
      const declarations = await input.store.list();
      for (const declaration of declarations) await sink.replayDeclaration(declaration);
      return declarations.length;
    },
  };
}
