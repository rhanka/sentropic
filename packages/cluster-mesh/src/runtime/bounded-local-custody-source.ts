import { createEphemeralCustodyKey } from './custody-crypto.js';
import { issueBoundedCustodyToken } from './custody-issuance.js';
import {
  InMemoryCustodyStateStore,
  type CustodyStateStorePort,
} from './custody-state.js';
import type {
  CustodyBinding,
  CustodyIssueRequest,
  CustodyRevocationReceipt,
  CustodyRevocationSelector,
  CustodySource,
  CustodyTokenDecision,
  CustodyTokenExpectation,
  CustodyTokenVerifierPort,
  SignedCustodyToken,
} from './custody-types.js';
import {
  custodyInvocationKey,
  custodySelectors,
} from './custody-validation.js';
import { validateCustodyToken } from './custody-token-validation.js';
import type { RegistrationLookupPort } from './registration.js';

const revocationSelectorKinds: ReadonlySet<string> = new Set(['token', 'binding', 'holder']);

export interface BoundedLocalCustodySourceOptions {
  readonly issuerId: string;
  readonly registrations: RegistrationLookupPort;
  readonly bindings?: readonly CustodyBinding[];
  readonly maximumTtlSeconds: number;
  readonly allowedClockSkewSeconds?: number;
  readonly state?: CustodyStateStorePort;
  readonly now?: () => Date;
}

export class BoundedLocalCustodySource implements CustodySource, CustodyTokenVerifierPort {
  readonly issuerId: string;
  readonly keyId: string;
  readonly #registrations: RegistrationLookupPort;
  readonly #bindings = new Map<string, CustodyBinding>();
  readonly #maximumTtlMs: number;
  readonly #clockSkewMs: number;
  readonly #state: CustodyStateStorePort;
  readonly #now: () => Date;
  readonly #key;

  constructor(input: BoundedLocalCustodySourceOptions) {
    if (!Number.isFinite(input.maximumTtlSeconds) || input.maximumTtlSeconds <= 0) {
      throw new TypeError('maximumTtlSeconds must be positive');
    }
    const clockSkew = input.allowedClockSkewSeconds ?? 0;
    if (!Number.isFinite(clockSkew) || clockSkew < 0) {
      throw new TypeError('allowedClockSkewSeconds must be non-negative');
    }
    this.#key = createEphemeralCustodyKey(input.issuerId);
    this.issuerId = input.issuerId;
    this.keyId = this.#key.issuer.keyId;
    this.#registrations = input.registrations;
    this.#maximumTtlMs = input.maximumTtlSeconds * 1_000;
    this.#clockSkewMs = clockSkew * 1_000;
    this.#state = input.state ?? new InMemoryCustodyStateStore();
    this.#now = input.now ?? (() => new Date());
    for (const binding of input.bindings ?? []) this.setBinding(binding);
  }

  setBinding(binding: CustodyBinding): void {
    if (!binding.registrationId || !binding.custodyId || !binding.holderPrincipalId || !binding.meshDomain) {
      throw new TypeError('custody binding identifiers are required');
    }
    if (!Number.isInteger(binding.epoch) || binding.epoch < 0) {
      throw new TypeError('custody binding epoch must be non-negative');
    }
    this.#bindings.set(binding.registrationId, { ...binding });
  }

  removeBinding(registrationId: string): void {
    this.#bindings.delete(registrationId);
  }

  async issue(input: CustodyIssueRequest): Promise<SignedCustodyToken | null> {
    return issueBoundedCustodyToken({
      request: input, registrations: this.#registrations, bindings: this.#bindings,
      state: this.#state, key: this.#key, maximumTtlMs: this.#maximumTtlMs,
      now: this.#now().getTime(),
    });
  }

  async revoke(input: {
    readonly selector: CustodyRevocationSelector;
    readonly reason: string;
  }): Promise<CustodyRevocationReceipt> {
    if (!revocationSelectorKinds.has(input.selector.kind)) {
      throw new TypeError('unknown custody revocation selector kind');
    }
    await this.#state.revoke(input.selector);
    return {
      issuerId: this.issuerId, selector: input.selector, reason: input.reason,
      revokedAt: this.#now().toISOString(),
    };
  }

  verify(token: SignedCustodyToken, expected: CustodyTokenExpectation): Promise<CustodyTokenDecision> {
    return this.#validate(token, expected, true);
  }

  async consume(
    token: SignedCustodyToken,
    expected: CustodyTokenExpectation,
  ): Promise<CustodyTokenDecision> {
    const decision = await this.#validate(token, expected, false);
    if (!decision.ok) return decision;
    const now = this.#now().getTime();
    try {
      const status = await this.#state.consume({
        selectors: custodySelectors(token), tokenId: token.tokenId,
        invocationKey: custodyInvocationKey(token.registrationId, token.invocationId),
        expiresAt: Date.parse(token.expiresAt), clockSkewMs: this.#clockSkewMs, now,
      });
      return status === 'available' ? decision : { ok: false, reason: status };
    } catch {
      return { ok: false, reason: 'unavailable' };
    }
  }

  async #validate(
    token: SignedCustodyToken,
    expected: CustodyTokenExpectation,
    inspectState: boolean,
  ): Promise<CustodyTokenDecision> {
    return validateCustodyToken({
      token, expected, registrations: this.#registrations, bindings: this.#bindings,
      state: this.#state, key: this.#key, maximumTtlMs: this.#maximumTtlMs,
      clockSkewMs: this.#clockSkewMs, now: this.#now().getTime(), inspectState,
    });
  }
}
