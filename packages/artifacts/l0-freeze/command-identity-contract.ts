/**
 * L0 frozen command-identity declaration (immo #861, ask 1 shape, spec r2 C5-C7).
 *
 * Stable data shapes for the effective command and its server-created
 * identity, plus the frozen derivation fixtures: preimage construction,
 * expected digests and ambiguous-split refusal. The command codec
 * implementation lands in L1/L6 against the declared relations; domain
 * qualification of trusted scope/subject mappings stays gated on Q0.
 */

/** Version of the frozen command-codec shape. */
export const COMMAND_CODEC_VERSION = 'artifacts-command/v1' as const;

/** Caller-supplied key: opaque to the server, never trusted as identity. */
export type CallerIdempotencyKey = string & { readonly __brand: 'caller-key' };

/** Server-derived internal key: distinct from any caller key. */
export type InternalIdempotencyKey = string & { readonly __brand: 'internal-key' };

/**
 * Trusted host derivation binding. The algorithm names Radar's existing
 * SHA-256 construction over the UTF-8 encoding of the five components
 * joined with `|`, in scope/actor/operation/objectId/callerKey order.
 * An ambiguous concatenation MUST fail host configuration or use an
 * explicitly versioned migration; existing durable keys are never
 * silently re-derived.
 */
export interface IdempotencyDerivationBinding {
  readonly algorithm: 'radar-derive-idempotency-v1';
  readonly scope: string;
  readonly actor: string;
  readonly operation: string;
  readonly objectId: string;
  readonly callerKey: string;
}

/** Join the five binding components with `|`; the hash covers this preimage. */
export function buildDerivationPreimage(binding: IdempotencyDerivationBinding): string {
  return [
    binding.scope, binding.actor, binding.operation,
    binding.objectId, binding.callerKey,
  ].join('|');
}

/** One expected derivation fixture with its precomputed SHA-256 digest. */
export interface DerivationVector {
  readonly name: string;
  readonly binding: IdempotencyDerivationBinding;
  readonly preimage: string;
  readonly sha256: string;
}

export const DERIVATION_VECTORS: readonly DerivationVector[] = [
  {
    name: 'publish-basic',
    binding: {
      algorithm: 'radar-derive-idempotency-v1', scope: 's', actor: 'alice',
      operation: 'publish', objectId: 'obj-1', callerKey: 'key-1',
    },
    preimage: 's|alice|publish|obj-1|key-1',
    sha256: '4a7c17265a6ee4720ff3e941bc42f9c3f2f55b64094076b591d5484d698c7d6a',
  },
  {
    name: 'ambiguous-split-preimage',
    binding: {
      algorithm: 'radar-derive-idempotency-v1', scope: 's|issuer', actor: 'alice',
      operation: 'publish', objectId: 'obj-1', callerKey: 'key-1',
    },
    preimage: 's|issuer|alice|publish|obj-1|key-1',
    sha256: '535a79665cbecdcd2c20621d05791568f3f57bacc76b5f059b91f6d0ceda4bb2',
  },
  {
    name: 'ensure-empty-object',
    binding: {
      algorithm: 'radar-derive-idempotency-v1', scope: 'tenant:t1', actor: 'alice',
      operation: 'ensure', objectId: '', callerKey: 'key-2',
    },
    preimage: 'tenant:t1|alice|ensure||key-2',
    sha256: '437be4b21dce49e880ba3cc697fef667bed4ed0c0ec90e9cbdbad43f1a4a5cbb',
  },
];

/**
 * True when two bindings share one preimage through different component
 * splits. Such an ambiguous concatenation is refused: the distinct
 * scope/actor pairs never share a durable identity without an explicitly
 * qualified canonical mapping or a versioned migration.
 */
export function detectAmbiguousSplit(
  first: IdempotencyDerivationBinding,
  second: IdempotencyDerivationBinding,
): boolean {
  if (buildDerivationPreimage(first) !== buildDerivationPreimage(second)) return false;
  return first.scope !== second.scope
    || first.actor !== second.actor
    || first.operation !== second.operation
    || first.objectId !== second.objectId
    || first.callerKey !== second.callerKey;
}

/**
 * C7 negative fixture: `('s|issuer', 'alice')` and `('s', 'issuer|alice')`
 * produce the same legacy preimage with identical remaining components,
 * so the host MUST refuse (or versioned-migrate) before acceptance. HTTP
 * `alice` versus MCP `issuer|alice` without a qualified canonical mapping
 * are likewise distinct principals and MUST NOT replay each other's receipt.
 */
export const AMBIGUOUS_DERIVATION_CASE = {
  first: {
    algorithm: 'radar-derive-idempotency-v1', scope: 's|issuer', actor: 'alice',
    operation: 'publish', objectId: 'obj-1', callerKey: 'key-1',
  },
  second: {
    algorithm: 'radar-derive-idempotency-v1', scope: 's', actor: 'issuer|alice',
    operation: 'publish', objectId: 'obj-1', callerKey: 'key-1',
  },
  expected: 'refuse',
} as const;

/**
 * Platform envelope rule (C7): the optional envelope key is never an
 * alternative source. `accept` proceeds, `conflict` is a 400 on a
 * mismatching envelope, `envelope-only` is a 400 on an envelope without
 * a tool argument. It adds no second platform idempotency store.
 */
export function resolvePlatformEnvelope(
  argumentKey: string | undefined,
  envelopeKey: string | undefined,
): 'accept' | 'conflict' | 'envelope-only' {
  if (argumentKey === undefined) return 'envelope-only';
  if (envelopeKey === undefined || envelopeKey === argumentKey) return 'accept';
  return 'conflict';
}

/**
 * Command-identity relations the L1/L6 codec MUST enforce: equivalent
 * text/byte inputs and object-property order converge, while changed
 * bytes, path, MIME, profile, provenance or file-array order conflict
 * under the same internal key. A hash supplied in a public request never
 * overrides the computed hash.
 */
export const COMMAND_IDENTITY_RELATIONS = [
  {
    name: 'text-bytes-equivalence',
    description: 'Equivalent text and byte file inputs converge to one command hash.',
    expectation: 'converge',
  },
  {
    name: 'file-array-order',
    description: 'Changed file-array order conflicts under the same internal key.',
    expectation: 'conflict',
  },
  {
    name: 'request-hash-ignored',
    description: 'A hash supplied in a public request never overrides the computed hash.',
    expectation: 'computed-only',
  },
] as const;

/** Server-created identity for one durable command. */
export interface CommandIdentity {
  readonly internalKey: InternalIdempotencyKey;
  readonly commandHash: string;
  readonly codecVersion: typeof COMMAND_CODEC_VERSION;
}

/**
 * Effective command after trusted scope binding, defaults, UTF-8/byte
 * conversion and forced provenance. Object keys sort recursively; array
 * order remains significant. A hash supplied in a public request never
 * overrides the computed hash.
 */
export interface EffectiveArtifactCommand {
  readonly operation: string;
  readonly scopeBinding: string;
  readonly payload: Record<string, unknown>;
  readonly provenance: { readonly kind: 'inline-original' };
  readonly identity: CommandIdentity;
}
