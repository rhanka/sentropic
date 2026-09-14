import type { EphemeralCustodyKey } from './custody-crypto.js';
import { verifyCustodySignature } from './custody-crypto.js';
import type { CustodyStateStorePort } from './custody-state.js';
import type {
  CustodyBinding,
  CustodyTokenDecision,
  CustodyTokenExpectation,
  SignedCustodyToken,
} from './custody-types.js';
import {
  custodyInvocationKey,
  custodySelectors,
  validateCurrentBinding,
  validateExpectedClaims,
} from './custody-validation.js';
import { custodySignaturePayload, isSignedCustodyToken } from './custody-wire.js';
import type { RegistrationLookupPort } from './registration.js';

export async function validateCustodyToken(input: {
  readonly token: SignedCustodyToken;
  readonly expected: CustodyTokenExpectation;
  readonly registrations: RegistrationLookupPort;
  readonly bindings: ReadonlyMap<string, CustodyBinding>;
  readonly state: CustodyStateStorePort;
  readonly key: EphemeralCustodyKey;
  readonly maximumTtlMs: number;
  readonly clockSkewMs: number;
  readonly now: number;
  readonly inspectState: boolean;
}): Promise<CustodyTokenDecision> {
  const { token } = input;
  if (!isSignedCustodyToken(token)) return { ok: false, reason: 'untrusted' };
  let trust;
  try {
    trust = await input.key.trustRoot.resolve(token.issuer);
  } catch {
    return { ok: false, reason: 'unavailable' };
  }
  if (!trust || !verifyCustodySignature({
    publicKeyBase64Url: trust.publicKeyBase64Url,
    payload: custodySignaturePayload(token),
    signatureBase64Url: token.evidence.signatureBase64Url,
  })) return { ok: false, reason: 'untrusted' };
  const claimFailure = validateExpectedClaims(token, input.expected, {
    now: input.now, maximumTtlMs: input.maximumTtlMs, clockSkewMs: input.clockSkewMs,
  });
  if (claimFailure) return { ok: false, reason: claimFailure };
  let registration;
  try {
    registration = await input.registrations.find(token.registrationId);
  } catch {
    return { ok: false, reason: 'unavailable' };
  }
  const bindingFailure = validateCurrentBinding(
    token, registration, input.bindings.get(token.registrationId), input.now,
  );
  if (bindingFailure) return { ok: false, reason: bindingFailure };
  if (input.inspectState) {
    try {
      const status = await input.state.inspect({
        selectors: custodySelectors(token), tokenId: token.tokenId,
        invocationKey: custodyInvocationKey(token.registrationId, token.invocationId),
        now: input.now,
      });
      if (status !== 'available') return { ok: false, reason: status };
    } catch {
      return { ok: false, reason: 'unavailable' };
    }
  }
  return { ok: true, token };
}
