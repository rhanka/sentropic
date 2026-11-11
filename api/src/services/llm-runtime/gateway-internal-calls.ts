/**
 * CMP-L3 internal calls through the in-process gateway, code only, flag-gated.
 *
 * Disabled (default): delegates directly to the existing runtime (current
 * behavior, no change). Enabled: validates the app workload principal and
 * per-app partition before dispatching in-process (no HTTP, no state move).
 * Existing call sites migrate opt-in; none are switched here (preprod-safe).
 */
import {
  appWorkloadCostContext, createAppPartitionPolicy,
  type AppWorkloadPrincipal,
} from './gateway-cm-app-workload';

export const isInternalGatewayEnabled = (): boolean =>
  process.env.CM_INTERNAL_GW_ENABLED === '1';

export type InternalCallMode = 'direct' | 'gateway';

export const selectInternalCallMode = (): InternalCallMode =>
  (isInternalGatewayEnabled() ? 'gateway' : 'direct');

/** Admission before in-process dispatch; fail closed on malformed scope. */
export const admitInternalCall = (
  principal: AppWorkloadPrincipal,
  quotaBytes: number,
  callSite: string,
): { readonly budgetScope: string } => {
  const cost = appWorkloadCostContext(principal, callSite);
  createAppPartitionPolicy({ quotaBytes });
  if (!cost.budgetScope) throw new Error('internal gateway admission refused');
  return { budgetScope: cost.budgetScope };
};

/** Promise wrapper: direct today, admission + direct when enabled. */
export const callViaGateway = async <T>(
  principal: AppWorkloadPrincipal,
  quotaBytes: number,
  callSite: string,
  direct: () => Promise<T>,
): Promise<T> => {
  if (!isInternalGatewayEnabled()) return direct();
  admitInternalCall(principal, quotaBytes, callSite);
  return direct();
};
