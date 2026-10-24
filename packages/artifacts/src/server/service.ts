/**
 * L-5a — artifact service (spec-v8 §9).
 *
 * One service for both HTTP and MCP: it composes authorization, idempotent
 * execution and stable bindings in a fixed order. Authorization runs first
 * so a forged actor creates nothing — no binding, no idempotency record.
 * Storage and UUIDs come from injected ServerPorts only; there is no
 * implicit default store (fail-closed construction).
 */
import { assertArtifactAccess } from './authorization.js';
import { createBindingService } from './bindings.js';
import { createIdempotencyStore } from './idempotency.js';
import type { ServerPorts } from './ports.js';
import { manifestDigest } from '../codecs.js';
import { ArtifactProfileInputError, type CompiledArtifactsProfile } from '../profile/index.js';
import {
  createArtifactCommand,
  type ArtifactKeyDerivationBinding,
  type EffectiveArtifactCommand,
} from './command-identity.js';
import {
  projectEnsureReceipt,
  replayEnsureGuarded,
  type EnsureReceipt,
} from './authorized-replay.js';
import type {
  ArtifactInvocationContext,
  FinalizationCoordinator,
  FinalizeRequest,
  FinalizeTxClient,
  InternalIdempotencyKey,
  ArtifactFailure as CommitFailure,
} from './commit/types.js';
import type { ArtifactFailure, ArtifactOutcome } from './failures.js';

export interface EnsurePrivateViewInput {
  actorUserId: string;
  ownerId: string;
  storageScopeId: string;
  bindingName: string;
  idempotencyKey: string;
  /** @deprecated Ignored; the service computes its own hash. */
  paramsHash?: string;
  /** Validated provider parameters supplied by the application layer. */
  parameters?: Record<string, string | number | boolean | null>;
}

export interface EnsurePrivateViewResult {
  artifactId: string;
  created: boolean;
  replayed: boolean;
}

export interface ArtifactService {
  ensurePrivateView(input: EnsurePrivateViewInput): Promise<EnsurePrivateViewResult>;
}

/** Create the artifact service over explicit injected ports (no defaults). */
export function createArtifactService(ports: ServerPorts): ArtifactService {
  const bindings = createBindingService(ports.kv, ports.uuid);
  const idempotent = createIdempotencyStore(ports.kv);
  return {
    async ensurePrivateView(input: EnsurePrivateViewInput): Promise<EnsurePrivateViewResult> {
      assertArtifactAccess({
        actorUserId: input.actorUserId,
        artifactOwnerId: input.ownerId,
        action: 'mutate',
      });
      const { result, replayed } = await idempotent.execute(
        JSON.stringify(['ensure', input.actorUserId, input.idempotencyKey]),
        manifestDigest({
          schemaVersion: 'artifacts/v1', ownerId: input.ownerId,
          storageScopeId: input.storageScopeId, bindingName: input.bindingName,
          parameters: input.parameters ?? {},
        }),
        () =>
          bindings.ensure({
            ownerId: input.ownerId,
            storageScopeId: input.storageScopeId,
            bindingName: input.bindingName,
          }),
      );
      return { artifactId: result.artifactId, created: result.created, replayed };
    },
  };
}

/**
 * L5 (immo #861) — coordinator-bound ensure (spec r2 §§3.1 A1-A8, 3.2).
 *
 * The legacy split finalizer above stays intact for the L6-owned HTTP and
 * MCP consumers; L6 removes it during transport wiring. This composition is
 * the only guarded ensure path: closed profile validation, server-derived
 * command identity (never a caller hash or scope), request-bound guard
 * invoked after all waits inside one atomic unit, typed outcomes shared
 * with the failure projection. Unknown legacy codecs propagate as
 * quarantine for the L6 migration projection.
 */
export interface GuardedEnsureArgs {
  readonly bindingName: string;
  readonly parameters?: Record<string, string | number | boolean | null>;
  readonly idempotencyKey: string;
  readonly envelopeKey?: string;
}

export interface GuardedEnsureResult {
  readonly artifactId: string;
  readonly created: boolean;
  readonly replayed: boolean;
}

/** Binding identity resolved inside the finalization unit. */
export interface EnsureBindingInput {
  readonly ownerId: string;
  readonly storageScopeId: string;
  readonly bindingName: string;
  readonly attemptId: string;
}

