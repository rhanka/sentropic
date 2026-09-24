import { CapabilityGatedError, InvalidProjectionReferenceError } from './errors.js';
import type { ClusterNodeId } from './membership.js';

export type ProjectionKind = 'human_identity' | 'agent_identity' | 'memory_snapshot';

/** Opaque W-A reference: payload and signature remain owned by the home server. */
export interface SignedProjectionReference {
  readonly kind: ProjectionKind;
  readonly reference: string;
  readonly homeNodeId: ClusterNodeId;
  readonly issuer: string;
  readonly keyId: string;
  readonly signature: string;
  /** Unix milliseconds; when present, must be authenticated by the local verifier. */
  readonly expiresAt?: number;
  /** Unix milliseconds; authenticated with the expiry by the host. */
  readonly issuedAt?: number;
}

/** Hosts must sign/verify these UTF-8 JSON bytes; signature is deliberately excluded. */
export function canonicalProjectionReferenceBytes(ref: SignedProjectionReference): Uint8Array {
  return new TextEncoder().encode(JSON.stringify({
    kind: ref.kind, reference: ref.reference, homeNodeId: ref.homeNodeId,
    issuer: ref.issuer, keyId: ref.keyId, expiresAt: ref.expiresAt, issuedAt: ref.issuedAt,
  }));
}

export interface LocalProjectionPort {
  readonly availability?: 'available' | 'gated';
  create(kind: ProjectionKind, localId: string): Promise<SignedProjectionReference>;
  verify(reference: SignedProjectionReference): Promise<boolean>;
  resolve<T>(reference: SignedProjectionReference): Promise<T>;
}

export interface ProjectionDomain {
  project(kind: ProjectionKind, localId: string): Promise<SignedProjectionReference>;
  resolve<T>(reference: SignedProjectionReference): Promise<T>;
}

/** W-A degenerate binding: signed references resolve only on their declared local home node. */
export function createLocalProjectionDomain(input: {
  readonly homeNodeId: ClusterNodeId;
  readonly local: LocalProjectionPort;
  readonly now?: () => number;
  readonly requireExpiry?: boolean;
  readonly maxTtlMs?: number;
  readonly clockSkewMs?: number;
}): ProjectionDomain {
  const skew = input.clockSkewMs ?? 0;
  if (!Number.isSafeInteger(skew) || skew < 0 || (input.maxTtlMs !== undefined &&
      (!Number.isSafeInteger(input.maxTtlMs) || input.maxTtlMs <= 0))) {
    throw new TypeError('Projection TTL must be positive and clock skew nonnegative safe milliseconds');
  }
  function requireUnexpired(reference: SignedProjectionReference) {
    const { expiresAt, issuedAt } = reference;
    if (!input.requireExpiry && expiresAt === undefined && issuedAt === undefined) return;
    const now = (input.now ?? Date.now)();
    if (!Number.isFinite(now) || (input.requireExpiry && expiresAt === undefined) ||
        (issuedAt !== undefined && (!Number.isSafeInteger(issuedAt) || issuedAt > now + skew)) ||
        (expiresAt !== undefined && (!Number.isSafeInteger(expiresAt) || expiresAt <= now - skew ||
          (issuedAt !== undefined && expiresAt <= issuedAt) ||
          (input.maxTtlMs !== undefined && expiresAt - (issuedAt ?? now) > input.maxTtlMs)))) {
      throw new InvalidProjectionReferenceError();
    }
  }
  function requireAvailable() {
    if (input.local.availability === 'gated') throw new CapabilityGatedError('local_projection');
  }
  return {
    async project(kind, localId) {
      requireAvailable();
      const reference = await input.local.create(kind, localId);
      if (reference.homeNodeId !== input.homeNodeId || !(await input.local.verify(reference))) {
        throw new InvalidProjectionReferenceError();
      }
      requireUnexpired(reference);
      return reference;
    },
    async resolve(reference) {
      requireAvailable();
      if (reference.homeNodeId !== input.homeNodeId) {
        throw new CapabilityGatedError('remote_projection');
      }
      if (!(await input.local.verify(reference))) throw new InvalidProjectionReferenceError();
      requireUnexpired(reference);
      return input.local.resolve(reference);
    },
  };
}
