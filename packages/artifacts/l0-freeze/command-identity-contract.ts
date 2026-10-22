/**
 * L0 frozen command-identity declaration (immo #861, ask 1 shape only).
 *
 * Stable data shapes for the effective command and its server-created
 * identity. The codec algorithm and the public host binding names stay
 * unfrozen until spec r2; L6 implements the codec against these shapes.
 */

/** Version of the frozen command-codec shape. */
export const COMMAND_CODEC_VERSION = 'artifacts-command/v1' as const;

/** Caller-supplied key: opaque to the server, never trusted as identity. */
export type CallerIdempotencyKey = string & { readonly __brand: 'caller-key' };

/** Server-derived internal key: distinct from any caller key. */
export type InternalIdempotencyKey = string & { readonly __brand: 'internal-key' };

/**
 * Trusted host derivation binding (shape only). The algorithm reference
 * names Radar's existing SHA-256 construction; domain separation for
 * separator-bearing scopes/subjects is qualified with Q0 vectors in L6.
 */
export interface IdempotencyDerivationBinding {
  readonly algorithm: 'radar-derive-idempotency-v1';
  readonly scope: string;
  readonly actor: string;
  readonly operation: string;
  readonly objectId: string;
  readonly callerKey: string;
}

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
