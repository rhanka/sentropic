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

export interface LiveWorkspaceDeclaration {
  readonly tenant: string;
  readonly principal: string;
  readonly hostFingerprint: string;
  readonly authorizedRoots: readonly string[];
  readonly liveCapability: 'live';
  readonly policyVersion: string;
  readonly declarationRevision: number;
  readonly serverWorkspaceId?: string;
  readonly serverIssuer?: string;
  readonly bindingRevision?: number;
}

export const LIVE_REVOCATION_REASONS = ['workspace-remove', 'owner-request', 'policy-withdrawn'] as const;
export type LiveRevocationReason = (typeof LIVE_REVOCATION_REASONS)[number];

export interface LivePrivatePurgeRequest {
  readonly purgePrivateSnapshots: true;
  readonly purgeDerivedIndexes: true;
  readonly revokeDecryptability: true;
  readonly preserveCommittedHistory: true;
}

export interface LiveDeclarationWithdrawal {
  readonly tenant: string;
  readonly hostFingerprint: string;
  readonly declarationRevision: number;
  readonly reason: LiveRevocationReason;
  readonly requestPrivatePurge: LivePrivatePurgeRequest;
}

export const NON_ACTIVATING_LIFECYCLE_KINDS = [
  'bind',
  'upload',
  'code-workspace-create',
  'session-open',
  'session-end',
] as const;
export type NonActivatingLifecycleKind = (typeof NON_ACTIVATING_LIFECYCLE_KINDS)[number];

export function classifyLifecycleEvent(kind: NonActivatingLifecycleKind): 'no-activation-change' {
  if (!(NON_ACTIVATING_LIFECYCLE_KINDS as readonly string[]).includes(kind)) {
    throw new Error(`unknown lifecycle kind: ${String(kind)}`);
  }
  return 'no-activation-change';
}

export interface LiveDeclarationStorePort {
  save(declaration: LiveWorkspaceDeclaration): Promise<void>;
  find(tenant: string, hostFingerprint: string): Promise<LiveWorkspaceDeclaration | null>;
  list(tenant?: string): Promise<readonly LiveWorkspaceDeclaration[]>;
  status(tenant: string, hostFingerprint: string): Promise<'declared' | 'withdrawn' | 'unknown'>;
  recordWithdrawal(withdrawal: LiveDeclarationWithdrawal, withdrawnAt: string): Promise<boolean>;
}

