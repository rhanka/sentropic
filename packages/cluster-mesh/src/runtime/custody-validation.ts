import type { ClusterMeshRegistration } from './registration.js';
import type {
  CustodyBinding,
  CustodyRevocationSelector,
  CustodyTokenDecision,
  CustodyTokenExpectation,
  SignedCustodyToken,
} from './custody-types.js';
import { canonicalCustodyJson } from './custody-wire.js';

export type CustodyFailureReason = Extract<CustodyTokenDecision, { ok: false }>['reason'];

export function strictTimestamp(value: string): number | null {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value ? timestamp : null;
}

export function custodyHorizon(
  registration: ClusterMeshRegistration,
  binding: CustodyBinding,
): number | null {
  const registrationExpiry = strictTimestamp(registration.expiresAt);
  const leaseExpiry = strictTimestamp(registration.leaseExpiresAt);
  const bindingExpiry = strictTimestamp(binding.expiresAt);
  if (registrationExpiry === null || leaseExpiry === null || bindingExpiry === null) return null;
  return Math.min(registrationExpiry, leaseExpiry, bindingExpiry);
}

export function validateExpectedClaims(
  token: SignedCustodyToken,
  expected: CustodyTokenExpectation,
  input: { readonly now: number; readonly maximumTtlMs: number; readonly clockSkewMs: number },
): CustodyFailureReason | null {
  if (
    token.audience !== expected.audience
    || token.registrationId !== expected.registrationId
    || token.action !== expected.action
    || token.holderPrincipalId !== expected.holderPrincipalId
    || token.epoch !== expected.epoch
    || token.custodyId !== expected.custodyId
    || token.invocationId !== expected.invocationId
  ) return 'unbound';
  const issuedAt = strictTimestamp(token.issuedAt);
  const expiresAt = strictTimestamp(token.expiresAt);
  if (
    issuedAt === null || expiresAt === null
    || expiresAt <= issuedAt
    || expiresAt - issuedAt > input.maximumTtlMs
    || issuedAt > input.now + input.clockSkewMs
    || expiresAt < input.now - input.clockSkewMs
  ) return 'stale';
  return null;
}

export function validateCurrentBinding(
  token: SignedCustodyToken,
  registration: ClusterMeshRegistration | null,
  binding: CustodyBinding | undefined,
  now: number,
): CustodyFailureReason | null {
  if (!registration || !binding) return 'unbound';
  if (registration.status === 'revoked' || binding.status === 'revoked') return 'revoked';
  const horizon = custodyHorizon(registration, binding);
  if (registration.status !== 'active' || horizon === null || horizon <= now) return 'stale';
  if (
    binding.registrationId !== registration.registrationId
    || token.registrationId !== registration.registrationId
    || token.audience !== binding.meshDomain
    || token.custodyId !== binding.custodyId
    || token.holderPrincipalId !== binding.holderPrincipalId
    || token.holderPrincipalId !== registration.custodyHolderPrincipalId
    || token.epoch !== binding.epoch
    || token.epoch !== registration.custodyEpoch
  ) return 'unbound';
  const expiresAt = strictTimestamp(token.expiresAt);
  return expiresAt === null || expiresAt > horizon ? 'unbound' : null;
}

export function custodySelectors(token: SignedCustodyToken): readonly CustodyRevocationSelector[] {
  return [
    { kind: 'token', tokenId: token.tokenId },
    {
      kind: 'binding', registrationId: token.registrationId, custodyId: token.custodyId,
      holderPrincipalId: token.holderPrincipalId, epoch: token.epoch,
    },
    { kind: 'holder', holderPrincipalId: token.holderPrincipalId },
  ];
}

export function custodyInvocationKey(registrationId: string, invocationId: string): string {
  return canonicalCustodyJson([registrationId, invocationId]);
}
