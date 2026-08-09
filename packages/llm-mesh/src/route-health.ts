import type { RankedRouteCandidate } from './route-selection.js';
import type { Clock, RouteFailureClassification } from './routing-contracts.js';
import type { RoutePolicy } from './routing-policy.js';

interface HealthEntry {
  readonly key: string;
  readonly expiresAt: number;
  readonly reason: RouteFailureClassification['reason'];
}

const availabilityReasons = new Set<RouteFailureClassification['reason']>([
  'network-unavailable',
  'provider-5xx',
  'rate-limited',
]);

const keyFor = (
  candidate: RankedRouteCandidate,
  scope: RouteFailureClassification['healthScope'],
): string => {
  switch (scope) {
    case 'account': return `account:${candidate.account.accountRef}`;
    case 'transport': return `transport:${candidate.target.transportProviderId}`;
    case 'provider-model': return `provider-model:${candidate.target.providerId}:${candidate.target.modelId}`;
    default: return [
      'route', candidate.target.providerId, candidate.target.modelId,
      candidate.target.transportProviderId, candidate.account.accountRef,
    ].join(':');
  }
};

const applicableKeys = (candidate: RankedRouteCandidate): readonly string[] => [
  keyFor(candidate, 'route'),
  keyFor(candidate, 'account'),
  keyFor(candidate, 'transport'),
  keyFor(candidate, 'provider-model'),
];

export class InMemoryRouteHealth {
  private readonly entries = new Map<string, HealthEntry>();

  constructor(
    private readonly clock: Clock,
    private readonly maximumEntries = 1_000,
  ) {}

  record(
    candidate: RankedRouteCandidate,
    classification: RouteFailureClassification,
    policy: RoutePolicy,
  ): void {
    if (!classification.retryable || !availabilityReasons.has(classification.reason)) return;
    const requestedTtl = classification.retryAfterMs ?? policy.negativeCacheTtlMs;
    const ttl = Math.min(Math.max(requestedTtl, 1_000), 3_600_000);
    const key = keyFor(candidate, classification.healthScope);
    this.entries.set(key, {
      key,
      reason: classification.reason,
      expiresAt: this.clock.now().getTime() + ttl,
    });
    this.evict();
  }

  isSuppressed(candidate: RankedRouteCandidate): boolean {
    this.evict();
    const now = this.clock.now().getTime();
    return applicableKeys(candidate).some((key) => {
      const entry = this.entries.get(key);
      return Boolean(entry && entry.expiresAt > now);
    });
  }

  clear(candidate: RankedRouteCandidate): void {
    applicableKeys(candidate).forEach((key) => this.entries.delete(key));
  }

  private evict(): void {
    const now = this.clock.now().getTime();
    for (const [key, entry] of this.entries) {
      if (entry.expiresAt <= now) this.entries.delete(key);
    }
    while (this.entries.size > this.maximumEntries) {
      const oldest = [...this.entries.values()].sort((a, b) => a.expiresAt - b.expiresAt)[0];
      if (!oldest) break;
      this.entries.delete(oldest.key);
    }
  }
}