export interface EnsureBindingReceipt {
  readonly artifactId: string;
  readonly created: boolean;
}

/** Host-owned ensure effects inside the coordinator transaction. */
export interface GuardedEnsureHost {
  lockBinding(client: FinalizeTxClient, binding: EnsureBindingInput): Promise<void>;
  resolveBinding(client: FinalizeTxClient, binding: EnsureBindingInput): Promise<EnsureBindingReceipt>;
  abandonAttempt(attemptId: string): Promise<void>;
  readPolicyRevision(): Promise<string>;
}

export interface GuardedEnsureDeps {
  readonly profile: CompiledArtifactsProfile;
  readonly coordinator: FinalizationCoordinator;
  readonly derivation: ArtifactKeyDerivationBinding;
  readonly host: GuardedEnsureHost;
}

export interface GuardedReplayArgs {
  readonly internalKey: InternalIdempotencyKey;
  readonly commandHash: string;
  readonly binding?: EnsureBindingInput;
}

export interface GuardedEnsureService {
  ensure(invocation: ArtifactInvocationContext, args: GuardedEnsureArgs): Promise<ArtifactOutcome<GuardedEnsureResult>>;
  replay(invocation: ArtifactInvocationContext, args: GuardedReplayArgs): Promise<ArtifactOutcome<GuardedEnsureResult>>;
}

/** Private causes stay on the failure object but never serialize: projection picks fields. */
const conceal = (failure: ArtifactFailure): ArtifactFailure => {
  Object.defineProperty(failure, 'cause', { value: failure.cause, enumerable: false });
  return Object.freeze(failure);
};

const profileEntryFailure = (error: ArtifactProfileInputError, invocationId: string): ArtifactFailure => {
  if (error.kind === 'operational') {
    return conceal({
      kind: 'operational', category: 'capability_unselected', variant: error.variant,
      httpStatus: error.httpStatus, publicCode: error.publicCode, retriable: false,
      invocationId, operation: 'ensure', phase: error.phase, commitState: 'not_committed', cause: error,
    });
  }
  return conceal({
    kind: 'ordinary', category: 'invalid_request',
    httpStatus: error.httpStatus, publicCode: error.publicCode, retriable: false,
    invocationId, operation: 'ensure', phase: error.phase, commitState: 'not_committed', cause: error,
  });
};

const internalFailure = (
  invocationId: string, phase: string, cause: unknown,
): ArtifactFailure => conceal({
  kind: 'operational', category: 'provider_error', variant: 'unclassified',
  httpStatus: 500, publicCode: 'internal_error', retriable: false,
  invocationId, operation: 'ensure', phase, commitState: 'not_committed', cause,
});

const unavailableFailure = (
  invocationId: string, phase: string, cause: unknown,
): ArtifactFailure => conceal({
  kind: 'operational', category: 'provider_unavailable', variant: 'dispatch_failure',
  httpStatus: 503, publicCode: 'capability_unavailable', retriable: true,
  invocationId, operation: 'ensure', phase, commitState: 'not_committed', cause,
});

const anonymousFailure = (invocation: ArtifactInvocationContext): ArtifactFailure => conceal({
  kind: 'admission', category: 'anonymous',
  httpStatus: 401, publicCode: 'anonymous', retriable: false,
  invocationId: invocation.invocationId, operation: 'ensure', phase: 'admit',
  commitState: 'not_committed', cause: { invocation: invocation.invocationId },
});

const coordinatorFailure = (
  failure: CommitFailure,
): ArtifactFailure => conceal({
  kind: 'operational', category: failure.category, variant: failure.variant,
  httpStatus: failure.httpStatus, publicCode: failure.publicCode, retriable: failure.retriable,
  invocationId: failure.invocationId, operation: failure.operation, phase: failure.phase,
  commitState: failure.commitState, cause: failure.cause,
});

const ensureResult = (
  receipt: EnsureReceipt, replayed: boolean, invocationId: string,
): ArtifactOutcome<GuardedEnsureResult> => ({
  ok: true,
  result: { artifactId: receipt.artifactId, created: receipt.created, replayed },
  invocationId,
  commitState: 'committed',
  replayed,
});

