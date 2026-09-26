/**
 * Gateway route settlement (spec D5 steps 5-7, §12.2): exactly ONE `control.cost_ledger` row per
 * settled request, fenced by `idempotency_key = requestId` in the database (never an in-memory
 * flag). One transaction locks the hold, prices every attempt at the quoted pricing versions,
 * inserts the row, settles or keeps the hold, moves reserve to spend, audits overruns and appends
 * the settlement outbox event. No cap predicate: an overrun is charged in full. The observe-only
 * `recordLlmUsage` sink is never wired here. The database handle is injected.
 */
import { sql } from 'drizzle-orm';
import type { MiddlewareHandler } from 'hono';
import type { CallerAuthPort, CostContext, RouteAttemptSettlement, RouteMeteringSink, RouteRequestSettlement } from '@sentropic/llm-gateway';

import { createId } from '../../utils/id';
import { outboxWriter } from '../outbox/outbox-writer';
import {
  modelBucketKey, pgTextArray, principalOf, usageCost, type LedgerDatabase, type LedgerTx, type PricingRow,
} from './budget-admission';

// --- Operation (generate | stream) of a settled request, carried from ingress to settlement. ---
const SETTLEMENT_MODE_HEADER = 'x-sentropic-internal-settlement-mode';
const modes = new WeakMap<object, 'generate' | 'stream'>();

/** Records the wire mode on a trusted internal header; any client-supplied value is discarded. */
export const settlementModeMiddleware = (): MiddlewareHandler => async (context, next) => {
  const headers = context.req.raw.headers;
  headers.delete(SETTLEMENT_MODE_HEADER);
  let stream = false;
  if (context.req.method === 'POST') {
    try {
      const body = await context.req.raw.clone().json() as { stream?: unknown };
      stream = body?.stream === true;
    } catch { /* The gateway answers the malformed body itself. */ }
  }
  headers.set(SETTLEMENT_MODE_HEADER, stream ? 'stream' : 'generate');
  await next();
};

/** Binds the recorded mode to the verified cost context (the object settlement receives). */
export const withSettlementMode = (inner: CallerAuthPort): CallerAuthPort => ({
  async verify(headers, context) {
    const mode = headers[SETTLEMENT_MODE_HEADER] === 'stream' ? 'stream' : 'generate';
    delete (headers as Record<string, string>)[SETTLEMENT_MODE_HEADER];
    const result = await inner.verify(headers, context);
    if (!result.ok || !result.cost) return result;
    const cost: CostContext = { ...result.cost };
    modes.set(cost, mode);
    return { ...result, cost };
  },
});

export const settlementOperation = (cost: CostContext): 'generate' | 'stream' => modes.get(cost) ?? 'generate';

// --- Redacted per-attempt breakdown: a closed allowlist of ids and numbers. ---
const ID = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/;
const CODE = /^[a-z][a-z0-9-]{0,39}$/;
const id = (value: unknown): string | undefined => (typeof value === 'string' && ID.test(value) ? value : undefined);
const count = (value: unknown): number => (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : 0);

export interface LedgerAttempt {
  readonly providerId?: string;
  readonly modelId?: string;
  readonly transportProviderId?: string;
  readonly outcome?: string;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly estimated: boolean;
  readonly costMicroUsd: number;
  readonly pricingVersion?: string;
}

/**
 * Builds each attempt from named fields only: ids must be id-shaped, the outcome code-shaped,
 * numbers finite non-negative integers. Anything else (prose, plan/candidate refs, account ids,
 * unexpected fields) is dropped, so no prompt, completion or account text can reach the ledger.
 */
export const redactSettlementAttempt = (attempt: RouteAttemptSettlement, cost: bigint, pricingVersion?: string): LedgerAttempt => {
  const fields: Record<string, unknown> = {
    providerId: id(attempt.providerId), modelId: id(attempt.modelId), transportProviderId: id(attempt.transportProviderId),
    outcome: typeof attempt.outcome === 'string' && CODE.test(attempt.outcome) ? attempt.outcome : undefined,
    inputTokens: count(attempt.usage?.inputTokens), outputTokens: count(attempt.usage?.outputTokens),
    estimated: attempt.usage?.estimated === true, costMicroUsd: Number(cost), pricingVersion: id(pricingVersion),
  };
  return Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined)) as unknown as LedgerAttempt;
};

const RESULT: Record<RouteRequestSettlement['outcome'], 'ok' | 'error' | 'aborted'> = {
  success: 'ok', failed: 'error', cancelled: 'aborted',
};

interface HoldRow {
  requestId: string; status: string; liability: bigint; budgetIds: string[]; strategyId: string;
  pricingVersions: string[]; quoteRef: string; tenantId: string; workspaceId: string | null;
}

const lockHold = async (tx: LedgerTx, holdRef: string): Promise<HoldRow | undefined> => {
  const [row] = (await tx.execute(sql`SELECT request_id, status, liability_micro_usd, budget_ids, budget_strategy_id,
      pricing_versions, quote_ref, tenant_id, workspace_id
    FROM control.budget_holds WHERE id = ${holdRef} FOR UPDATE`)).rows as Array<Record<string, unknown>>;
  return row ? {
    requestId: String(row.request_id), status: String(row.status), liability: BigInt(row.liability_micro_usd as string),
    budgetIds: row.budget_ids as string[], strategyId: String(row.budget_strategy_id),
    pricingVersions: row.pricing_versions as string[], quoteRef: String(row.quote_ref),
    tenantId: String(row.tenant_id), workspaceId: (row.workspace_id as string | null) ?? null,
  } : undefined;
};

/** Pricing rows pinned by the hold (quoted versions), keyed by provider/model. */
const pinnedPricing = async (tx: LedgerTx, ids: readonly string[]): Promise<Map<string, PricingRow>> => {
  const rows = (await tx.execute(sql`SELECT id, provider_id, model_id, input_micro_usd_per_mtok, output_micro_usd_per_mtok,
      reasoning_micro_usd_per_mtok, image_micro_usd_per_unit, tool_call_micro_usd_per_unit, min_charge_micro_usd
    FROM control.model_pricing WHERE id = ANY(${pgTextArray(ids)})`)).rows as Array<Record<string, unknown>>;
  const big = (value: unknown) => (value === null || value === undefined ? 0n : BigInt(value as string));
  return new Map(rows.map((row) => [modelBucketKey(String(row.provider_id), String(row.model_id)), {
    id: String(row.id), input: big(row.input_micro_usd_per_mtok), output: big(row.output_micro_usd_per_mtok),
    reasoning: big(row.reasoning_micro_usd_per_mtok), image: big(row.image_micro_usd_per_unit),
    toolCall: big(row.tool_call_micro_usd_per_unit), minCharge: big(row.min_charge_micro_usd),
  }]));
};

/** The most expensive pinned price: a served model outside the quote is never cheaper than the quote. */
const costliest = (pricing: Map<string, PricingRow>): PricingRow | undefined => [...pricing.values()]
  .sort((left, right) => Number((right.input + right.output) - (left.input + left.output)))[0];
