/**
 * Gateway route settlement (spec D5 steps 5-7, §12.2): exactly ONE financial `control.cost_ledger` row per
 * settled request, fenced by `idempotency_key = requestId` in the database (never an in-memory
 * flag). One transaction locks the hold, prices every attempt at the quoted pricing versions,
 * inserts the row, settles or keeps the hold, moves reserve to spend, audits overruns and appends
 * the settlement outbox event. No cap predicate: an overrun is charged in full. The observe-only
 * `recordLlmUsage` uses separate call IDs and null hold/cost for observations. Readers select
 * financial rows by hold_id IS NOT NULL and never sum tokens across both roles. The database is injected.
 */
import { sql } from 'drizzle-orm';
import type { MiddlewareHandler } from 'hono';
import type { NativeUsagePricing } from '@sentropic/llm-mesh';
import type { CallerAuthPort, CostContext, RouteAttemptSettlement, RouteMeteringSink, RouteRequestSettlement } from '@sentropic/llm-gateway';
import { ensureCheckedGatewayBody, gatewayRequestBodyLimit, isGatewayBodyPath } from '@sentropic/llm-gateway';

import { createId } from '../../utils/id';
import { outboxWriter } from '../outbox/outbox-writer';
import {
  lockBudgets, modelBucketKey, nativePricingEligible, pgTextArray, priceWeight, principalOf, usageCost, type LedgerDatabase, type LedgerTx, type PricingRow,
} from './budget-admission';

// --- Operation (generate | stream) of a settled request, carried from ingress to settlement. ---
const SETTLEMENT_MODE_HEADER = 'x-sentropic-internal-settlement-mode';
const modes = new WeakMap<object, 'generate' | 'stream'>();

/** Records the wire mode on a trusted internal header; any client-supplied value is discarded. */
export const settlementModeMiddleware = (): MiddlewareHandler => async (context, next) => {
  const headers = context.req.raw.headers;
  headers.delete(SETTLEMENT_MODE_HEADER);
  if (isGatewayBodyPath(context.req.raw)) {
    // Also protects standalone hosts whose settlement middleware precedes the shared router.
    return gatewayRequestBodyLimit()(context, async () => {
      if (!new URL(context.req.raw.url).pathname.endsWith('/messages/count_tokens')) {
        const body = (await ensureCheckedGatewayBody(context.req.raw)).body as { stream?: unknown } | null;
        headers.set(SETTLEMENT_MODE_HEADER, body?.stream === true ? 'stream' : 'generate');
      }
      await next();
    });
  }
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

const UNCERTAINTIES = ['incomplete_input', 'invalid_input', 'cache_write_split_unknown', 'served_model_unverified',
  'served_model_mismatch', 'input_breakdown_changed', 'incomplete_output', 'invalid_output', 'missing_usage'];
const source = (value: unknown) => typeof value === 'string' && ['json', 'message_start', 'message_delta'].includes(value) ? value : undefined;
const reason = (value: unknown) => typeof value === 'string' && UNCERTAINTIES.includes(value) ? value : undefined;

export interface LedgerAttempt extends NativeUsagePricing {
  readonly providerId?: string;
  readonly modelId?: string;
  readonly transportProviderId?: string;
  readonly outcome?: string;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly estimated: boolean;
  readonly costMicroUsd: number;
  readonly pricingVersion?: string;
  readonly nativeSelectedModelId?: string;
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
    nativeInputPriceUnits40: Number.isSafeInteger(attempt.usage?.nativeInputPriceUnits40)
      && attempt.usage.nativeInputPriceUnits40! >= 0 ? attempt.usage.nativeInputPriceUnits40 : undefined,
    nativePricingPolicy: attempt.usage?.nativePricingPolicy === 'anthropic-cache-2026-10-02'
      ? attempt.usage.nativePricingPolicy : undefined,
    nativeServedModelId: id(attempt.usage?.nativeServedModelId),
    nativeSelectedModelId: attempt.usage?.nativeInputUsageValidated !== undefined ? id(attempt.modelId) : undefined,
    nativeInputUsageValidated: typeof attempt.usage?.nativeInputUsageValidated === 'boolean'
      ? attempt.usage.nativeInputUsageValidated : undefined,
    nativeInputUsageSource: source(attempt.usage?.nativeInputUsageSource),
    nativeUsageUncertainty: reason(attempt.usage?.nativeUsageUncertainty),
    nativeCacheWriteSplitReason: attempt.usage?.nativeCacheWriteSplitReason === 'cache_write_split_inferred'
      ? attempt.usage.nativeCacheWriteSplitReason : undefined,
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
    providerId: String(row.provider_id), modelId: String(row.model_id),
    id: String(row.id), input: big(row.input_micro_usd_per_mtok), output: big(row.output_micro_usd_per_mtok),
    reasoning: big(row.reasoning_micro_usd_per_mtok), image: big(row.image_micro_usd_per_unit),
    toolCall: big(row.tool_call_micro_usd_per_unit), minCharge: big(row.min_charge_micro_usd),
  }]));
};

