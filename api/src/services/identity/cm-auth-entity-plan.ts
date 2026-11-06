import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import { IdentityCustodyErrorV1 } from '@sentropic/cluster-mesh';

export interface CmAuthEntityPlan {
  readonly workspaceId: string;
  readonly attemptUuid: () => () => string;
}
const current = new AsyncLocalStorage<CmAuthEntityPlan>();

/** Only prospective opaque ids survive retries; proof/token bytes never enter this plan. */
export function createCmAuthEntityPlan(): CmAuthEntityPlan {
  const workspaceId = randomUUID(), ids = Array.from({ length: 64 }, () => randomUUID());
  return { workspaceId, attemptUuid() {
    let cursor = 0;
    return () => ids[cursor++] ?? (() => { throw new IdentityCustodyErrorV1('identity_transaction_unbound'); })();
  } };
}
export const withCmAuthEntityPlan = <T>(plan: CmAuthEntityPlan, operation: () => Promise<T>): Promise<T> => current.run(plan, operation);
export const plannedCmAuthWorkspaceId = (): string => {
  const plan = current.getStore();
  if (!plan) throw new IdentityCustodyErrorV1('identity_transaction_unbound');
  return plan.workspaceId;
};