export interface LiveDeferredWorkPort {
  cancelDeferredWork(input: {
    readonly tenant: string;
    readonly hostFingerprint: string;
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
  readonly hostFingerprint: string;
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

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0;

const isNonNegativeInteger = (value: unknown): boolean =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;

const optional = (key: string, value: unknown): Record<string, unknown> =>
  value !== undefined ? { [key]: value } : {};

function declarationErrors(d: Record<string, unknown>): readonly string[] {
  const errors: string[] = [];
  const optionalString = (key: string) => {
    if (d[key] !== undefined && !isNonEmptyString(d[key])) {
      errors.push(`${key}, when present, must be a non-empty string`);
    }
  };
  for (const key of ['tenant', 'principal', 'hostFingerprint', 'policyVersion']) {
    if (!isNonEmptyString(d[key])) errors.push(`${key} must be a non-empty string`);
  }
  if (d.liveCapability !== 'live') {
    errors.push('liveCapability must be the explicit string "live" (bind/upload is not activation)');
  }
  if (!Array.isArray(d.authorizedRoots) || d.authorizedRoots.length === 0
    || (d.authorizedRoots as readonly unknown[]).some((root) => !isNonEmptyString(root))) {
    errors.push('authorizedRoots must be a non-empty array of non-empty strings');
  }
  if (!isNonNegativeInteger(d.declarationRevision)) {
    errors.push('declarationRevision must be a non-negative integer');
  }
  optionalString('serverWorkspaceId');
  optionalString('serverIssuer');
  if (d.bindingRevision !== undefined && !isNonNegativeInteger(d.bindingRevision)) {
    errors.push('bindingRevision, when present, must be a non-negative integer');
  }
  if (d.serverWorkspaceId !== undefined && d.bindingRevision === undefined) {
    errors.push('bindingRevision is required when serverWorkspaceId is present (authorized code-workspace binding)');
  }
  if (d.serverIssuer !== undefined && d.serverWorkspaceId === undefined) {
    errors.push('serverWorkspaceId is required when serverIssuer is present');
  }
  if (d.bindingRevision !== undefined && d.serverWorkspaceId === undefined) {
    errors.push('serverWorkspaceId is required when bindingRevision is present');
  }
  return errors;
}

export function createLiveDeclarationRegistration(input: {
  readonly store: LiveDeclarationStorePort;
  readonly deferredWork: LiveDeferredWorkPort;
  readonly privatePurge: LivePrivatePurgePort;
}) {
  const validate = (declaration: LiveWorkspaceDeclaration, label: string): void => {
    const errors = declarationErrors(declaration as unknown as Record<string, unknown>);
    if (errors.length > 0) throw new Error(`${label}: ${errors.join('; ')}`);
  };
  return {
    async declare(declarationInput: DeclareLiveDeclarationInput): Promise<LiveWorkspaceDeclaration> {
      const declaration = {
        tenant: declarationInput.tenant,
        principal: declarationInput.principal,
        hostFingerprint: declarationInput.hostFingerprint,
        authorizedRoots: [...declarationInput.authorizedRoots],
        liveCapability: 'live' as const,
        policyVersion: declarationInput.policyVersion,
        declarationRevision: 0,
        ...optional('serverWorkspaceId', declarationInput.serverWorkspaceId),
        ...optional('serverIssuer', declarationInput.serverIssuer),
        ...optional('bindingRevision', declarationInput.bindingRevision),
      } as LiveWorkspaceDeclaration;
      validate(declaration, 'invalid live workspace declaration');
      if (await input.store.status(declaration.tenant, declaration.hostFingerprint) !== 'unknown') {
        throw new Error(`live declaration already exists for ${declaration.tenant}/${declaration.hostFingerprint}`);
      }
      await input.store.save(declaration);
      return declaration;
    },

    async revise(
      tenant: string,
      hostFingerprint: string,
      patch: LiveDeclarationPatch,
    ): Promise<LiveWorkspaceDeclaration> {
      const previous = await input.store.find(tenant, hostFingerprint);
      if (!previous || await input.store.status(tenant, hostFingerprint) !== 'declared') {
        throw new Error(`no live declaration for ${tenant}/${hostFingerprint}`);
      }
      if (patch.serverWorkspaceId !== undefined && patch.serverWorkspaceId !== previous.serverWorkspaceId
        && patch.bindingRevision === undefined) {
        throw new Error('a changed serverWorkspaceId requires a fresh bindingRevision (revalidation)');
      }
      const next = {
        ...previous,
        ...(patch.authorizedRoots !== undefined ? { authorizedRoots: [...patch.authorizedRoots] } : {}),
        ...(patch.policyVersion !== undefined ? { policyVersion: patch.policyVersion } : {}),
        ...optional('serverWorkspaceId', patch.serverWorkspaceId),
        ...optional('serverIssuer', patch.serverIssuer),
        ...optional('bindingRevision', patch.bindingRevision),
        declarationRevision: previous.declarationRevision + 1,
      } as LiveWorkspaceDeclaration;
      validate(next, 'invalid revised declaration');
      await input.store.save(next);
      return next;
    },

    async withdraw(withdrawal: {
      readonly tenant: string;
      readonly hostFingerprint: string;
      readonly reason: LiveRevocationReason;
      readonly withdrawnAt: string;
    }): Promise<LiveWithdrawalResult> {
      if (!(LIVE_REVOCATION_REASONS as readonly string[]).includes(withdrawal.reason)) {
        throw new Error(`invalid withdrawal reason: ${String(withdrawal.reason)}`);
      }
      const declaration = await input.store.find(withdrawal.tenant, withdrawal.hostFingerprint);
      if (!declaration
        || await input.store.status(withdrawal.tenant, withdrawal.hostFingerprint) !== 'declared') {
        return { ok: false, reason: 'unknown_declaration' };
      }
      const request: LiveDeclarationWithdrawal = {
        tenant: withdrawal.tenant,
        hostFingerprint: withdrawal.hostFingerprint,
        declarationRevision: declaration.declarationRevision,
        reason: withdrawal.reason,
        requestPrivatePurge: {
          purgePrivateSnapshots: true,
          purgeDerivedIndexes: true,
          revokeDecryptability: true,
          preserveCommittedHistory: true,
        },
      };
      const cancelledDeferredWork = await input.deferredWork.cancelDeferredWork({
        tenant: request.tenant,
        hostFingerprint: request.hostFingerprint,
        declarationRevision: request.declarationRevision,
      });
      await input.privatePurge.requestPrivatePurge(request);
      const recorded = await input.store.recordWithdrawal(request, withdrawal.withdrawnAt);
      return recorded ? { ok: true, cancelledDeferredWork, withdrawal: request }
        : { ok: false, reason: 'unknown_declaration' };
    },

    async status(tenant: string, hostFingerprint: string): Promise<'declared' | 'withdrawn' | 'unknown'> {
      return input.store.status(tenant, hostFingerprint);
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
