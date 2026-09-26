/**
 * Application budget admission (spec D5, §12.2; gateway `BudgetAdmissionPort`) over the 0008 tables.
 * One short transaction per admission: active tenant strategy, immutable pricing of every quoted
 * candidate, deterministic `FOR UPDATE` of every applicable bucket, then either one hold plus the
 * reserve increments, or one `blocked_attempts` row and no budget change. Store or pricing errors
 * resolve `unavailable` (sanitized 503), never `over-budget` and never a free hold.
 * Importing this module opens no connection: the database handle is injected.
 */
import { createHash } from 'node:crypto';

import { sql } from 'drizzle-orm';
import {
  modelProfiles, RoutePlanError, RouteQuoteError, type QuotedRouteCandidate, type RoutePlanner, type RouteQuote,
  type RouteQuoteInput, type RouteUsageCeiling,
} from '@sentropic/llm-mesh';
import type {
  BudgetAdmissionDecision, BudgetAdmissionPort, BudgetAdmissionRequest, CallerAuthPort, CostContext,
} from '@sentropic/llm-gateway';

import type { db } from '../../db/client';
import { createId } from '../../utils/id';

export type LedgerDatabase = Pick<typeof db, 'transaction' | 'execute'>;
export type LedgerTx = Parameters<Parameters<LedgerDatabase['transaction']>[0]>[0];

/** Input side of the quote is an estimate (bytes / 4): reserved with this margin, in percent. */
export const DEFAULT_INPUT_MARGIN_PERCENT = 25;
/** Hold lifetime; the reaper expires holds past it (release or conservative reconciliation). */
export const DEFAULT_HOLD_TTL_MS = 30 * 60_000;
/** Output reserved for a codex-like candidate whose model declares no maximum output. */
export const DEFAULT_UNENFORCED_OUTPUT_TOKENS = 128_000;

export interface PricingRow {
  readonly id: string;
  readonly input: bigint;
  readonly output: bigint;
  readonly reasoning: bigint;
  readonly image: bigint;
  readonly toolCall: bigint;
  readonly minCharge: bigint;
}

const big = (value: unknown): bigint => (value === null || value === undefined ? 0n : BigInt(value as string | number));
/** One `text[]` bind parameter (a Postgres array literal), never an expanded value list. */
export const pgTextArray = (values: readonly string[]) =>
  sql`${`{${values.map((value) => `"${value.replace(/[\\"]/g, (char) => `\\${char}`)}"`).join(',')}}`}::text[]`;
const perMtok =(tokens: number, rate: bigint): bigint => (BigInt(Math.max(0, Math.ceil(tokens))) * rate + 999_999n) / 1_000_000n;

/** Pricing row in force at `at` for one provider/model, or undefined (fail closed). */
export const loadPricing = async (tx: LedgerTx, providerId: string, modelId: string, at: Date): Promise<PricingRow | undefined> => {
  const [row] = (await tx.execute(sql`SELECT id, input_micro_usd_per_mtok, output_micro_usd_per_mtok,
      reasoning_micro_usd_per_mtok, image_micro_usd_per_unit, tool_call_micro_usd_per_unit, min_charge_micro_usd
    FROM control.model_pricing WHERE provider_id = ${providerId} AND model_id = ${modelId}
      AND effective_from <= ${at} AND (effective_to IS NULL OR effective_to > ${at})
    ORDER BY effective_from DESC LIMIT 1`)).rows as Array<Record<string, unknown>>;
  return row ? {
    id: String(row.id), input: big(row.input_micro_usd_per_mtok), output: big(row.output_micro_usd_per_mtok),
    reasoning: big(row.reasoning_micro_usd_per_mtok), image: big(row.image_micro_usd_per_unit),
    toolCall: big(row.tool_call_micro_usd_per_unit), minCharge: big(row.min_charge_micro_usd),
  } : undefined;
};

/**
 * Liability of one attempt. The candidate carries no reasoning effort, so the output allowance is
 * priced at the maximum of the output and reasoning rates (maximum over effort variants).
 */
