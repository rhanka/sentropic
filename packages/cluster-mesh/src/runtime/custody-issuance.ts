import { randomUUID } from 'node:crypto';
import type { EphemeralCustodyKey } from './custody-crypto.js';
import type { CustodyStateStorePort } from './custody-state.js';
import type {
  CustodyBinding,
  CustodyIssueRequest,
  CustodyRevocationSelector,
  SignedCustodyToken,
} from './custody-types.js';
import { custodyHorizon } from './custody-validation.js';
import { custodySignaturePayload } from './custody-wire.js';
import type { RegistrationLookupPort } from './registration.js';

const actions = new Set(['drive', 'wake', 'relaunch']);

const bindingSelector = (binding: CustodyBinding): CustodyRevocationSelector => ({
  kind: 'binding', registrationId: binding.registrationId, custodyId: binding.custodyId,
  holderPrincipalId: binding.holderPrincipalId, epoch: binding.epoch,
});

export async function issueBoundedCustodyToken(input: {
  readonly request: CustodyIssueRequest;
  readonly registrations: RegistrationLookupPort;
  readonly bindings: ReadonlyMap<string, CustodyBinding>;
  readonly state: CustodyStateStorePort;
  readonly key: EphemeralCustodyKey;
  readonly maximumTtlMs: number;
  readonly now: number;
}): Promise<SignedCustodyToken | null> {
  const { request } = input;
  const requestedTtl = request.requestedTtlSeconds ?? input.maximumTtlMs / 1_000;
  if (
    !Number.isFinite(input.now) || !Number.isFinite(requestedTtl) || requestedTtl <= 0
    || !request.registrationId || !request.holderPrincipalId || !request.invocationId
    || !actions.has(request.action)
  ) return null;
  let registration;
  try {
    registration = await input.registrations.find(request.registrationId);
  } catch {
    return null;
  }
  const binding = input.bindings.get(request.registrationId);
  if (!registration || !binding || registration.status !== 'active' || binding.status !== 'active') return null;
  const horizon = custodyHorizon(registration, binding);
  if (
    horizon === null || horizon <= input.now
    || binding.registrationId !== registration.registrationId
    || binding.holderPrincipalId !== request.holderPrincipalId
    || registration.custodyHolderPrincipalId !== request.holderPrincipalId
    || binding.epoch !== registration.custodyEpoch
  ) return null;
  try {
    const status = await input.state.inspect({
      selectors: [bindingSelector(binding), { kind: 'holder', holderPrincipalId: request.holderPrincipalId }],
      now: input.now,
    });
    if (status !== 'available') return null;
  } catch {
    return null;
  }
  const expiresAt = Math.min(
    horizon,
    input.now + Math.min(requestedTtl * 1_000, input.maximumTtlMs),
  );
  const unsigned: SignedCustodyToken = {
    kind: 'signed-custody-token', version: 'sentropic.cluster-mesh.custody/v1',
    tokenId: randomUUID(), issuer: input.key.issuer, audience: binding.meshDomain,
    registrationId: registration.registrationId, action: request.action,
    holderPrincipalId: request.holderPrincipalId, epoch: binding.epoch,
    custodyId: binding.custodyId, invocationId: request.invocationId,
    issuedAt: new Date(input.now).toISOString(), expiresAt: new Date(expiresAt).toISOString(),
    evidence: {
      kind: 'detached-signature', canonicalization: 'sentropic-json-v1',
      signatureBase64Url: 'unsigned',
    },
  };
  try {
    const signatureBase64Url = await input.key.signer.signCanonical(custodySignaturePayload(unsigned));
    return { ...unsigned, evidence: { ...unsigned.evidence, signatureBase64Url } };
  } catch {
    return null;
  }
}