/** The most expensive pinned price: a served model outside the quote is never cheaper than the quote. */
const costliest = (pricing: Map<string, PricingRow>): PricingRow | undefined => [...pricing.values()]
  .sort((left, right) => (priceWeight(right) > priceWeight(left) ? 1 : priceWeight(right) < priceWeight(left) ? -1 : 0))[0];

export class RouteSettlementError extends Error {
  readonly code = 'llm_route_settlement_refused';
  constructor(message: string) { super(message); this.name = 'RouteSettlementError'; }
}

export interface RouteSettlementOptions {
  readonly database: LedgerDatabase;
  readonly now?: () => Date;
}

export const createRouteSettlement = (options: RouteSettlementOptions): RouteMeteringSink & {
  /** Readiness: the 0008 ledger attribution columns answer a bounded query. */
  probe(): Promise<boolean>;
} => {
  const { database } = options;
  const clock = options.now ?? (() => new Date());

  const settleIn = async (tx: LedgerTx, settlement: RouteRequestSettlement, now: Date): Promise<void> => {
    const { requestId, holdRef, cost } = settlement;
    const hold = await lockHold(tx, holdRef!);
    if (!hold || hold.requestId !== requestId || hold.tenantId !== cost.tenantId) {
      throw new RouteSettlementError('settlement does not match its hold');
    }
    const open = hold.status === 'held' || hold.status === 'dispatched';
    if (!open) {
      if (hold.status !== 'reconciled') return;
      // Only this hold's pending row can fence a correction. Foreign/observer rows cannot:
      // retain the conservative reaper charge until reconciliation can safely resolve them.
      const pending = await tx.execute(sql`SELECT id FROM control.cost_ledger
        WHERE idempotency_key = ${requestId} AND hold_id = ${holdRef} AND reconciliation_state = 'pending'
        FOR UPDATE`);
      if (pending.rows.length === 0) return;
    }
    const principal = principalOf(cost);
    const pricing = await pinnedPricing(tx, hold.pricingVersions);
    let total = 0n;
    const attempts = settlement.attempts.map((attempt) => {
      const exact = pricing.get(modelBucketKey(attempt.providerId, attempt.modelId));
      const price = exact ?? costliest(pricing);
      const context = { providerId: attempt.providerId, modelId: attempt.modelId,
        pricingMatch: exact ? 'exact' as const : 'costliest' as const };
      const charged = price ? usageCost(price, attempt.usage, context) : 0n;
      if (!price && (attempt.usage.inputTokens > 0 || attempt.usage.outputTokens > 0)) {
        throw new RouteSettlementError('dispatched attempt has no pinned price');
      }
      total += charged;
      const native = attempt.usage.nativeInputUsageValidated !== undefined || attempt.usage.nativePricingPolicy !== undefined
        || attempt.usage.nativeInputPriceUnits40 !== undefined;
      // Financial uncertainty never mutates the gateway's immutable pre-floor snapshot.
      const usage = native && price && !nativePricingEligible(price, attempt.usage, context)
        ? { ...attempt.usage, estimated: true, nativeInputPriceUnits40: undefined, nativeInputUsageValidated: false,
          nativeUsageUncertainty: attempt.usage.nativeUsageUncertainty ?? 'invalid_input' as const } : attempt.usage;
      return redactSettlementAttempt({ ...attempt, usage }, charged, price?.id);
    });
    const served = [...settlement.attempts].reverse().find((attempt) => attempt.usage.inputTokens > 0
      || attempt.usage.outputTokens > 0) ?? settlement.attempts.at(-1);
    const servedAttempt = served ? attempts[settlement.attempts.indexOf(served)] : undefined;
    const state = settlement.usage.estimated || attempts.some(attempt => attempt.estimated) ? 'estimated' : 'none';
    const values = {
      input: settlement.usage.inputTokens, output: settlement.usage.outputTokens,
      result: RESULT[settlement.outcome], attempts: JSON.stringify(attempts),
    };
    const inserted = await tx.execute(sql`INSERT INTO control.cost_ledger (id, idempotency_key, user_id, workspace_id,
        tenant_id, operation, provider_id, model_id, input_tokens, output_tokens, total_tokens, cost_micro_usd,
        principal_kind, principal_key, budget_strategy_id, pricing_version, result, hold_id, quote_ref,
        reconciliation_state, attempts)
      VALUES (${createId()}, ${requestId}, ${principal.kind === 'user' ? principal.key : null}, ${hold.workspaceId},
        ${hold.tenantId}, ${settlementOperation(cost)}, ${servedAttempt?.providerId ?? 'none'},
        ${servedAttempt?.modelId ?? (id(settlement.requestedModel) ?? 'none')}, ${values.input}, ${values.output},
        ${values.input + values.output}, ${total.toString()}, ${principal.kind}, ${principal.key}, ${hold.strategyId},
        ${servedAttempt?.pricingVersion ?? null}, ${values.result}, ${holdRef}, ${hold.quoteRef}, ${state},
        ${values.attempts}::jsonb)
      ON CONFLICT (idempotency_key) DO NOTHING RETURNING id`);
    const auditOverrun = async (charged: bigint): Promise<void> => {
      const mismatch = attempts.some(attempt => attempt.nativeUsageUncertainty === 'served_model_mismatch');
      if (!mismatch && (settlement.overrun?.length ?? 0) === 0 && charged <= hold.liability) return;
      await tx.execute(sql`INSERT INTO control.blocked_attempts (id, request_id, tenant_id, workspace_id, principal_kind,
          principal_key, budget_strategy_id, reason, requested_model, hold_id, quote_ref, liability_micro_usd)
        VALUES (${createId()}, ${requestId}, ${hold.tenantId}, ${hold.workspaceId}, ${principal.kind}, ${principal.key},
          ${hold.strategyId}, 'overrun', ${id(settlement.requestedModel) ?? null}, ${holdRef}, ${hold.quoteRef},
          ${charged.toString()})`);
    };
    if (inserted.rows.length === 0) {
      const [row] = (await tx.execute(sql`SELECT cost_micro_usd, reconciliation_state, hold_id FROM control.cost_ledger
        WHERE idempotency_key = ${requestId} FOR UPDATE`)).rows as Array<Record<string, unknown>>;
      if (row?.hold_id === holdRef) {
        // Fenced: a duplicate settlement or redelivery adds nothing. Only the reaper's conservative
        // estimate is corrected, once, to the actual charge (auditable: state becomes `reconciled`).
        if (hold.status !== 'reconciled' || row.reconciliation_state !== 'pending') return;
        const delta = total - BigInt(row.cost_micro_usd as string);
        await tx.execute(sql`UPDATE control.cost_ledger SET cost_micro_usd = ${total.toString()}, input_tokens = ${values.input},
            output_tokens = ${values.output}, total_tokens = ${values.input + values.output}, result = ${values.result},
            attempts = ${values.attempts}::jsonb, reconciliation_state = 'reconciled'
          WHERE idempotency_key = ${requestId}`);
        await lockBudgets(tx, hold.budgetIds);
        await tx.execute(sql`UPDATE control.budgets SET updated_at = ${now},
            spent_micro_usd = GREATEST(0, spent_micro_usd + ${delta.toString()}::bigint)
          WHERE id = ANY(${pgTextArray(hold.budgetIds)})`);
        await auditOverrun(total);
        return;
      }
      if (row && row.hold_id === null) {
        // A hold-less row keyed by this server request id (observer redelivery that arrived first):
        // the settlement is the authority for its request, so it becomes the request's financial row.
        await tx.execute(sql`UPDATE control.cost_ledger SET user_id = ${principal.kind === 'user' ? principal.key : null},
            workspace_id = ${hold.workspaceId}, tenant_id = ${hold.tenantId}, operation = ${settlementOperation(cost)},
            provider_id = ${servedAttempt?.providerId ?? 'none'},
            model_id = ${servedAttempt?.modelId ?? (id(settlement.requestedModel) ?? 'none')}, input_tokens = ${values.input},
            output_tokens = ${values.output}, total_tokens = ${values.input + values.output}, cost_micro_usd = ${total.toString()},
            principal_kind = ${principal.kind}, principal_key = ${principal.key}, budget_strategy_id = ${hold.strategyId},
            pricing_version = ${servedAttempt?.pricingVersion ?? null}, result = ${values.result}, hold_id = ${holdRef},
            quote_ref = ${hold.quoteRef}, reconciliation_state = ${state}, attempts = ${values.attempts}::jsonb
          WHERE idempotency_key = ${requestId}`);
      }
      // Otherwise the request id collides with another hold's row: that row is kept untouched and
      // this hold is still closed below with its full charge (never left for a zero-charge reaper).
    }
    // A reconciled hold was already charged its liability by the reaper: only the difference moves.
    const charge = hold.status === 'reconciled' ? total - hold.liability : total;
    await lockBudgets(tx, hold.budgetIds);
    await tx.execute(sql`UPDATE control.budgets SET updated_at = ${now},
        reserved_micro_usd = GREATEST(0, reserved_micro_usd - ${(open ? hold.liability : 0n).toString()}::bigint),
        spent_micro_usd = GREATEST(0, spent_micro_usd + ${charge.toString()}::bigint)
      WHERE id = ANY(${pgTextArray(hold.budgetIds)})`);
    await tx.execute(sql`UPDATE control.budget_holds SET updated_at = ${now}, settled_at = ${now},
        status = CASE WHEN status IN ('held', 'dispatched') THEN 'settled' ELSE status END
      WHERE id = ${holdRef}`);
    await auditOverrun(total);
    await outboxWriter.append(tx as Parameters<typeof outboxWriter.append>[0], {
      aggregateType: 'llm_request', aggregateId: requestId!, channel: 'llm_settlement',
      tenantId: hold.tenantId, workspaceId: hold.workspaceId,
      envelope: { type: 'llm.request.settled', requestId, holdId: holdRef, costMicroUsd: Number(total), result: values.result },
    });
  };

  return {
    async settleRoute(settlement) {
      if (!settlement.requestId || !settlement.holdRef) {
        throw new RouteSettlementError('gateway settlement requires an admitted request');
      }
      const now = clock();
      await database.transaction((tx) => settleIn(tx, settlement, now));
    },
    async probe() {
      await database.execute(sql`SELECT hold_id, quote_ref, principal_key, attempts FROM control.cost_ledger LIMIT 0`);
      return true;
    },
  };
};