export const attemptLiability = (price: PricingRow, allowance: RouteUsageCeiling, outputTokens: number): bigint => {
  const outputRate = price.reasoning > price.output ? price.reasoning : price.output;
  const total = perMtok(allowance.inputTokens, price.input) + perMtok(outputTokens, outputRate)
    + BigInt(allowance.imageUnits ?? 0) * price.image + BigInt(allowance.toolCalls ?? 0) * price.toolCall;
  return total > price.minCharge ? total : price.minCharge;
};

/** Actual cost of one dispatched attempt; zero usage (never dispatched) costs nothing. */
export const usageCost = (price: PricingRow, usage: { inputTokens: number; outputTokens: number }): bigint => {
  if (usage.inputTokens <= 0 && usage.outputTokens <= 0) return 0n;
  const total = perMtok(usage.inputTokens, price.input) + perMtok(usage.outputTokens, price.output);
  return total > price.minCharge ? total : price.minCharge;
};

export type PrincipalKind = 'user' | 'service';
export class PrincipalKeyError extends Error {
  constructor() { super('principal is not an opaque identifier'); this.name = 'PrincipalKeyError'; }
}

const OPAQUE = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/;
const IPV4 = /(^|:)\d{1,3}(\.\d{1,3}){3}$/;

/**
 * `principal_key` is the verified opaque principal id (user id or `service:<client id>`), never an
 * e-mail or IP: anything that is not an opaque token (`@`, spaces, dotted quad, IPv6 groups) refuses.
 */
export const principalOf = (cost: Pick<CostContext, 'principalId'>): { kind: PrincipalKind; key: string } => {
  const id = cost.principalId;
  if (typeof id !== 'string' || !OPAQUE.test(id) || IPV4.test(id) || /:[0-9a-f]{0,4}:/i.test(id.replace(/^service:/, ''))) {
    throw new PrincipalKeyError();
  }
  return { kind: id.startsWith('service:') ? 'service' : 'user', key: id };
};

export const modelBucketKey = (providerId: string, modelId: string): string => `${providerId}/${modelId}`;

const startOfNextMonth = (at: Date): Date => new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth() + 1, 1));

export interface BudgetAdmissionOptions {
  readonly database: LedgerDatabase;
  /** Fenced owner of holds created by this process (host instance reference). */
  readonly ownerRef: string;
  readonly now?: () => Date;
  readonly holdTtlMs?: number;
  readonly inputMarginPercent?: number;
  readonly maxOutputTokensFor?: (providerId: string, modelId: string) => number | undefined;
}

const profileMaxOutput = (providerId: string, modelId: string): number | undefined =>
  modelProfiles.find((profile) => profile.providerId === providerId && profile.modelId === modelId)
    ?.capabilities.maxOutputTokens;

export const quoteHash = (value: unknown): string => createHash('sha256').update(JSON.stringify(value)).digest('hex');

type BlockReason = 'cap' | 'no_pricing' | 'no_strategy' | 'missing_bucket';

interface Bucket { id: string; scopeKind: string; cap: bigint | null; reserved: bigint; spent: bigint; resetAt: Date }

