import type { RankedRouteCandidate } from './route-selection.js';
import type { StoredPlan } from './route-planner-state.js';
import { RoutePlanError, subjectRef } from './route-planner-state.js';
import type {
  AccountDirectoryPort,
  Clock,
  PreparedRouteAttempt,
  RouteFailureClassification,
  VerifiedRoutingSubject,
} from './routing-contracts.js';

export const prepareStoredRouteAttempt = async (input: {
  readonly stored: StoredPlan | undefined;
  readonly subject: VerifiedRoutingSubject;
  readonly planRef: string;
  readonly candidateRef: string;
  readonly requestId: string;
  readonly attemptIndex: number;
  readonly directory: AccountDirectoryPort;
  readonly clock: Clock;
  readonly onOutcome: (
    candidate: RankedRouteCandidate,
    classification: RouteFailureClassification,
  ) => void;
  readonly onCommitted: (stored: StoredPlan, candidate: RankedRouteCandidate) => void;
  readonly onSuccess: (stored: StoredPlan, candidate: RankedRouteCandidate) => void;
}): Promise<PreparedRouteAttempt> => {
  const { stored } = input;
  if (!stored || stored.plan.planRef !== input.planRef) {
    throw new RoutePlanError('Unknown route plan', 'invalid-plan');
  }
  if (stored.subjectRef !== subjectRef(input.subject)) {
    throw new RoutePlanError('Route plan belongs to another owner', 'invalid-plan');
  }
  if (Date.parse(stored.plan.expiresAt) <= input.clock.now().getTime()) {
    throw new RoutePlanError('Route plan expired', 'expired-plan');
  }
  const candidate = stored.candidates[input.attemptIndex];
  if (!candidate || candidate.candidateRef !== input.candidateRef) {
    throw new RoutePlanError('Candidate does not match attempt index', 'invalid-plan');
  }
  const current = (await input.directory.listEligible(input.subject)).find(
    (account) => account.accountRef === candidate.account.accountRef,
  );
  if (!current || current.revision !== candidate.account.revision || current.readiness !== 'ready') {
    throw new RoutePlanError('Candidate account changed after planning', 'stale-candidate');
  }
  const attempt = await input.directory.prepareAttempt({
    subject: input.subject,
    accountRef: current.accountRef,
    target: candidate.target,
    requestId: input.requestId,
    attemptIndex: input.attemptIndex,
  });
  let committed = false;
  let terminal = false;
  return {
    attemptRef: attempt.attemptRef,
    generate: (request) => attempt.generate(request),
    stream: (request) => attempt.stream(request),
    recordOutcome: async (classification, usage) => {
      if (terminal) return;
      terminal = true;
      input.onOutcome(candidate, classification);
      await attempt.recordOutcome(classification, usage);
    },
    markCommitted: async () => {
      if (committed) return;
      committed = true;
      input.onCommitted(stored, candidate);
      await attempt.markCommitted();
    },
    complete: async (usage) => {
      if (terminal) return;
      terminal = true;
      input.onSuccess(stored, candidate);
      await attempt.complete(usage);
    },
    releaseCancelled: async () => {
      if (terminal) return;
      terminal = true;
      await attempt.releaseCancelled();
    },
  };
};
