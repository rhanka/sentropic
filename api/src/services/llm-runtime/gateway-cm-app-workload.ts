/**
 * CMP-L1 app workload principal (GD-14), code only, flag-gated.
 *
 * Disabled by default: `CM_APP_WORKLOAD_ENABLED !== '1'` keeps the product
 * gateway refused behavior. No state move, no migration, no DB import.
 * Pure module: validation only, so tests run without a database.
 */
import type { CostContext } from '@sentropic/llm-gateway';

export const isCmAppWorkloadEnabled = (): boolean =>
  process.env.CM_APP_WORKLOAD_ENABLED === '1';

export interface AppWorkloadPrincipal {
  readonly tenantId: string;
  readonly workspaceId: string;
  readonly appInstanceId: string;
}

const nonEmpty = (value: unknown): value is string =>
  typeof value === 'string' && value.trim() !== '' && value === value.trim();

const APP_INSTANCE_ID = /^[A-Za-z0-9_-]+$/;

/** Fail closed: malformed workload principals never resolve. */
export const assertAppWorkloadPrincipal = (principal: AppWorkloadPrincipal): void => {
  if (!nonEmpty(principal?.tenantId)) throw new Error('app workload needs tenantId');
  if (!nonEmpty(principal?.workspaceId)) throw new Error('app workload needs workspaceId');
  if (!nonEmpty(principal?.appInstanceId) || !APP_INSTANCE_ID.test(principal.appInstanceId)) {
    throw new Error('app workload needs appInstanceId ^[A-Za-z0-9_-]+$');
  }
};

export const appWorkloadCostContext = (
  principal: AppWorkloadPrincipal,
  callSite: string,
): CostContext => {
  assertAppWorkloadPrincipal(principal);
  if (!nonEmpty(callSite)) throw new Error('app workload needs callSite');
  return {
    tenantId: principal.tenantId,
    workspaceId: principal.workspaceId,
    principalId: `service:app:${principal.appInstanceId}`,
    ownerScopeRef: `workspace:${principal.workspaceId}:principal:service:app:${principal.appInstanceId}`,
    source: 'cm-app-workload',
    correlationId: crypto.randomUUID(),
    callSite,
    budgetScope: `app:${principal.appInstanceId}`,
  };
};

export interface ServiceClientWorkloadBinding {
  readonly clientId: string;
  readonly tenantId: string;
  readonly workspaceId: string;
  readonly appInstanceId: string;
  readonly revoked: boolean;
  readonly expiresAt?: string | null;
}

/** Fail closed: revoked, expired or scope-mismatched bindings never authenticate. */
export const assertServiceClientWorkloadBinding = (
  binding: ServiceClientWorkloadBinding,
  principal: AppWorkloadPrincipal,
  now: Date = new Date(),
): void => {
  assertAppWorkloadPrincipal(principal);
  if (!nonEmpty(binding?.clientId)) throw new Error('service binding needs clientId');
  if (binding.revoked) throw new Error('service binding revoked');
  if (binding.expiresAt && now >= new Date(binding.expiresAt)) {
    throw new Error('service binding expired');
  }
  if (binding.tenantId !== principal.tenantId
    || binding.workspaceId !== principal.workspaceId
    || binding.appInstanceId !== principal.appInstanceId) {
    throw new Error('service binding scope mismatch');
  }
};

export interface AppPartitionPolicy {
  readonly quotaBytes: number;
  readonly maxBytes: number;
  readonly ratePerWindow: number;
  readonly windowSeconds: number;
}

/** Pure per-app budget partition (GD-14, O7/O8); bounds fail closed. */
export const createAppPartitionPolicy = (input: {
  readonly quotaBytes: number;
  readonly maxBytes?: number;
  readonly ratePerWindow?: number;
  readonly windowSeconds?: number;
}): AppPartitionPolicy => {
  if (!Number.isFinite(input.quotaBytes) || input.quotaBytes <= 0) {
    throw new Error('quotaBytes must be positive');
  }
  const maxBytes = input.maxBytes ?? 524288;
  const ratePerWindow = input.ratePerWindow ?? 60;
  const windowSeconds = input.windowSeconds ?? 60;
  if (!Number.isFinite(maxBytes) || maxBytes <= 0) throw new Error('maxBytes must be positive');
  if (!Number.isFinite(ratePerWindow) || ratePerWindow <= 0) {
    throw new Error('ratePerWindow must be positive');
  }
  if (!Number.isFinite(windowSeconds) || windowSeconds <= 0) {
    throw new Error('windowSeconds must be positive');
  }
  return { quotaBytes: input.quotaBytes, maxBytes, ratePerWindow, windowSeconds };
};
