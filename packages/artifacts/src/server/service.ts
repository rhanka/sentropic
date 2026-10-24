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
