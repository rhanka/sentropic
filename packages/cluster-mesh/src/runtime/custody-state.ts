import type { CustodyRevocationSelector } from './custody-types.js';
import { canonicalCustodyJson } from './custody-wire.js';

export type CustodyStateStatus = 'available' | 'revoked' | 'replayed';

export interface CustodyStateInspection {
  readonly selectors: readonly CustodyRevocationSelector[];
  readonly tokenId?: string;
  readonly invocationKey?: string;
  readonly now: number;
}

export interface CustodyStateConsumption extends CustodyStateInspection {
  readonly tokenId: string;
  readonly invocationKey: string;
  readonly expiresAt: number;
  readonly clockSkewMs: number;
}

export interface CustodyStateStorePort {
  revoke(selector: CustodyRevocationSelector): Promise<void>;
  inspect(input: CustodyStateInspection): Promise<CustodyStateStatus>;
  consume(input: CustodyStateConsumption): Promise<CustodyStateStatus>;
}

const selectorKey = (selector: CustodyRevocationSelector): string =>
  canonicalCustodyJson(selector);

export class InMemoryCustodyStateStore implements CustodyStateStorePort {
  readonly #revoked = new Set<string>();
  readonly #tokens = new Map<string, number>();
  readonly #invocations = new Map<string, number>();

  async revoke(selector: CustodyRevocationSelector): Promise<void> {
    this.#revoked.add(selectorKey(selector));
  }

  async inspect(input: CustodyStateInspection): Promise<CustodyStateStatus> {
    this.#prune(input.now);
    if (input.selectors.some((selector) => this.#revoked.has(selectorKey(selector)))) {
      return 'revoked';
    }
    if (
      (input.tokenId !== undefined && this.#tokens.has(input.tokenId))
      || (input.invocationKey !== undefined && this.#invocations.has(input.invocationKey))
    ) return 'replayed';
    return 'available';
  }

  async consume(input: CustodyStateConsumption): Promise<CustodyStateStatus> {
    this.#prune(input.now);
    if (input.selectors.some((selector) => this.#revoked.has(selectorKey(selector)))) {
      return 'revoked';
    }
    if (this.#tokens.has(input.tokenId) || this.#invocations.has(input.invocationKey)) {
      return 'replayed';
    }
    const replayFenceExpiresAt = input.expiresAt + input.clockSkewMs;
    this.#tokens.set(input.tokenId, replayFenceExpiresAt);
    this.#invocations.set(input.invocationKey, replayFenceExpiresAt);
    return 'available';
  }

  #prune(now: number): void {
    for (const [key, replayFenceExpiresAt] of this.#tokens) {
      if (replayFenceExpiresAt < now) this.#tokens.delete(key);
    }
    for (const [key, replayFenceExpiresAt] of this.#invocations) {
      if (replayFenceExpiresAt < now) this.#invocations.delete(key);
    }
  }
}
