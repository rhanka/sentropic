import type {
  AccountDirectoryPort,
  EligibleAccountDescriptor,
  PlannedRouteTarget,
  PreparedRouteAttempt,
  RouteFailureClassification,
  VerifiedRoutingSubject,
} from '../../src/routing-contracts.js';

export const routingSubject = (
  principalRef = 'user-a',
  ownerScopeRef = principalRef,
): VerifiedRoutingSubject => ({ principalRef, ownerScopeRef });

export const routeAccounts = (): EligibleAccountDescriptor[] => [
  {
    accountRef: 'internal-old',
    diagnosticAccountRef: 'acct_old',
    targetProviderId: 'gemini',
    transportProviderId: 'cloud-code',
    supportedModelIds: ['gemini-3.5-flash'],
    enrollmentCompletedAt: '2026-08-01T00:00:00Z',
    readiness: 'ready',
    revision: 'r1',
  },
  {
    accountRef: 'internal-new',
    diagnosticAccountRef: 'acct_new',
    targetProviderId: 'gemini',
    transportProviderId: 'antigravity',
    supportedModelIds: ['gemini-3.5-flash'],
    enrollmentCompletedAt: '2026-08-02T00:00:00Z',
    readiness: 'ready',
    revision: 'r1',
  },
];

export class FakeRouteDirectory implements AccountDirectoryPort {
  readonly prepared: Array<{
    subject: VerifiedRoutingSubject;
    accountRef: string;
    target: PlannedRouteTarget;
    outcomes: RouteFailureClassification[];
    committed: number;
    completed: number;
    cancelled: number;
  }> = [];

  constructor(readonly accounts = routeAccounts()) {}

  async listEligible(_subject: VerifiedRoutingSubject) {
    return this.accounts;
  }

  async prepareAttempt(input: {
    subject: VerifiedRoutingSubject;
    accountRef: string;
    target: PlannedRouteTarget;
    requestId: string;
    attemptIndex: number;
  }): Promise<PreparedRouteAttempt> {
    const record = {
      subject: input.subject,
      accountRef: input.accountRef,
      target: input.target,
      outcomes: [] as RouteFailureClassification[],
      committed: 0,
      completed: 0,
      cancelled: 0,
    };
    this.prepared.push(record);
    return {
      attemptRef: `attempt-${this.prepared.length}`,
      async generate() { throw new Error('unused'); },
      async stream() { return { async *[Symbol.asyncIterator]() {} }; },
      async recordOutcome(outcome) { record.outcomes.push(outcome); },
      async markCommitted() { record.committed += 1; },
      async complete() { record.completed += 1; },
      async releaseCancelled() { record.cancelled += 1; },
    };
  }
}