export const createBudgetAdmission = (options: BudgetAdmissionOptions): BudgetAdmissionPort & {
  /** Readiness: the 0008 admission tables answer a bounded query. */
  probe(): Promise<boolean>;
} => {
  const { database } = options;
  const clock = options.now ?? (() => new Date());
  const margin = options.inputMarginPercent ?? DEFAULT_INPUT_MARGIN_PERCENT;
  const ttl = options.holdTtlMs ?? DEFAULT_HOLD_TTL_MS;
  const maxOutputFor = options.maxOutputTokensFor ?? profileMaxOutput;

  const reservedOutput = (candidate: QuotedRouteCandidate): number => candidate.outputCeilingEnforced
    ? candidate.allowance.outputTokens
    : Math.max(candidate.allowance.outputTokens,
      maxOutputFor(candidate.providerId, candidate.modelId) ?? DEFAULT_UNENFORCED_OUTPUT_TOKENS);

  const admitIn = async (tx: LedgerTx, request: BudgetAdmissionRequest, now: Date): Promise<BudgetAdmissionDecision> => {
    const { cost, quote } = request;
    const principal = principalOf(cost);
    const block = async (reason: BlockReason, extra: { strategyId?: string; budgetId?: string;
      liability?: bigint; resetAt?: Date } = {}): Promise<void> => {
      await tx.execute(sql`INSERT INTO control.blocked_attempts (id, request_id, tenant_id, workspace_id, principal_kind,
          principal_key, budget_strategy_id, reason, budget_id, requested_model, quote_ref, liability_micro_usd, reset_at)
        VALUES (${createId()}, ${request.requestId}, ${cost.tenantId}, ${cost.workspaceId ?? null}, ${principal.kind},
          ${principal.key}, ${extra.strategyId ?? null}, ${reason}, ${extra.budgetId ?? null}, ${quote.requestedModel},
          ${quote.quoteRef}, ${extra.liability === undefined ? null : extra.liability.toString()}, ${extra.resetAt ?? null})`);
    };
    const [strategy] = (await tx.execute(sql`SELECT id FROM control.tenant_budget_strategy
      WHERE tenant_id = ${cost.tenantId} AND status = 'active' LIMIT 1`)).rows as Array<{ id: string }>;
    if (!strategy) { await block('no_strategy'); return { kind: 'unavailable' }; }
    const strategyId = strategy.id;

    let maxCandidate = 0n;
    const pricingVersions = new Set<string>();
    for (const candidate of quote.candidates) {
      const price = await loadPricing(tx, candidate.providerId, candidate.modelId, now);
      if (!price) { await block('no_pricing', { strategyId }); return { kind: 'unavailable' }; }
      pricingVersions.add(price.id);
      const allowance = { ...candidate.allowance, inputTokens: Math.ceil(candidate.allowance.inputTokens * (100 + margin) / 100) };
      const liability = attemptLiability(price, allowance, reservedOutput(candidate));
      if (liability > maxCandidate) maxCandidate = liability;
    }
    if (quote.candidates.length === 0 || !Number.isSafeInteger(quote.maxAttempts) || quote.maxAttempts < 1) {
      return { kind: 'unavailable' };
    }
    const liability = BigInt(quote.maxAttempts) * maxCandidate;

    const modelKeys = quote.candidates.map((candidate) => modelBucketKey(candidate.providerId, candidate.modelId));
    const rows = (await tx.execute(sql`SELECT id, scope_kind, cap_micro_usd, reserved_micro_usd, spent_micro_usd, reset_at
      FROM control.budgets WHERE tenant_id = ${cost.tenantId} AND period = 'monthly' AND (
        (scope_kind = 'tenant' AND scope_key = ${cost.tenantId})
        OR (scope_kind = 'workspace' AND workspace_id = ${cost.workspaceId ?? null} AND scope_key = ${cost.workspaceId ?? null})
        OR (scope_kind = 'principal' AND scope_key = ${principal.key})
        OR (scope_kind = 'model' AND scope_key = ANY(${pgTextArray(modelKeys)})))
      ORDER BY id FOR UPDATE`)).rows as Array<Record<string, unknown>>;
    const buckets: Bucket[] = rows.map((row) => ({
      id: String(row.id), scopeKind: String(row.scope_kind),
      cap: row.cap_micro_usd === null ? null : big(row.cap_micro_usd),
      reserved: big(row.reserved_micro_usd), spent: big(row.spent_micro_usd), resetAt: new Date(row.reset_at as string),
    }));
    if (!buckets.some((bucket) => bucket.scopeKind === 'tenant')) {
      await block('missing_bucket', { strategyId, liability });
      return { kind: 'unavailable' };
    }
    for (const bucket of buckets.filter((entry) => entry.resetAt.getTime() <= now.getTime())) {
      bucket.spent = 0n;
      bucket.resetAt = startOfNextMonth(now);
      await tx.execute(sql`UPDATE control.budgets SET spent_micro_usd = 0, reset_at = ${bucket.resetAt}, updated_at = ${now}
        WHERE id = ${bucket.id}`);
    }
    const blocking = buckets.filter((bucket) => bucket.cap !== null && bucket.spent + bucket.reserved + liability > bucket.cap);
    if (blocking.length > 0) {
      const resetAtMs = Math.max(...blocking.map((bucket) => bucket.resetAt.getTime()));
      await block('cap', { strategyId, budgetId: blocking[0]!.id, liability, resetAt: new Date(resetAtMs) });
      return { kind: 'over-budget', resetAtMs };
    }
    const ids = buckets.map((bucket) => bucket.id);
    await tx.execute(sql`UPDATE control.budgets SET reserved_micro_usd = reserved_micro_usd + ${liability.toString()},
      updated_at = ${now} WHERE id = ANY(${pgTextArray(ids)})`);
    const holdRef = `hold_${createId()}`;
    await tx.execute(sql`INSERT INTO control.budget_holds (id, request_id, tenant_id, workspace_id, principal_kind,
        principal_key, budget_strategy_id, budget_ids, quote_ref, pricing_versions, liability_micro_usd, status, owner_ref,
        deadline_at, created_at, updated_at)
      VALUES (${holdRef}, ${request.requestId}, ${cost.tenantId}, ${cost.workspaceId ?? null}, ${principal.kind},
        ${principal.key}, ${strategyId}, ${pgTextArray(ids)}, ${quote.quoteRef}, ${pgTextArray([...pricingVersions])}, ${liability.toString()}, 'held',
        ${options.ownerRef}, ${new Date(now.getTime() + ttl)}, ${now}, ${now})`);
    return { kind: 'admitted', holdRef };
  };

  return {
    async admit(request) {
      try {
        const now = clock();
        return await database.transaction((tx) => admitIn(tx, request, now));
      } catch {
        return { kind: 'unavailable' };
      }
    },

    async markDispatched(holdRef, attemptIndex) {
      const now = clock();
      const { rows } = await database.execute(sql`UPDATE control.budget_holds SET status = 'dispatched',
          dispatch_started_at = COALESCE(dispatch_started_at, ${now}),
          dispatched_attempts = GREATEST(dispatched_attempts, ${attemptIndex + 1}), fence = fence + 1, updated_at = ${now}
        WHERE id = ${holdRef} AND status IN ('held', 'dispatched') AND deadline_at > ${now} RETURNING id`);
      if (rows.length !== 1) throw new Error('budget hold is not dispatchable');
    },

    async release(holdRef) {
      const now = clock();
      await database.transaction(async (tx) => {
        const [hold] = (await tx.execute(sql`SELECT status, dispatch_started_at, liability_micro_usd, budget_ids
          FROM control.budget_holds WHERE id = ${holdRef} FOR UPDATE`)).rows as Array<Record<string, unknown>>;
        // Idempotent; a durable dispatch marker (even from an ambiguous failure) keeps the hold.
        if (!hold || hold.status !== 'held' || hold.dispatch_started_at !== null) return;
        await tx.execute(sql`UPDATE control.budget_holds SET status = 'released', settled_at = ${now}, updated_at = ${now}
          WHERE id = ${holdRef}`);
        await tx.execute(sql`UPDATE control.budgets SET updated_at = ${now},
            reserved_micro_usd = GREATEST(0, reserved_micro_usd - ${String(hold.liability_micro_usd)}::bigint)
          WHERE id = ANY(${pgTextArray(hold.budget_ids as string[])})`);
      });
    },

    async probe() {
      await database.execute(sql`SELECT (SELECT count(*) FROM (SELECT 1 FROM control.tenant_budget_strategy LIMIT 1) s)
        + (SELECT count(*) FROM (SELECT 1 FROM control.budgets LIMIT 1) b)
        + (SELECT count(*) FROM (SELECT 1 FROM control.model_pricing LIMIT 1) p)
        + (SELECT count(*) FROM (SELECT id FROM control.budget_holds LIMIT 1) h) AS n`);
      return true;
    },
  };
};