export function createGuardedEnsureService(deps: GuardedEnsureDeps): GuardedEnsureService {
  const finalizeRequest = (
    invocation: ArtifactInvocationContext, command: EffectiveArtifactCommand, policyRevision: string,
  ): { request: FinalizeRequest; captured: { artifactId?: string; created?: boolean } } => {
    const binding: EnsureBindingInput = {
      ownerId: invocation.actorId,
      storageScopeId: invocation.storageScopeId,
      bindingName: command.payload.bindingName as string,
      attemptId: invocation.invocationId,
    };
    const captured: { artifactId?: string; created?: boolean } = {};
    const request: FinalizeRequest = {
      scopeId: invocation.storageScopeId,
      internalKey: command.identity.internalKey,
      commandHash: command.identity.commandHash,
      codecVersion: command.identity.codecVersion,
      invocationId: invocation.invocationId,
      actorId: invocation.actorId,
      operation: 'ensure',
      artifactId: null,
      bindingName: binding.bindingName,
      policyRevision,
      locks: { 'binding-identity': [async (client) => { await deps.host.lockBinding(client, binding); }] },
      provisional: async (client) => {
        const receipt = await deps.host.resolveBinding(client, binding);
        captured.artifactId = receipt.artifactId;
        captured.created = receipt.created;
      },
      noteAbandonedAttempt: (attemptId) => deps.host.abandonAttempt(attemptId),
      attemptId: invocation.invocationId,
      guard: invocation.authorizeCommit,
      receiptData: captured,
    };
    return { request, captured };
  };

  return {
    async ensure(invocation, args) {
      if (invocation.actorId.length === 0 || invocation.storageScopeId.length === 0) {
        return { ok: false, failure: anonymousFailure(invocation) };
      }
      let command: EffectiveArtifactCommand;
      try {
        const { envelopeKey, ...commandArgs } = args;
        command = createArtifactCommand(
          deps.profile, 'artifacts_ensure', commandArgs,
          { storageScopeId: invocation.storageScopeId, actorId: invocation.actorId },
          deps.derivation, envelopeKey,
        );
      } catch (error) {
        if (error instanceof ArtifactProfileInputError) {
          return { ok: false, failure: profileEntryFailure(error, invocation.invocationId) };
        }
        return { ok: false, failure: internalFailure(invocation.invocationId, 'entry', error) };
      }
      let policyRevision: string;
      try {
        policyRevision = await deps.host.readPolicyRevision();
      } catch (error) {
        return { ok: false, failure: unavailableFailure(invocation.invocationId, 'acquire', error) };
      }
      const { request } = finalizeRequest(invocation, command, policyRevision);
      const outcome = await deps.coordinator.finalize(request);
      if (!outcome.ok) return { ok: false, failure: coordinatorFailure(outcome.failure) };
      let receipt: EnsureReceipt;
      try {
        receipt = projectEnsureReceipt(outcome.result);
      } catch (error) {
        return { ok: false, failure: internalFailure(invocation.invocationId, 'resolve', error) };
      }
      return ensureResult(receipt, outcome.replayed, outcome.invocationId);
    },

    async replay(invocation, args) {
      if (invocation.actorId.length === 0 || invocation.storageScopeId.length === 0) {
        return { ok: false, failure: anonymousFailure(invocation) };
      }
      let policyRevision: string;
      try {
        policyRevision = await deps.host.readPolicyRevision();
      } catch (error) {
        return { ok: false, failure: unavailableFailure(invocation.invocationId, 'acquire', error) };
      }
      const outcome = await replayEnsureGuarded(deps.coordinator, {
        invocation,
        internalKey: args.internalKey,
        commandHash: args.commandHash,
        policyRevision,
        locks: args.binding === undefined ? undefined : {
          'binding-identity': [async (client) => { await deps.host.lockBinding(client, args.binding as EnsureBindingInput); }],
        },
      });
      if (!outcome.ok) return { ok: false, failure: coordinatorFailure(outcome.failure) };
      let receipt: EnsureReceipt;
      try {
        receipt = projectEnsureReceipt(outcome.result);
      } catch (error) {
        return { ok: false, failure: internalFailure(invocation.invocationId, 'resolve', error) };
      }
      return ensureResult(receipt, outcome.replayed, outcome.invocationId);
    },
  };
}
