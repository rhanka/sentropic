// Live workspace declaration registration — engram plan L6a, S seat
// (spec/SPEC_LIVE_GIT_INDEXING.md §§2–3, 10, 12; owner Q4 A).
//
// Durable registration semantics for explicit live declarations: a declaration
// binds the public host fingerprint and a revision, replay after projection
// loss resumes without renewed activation, and a withdrawal cancels deferred
// work and requests a private purge while committed history is preserved.
// This module owns ports and pure decisions only — concrete storage stays
// host-owned (SQLite locally, Postgres in the app). The DTOs mirror the
// engram-live L6a contract; this package carries no engram dependency until
// R-S qualifies a packed prerelease.

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
