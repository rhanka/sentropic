export type TenantContext = {
  tenantId: string;
  workspaceId: string;
  userId: string;
  sessionId?: string;
  runId?: string;
};

export type PermissionMode =
  | 'untrusted'
  | 'on-request'
  | 'on-failure'
  | 'never'
  | 'granular';

export type AuthzContext = {
  caller: TenantContext;
  allowedTools: ReadonlySet<string>;
  permissionMode: PermissionMode;
};

export type CostContext = {
  budgetTokens?: number;
  budgetSpendUsd?: number;
  spentTokens: number;
  spentUsd: number;
};

declare const IdempotencyKeyBrand: unique symbol;
export type IdempotencyKey = string & { readonly [IdempotencyKeyBrand]: true };
export const idempotencyKey = (raw: string): IdempotencyKey =>
  raw as IdempotencyKey;

export type CheckpointVersion = {
  hash: string;
  monotonicSeq: number;
  previousHash?: string;
};

export type EventEnvelope<TPayload> = {
  type: string;
  seq: number;
  ts: string;
  tenant: TenantContext;
  payload: TPayload;
  redactedFields?: ReadonlyArray<string>;
  signature?: string;
};
