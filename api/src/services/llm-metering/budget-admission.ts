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
  EXCLUSIVE_LAUNCH_ALIAS_TARGET_MAPPINGS, isNativeMessagesTarget, validateNativeModelAllowlist, modelProfiles, providerProfiles, RoutePlanError, RouteQuoteError, type QuotedRouteCandidate, type RoutePlanner, type RouteQuote,
  type RouteQuoteInput, type RouteUsageCeiling, type NativeUsagePricing,
} from '@sentropic/llm-mesh';
import { validateNativeInputPriceUnits40 } from '@sentropic/llm-gateway';
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
  /** Database identity; optional only for existing canonical callers/fixtures. */
  readonly providerId?: string;
  readonly modelId?: string;
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
  const [row] = (await tx.execute(sql`SELECT id, provider_id, model_id, input_micro_usd_per_mtok, output_micro_usd_per_mtok,
      reasoning_micro_usd_per_mtok, image_micro_usd_per_unit, tool_call_micro_usd_per_unit, min_charge_micro_usd
    FROM control.model_pricing WHERE provider_id = ${providerId} AND model_id = ${modelId}
      AND effective_from <= ${at} AND (effective_to IS NULL OR effective_to > ${at})
    ORDER BY effective_from DESC LIMIT 1`)).rows as Array<Record<string, unknown>>;
  return row ? {
    providerId: typeof row.provider_id === 'string' ? row.provider_id : undefined,
    modelId: typeof row.model_id === 'string' ? row.model_id : undefined,
    id: String(row.id), input: big(row.input_micro_usd_per_mtok), output: big(row.output_micro_usd_per_mtok),
    reasoning: big(row.reasoning_micro_usd_per_mtok), image: big(row.image_micro_usd_per_unit),
    toolCall: big(row.tool_call_micro_usd_per_unit), minCharge: big(row.min_charge_micro_usd),
  } : undefined;
};

/** Exact pinned lookup is separate from selecting the costliest row, even when IDs/rates match. */
export interface AttemptPricingContext {
  readonly providerId: string;
  readonly modelId: string;
  readonly pricingMatch: 'exact' | 'costliest';
}

export interface PricedUsage extends NativeUsagePricing {
  inputTokens: number; outputTokens: number; imageUnits?: number; toolCalls?: number;
}

/** Trusted exact pinned identity and gateway proof, never inferred from rates or selected IDs. */
export const nativePricingEligible = (price: PricingRow, usage: PricedUsage, context?: AttemptPricingContext): boolean => {
  if (!context || context.pricingMatch !== 'exact' || context.providerId !== 'anthropic'
    || price.providerId !== context.providerId || price.modelId !== context.modelId
    || usage.nativeServedModelId !== context.modelId
    || !validateNativeInputPriceUnits40(usage.inputTokens, usage.nativeInputPriceUnits40,
      usage.nativeServedModelId, usage.nativePricingPolicy)) return false;
  // Output uncertainty does not revoke a still-valid input proof (RQ-2).
  const reason = usage.nativeUsageUncertainty;
  if (usage.nativeInputUsageValidated === true
    && ['json', 'message_start', 'message_delta'].includes(usage.nativeInputUsageSource ?? '')
    && (reason === undefined || reason === 'incomplete_output' || reason === 'invalid_output')) return true;
  // An unknown TTL split may retain a premium, but can never discount the charged physical floor.
  return reason === 'cache_write_split_unknown' && usage.nativeInputUsageValidated === false
    && BigInt(usage.nativeInputPriceUnits40!) >= 40n * BigInt(usage.inputTokens);
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

/**
 * Prices reported input/output; no token usage returns zero, even for image/tool-only usage.
 * Gateway `SettleUsage` carries input/output only; output uses max(output, reasoning) rate.
 * Reasoning is not universally included: cloud-code keeps Gemini thoughtsTokenCount separate,
 * and the gateway drops it, so those thoughts are uncharged. Image/tool counts also never arrive
 * via the gateway; this helper adds them only when supplied alongside positive token usage.
 * Product /gw activation restrictions and mesh/gateway follow-ups are in spec §12.8.
 */
export const usageCost = (price: PricingRow, usage: PricedUsage, context?: AttemptPricingContext): bigint => {
  if (usage.inputTokens <= 0 && usage.outputTokens <= 0) return 0n;
  const outputRate = price.reasoning > price.output ? price.reasoning : price.output;
  const units = (value: number | undefined) => BigInt(Number.isSafeInteger(value) && value! > 0 ? value! : 0);
  const input = nativePricingEligible(price, usage, context)
    ? (BigInt(usage.nativeInputPriceUnits40!) * price.input + 39_999_999n) / 40_000_000n
    : perMtok(usage.inputTokens, price.input);
  const total = input + perMtok(usage.outputTokens, outputRate)
    + units(usage.imageUnits) * price.image + units(usage.toolCalls) * price.toolCall;
  return total > price.minCharge ? total : price.minCharge;
};

/** Upper-bound liability of one million-token attempt at a price, to rank prices conservatively. */
export const priceWeight = (price: PricingRow): bigint =>
  price.input + (price.reasoning > price.output ? price.reasoning : price.output) + price.image + price.toolCall
  + price.minCharge;

/**
 * THE lock order on `control.budgets`, shared by admission, settlement, release and the reaper:
 * every transaction locks the rows it will update with `ORDER BY id FOR UPDATE` before any UPDATE,
 * so two transactions touching overlapping buckets can never wait on each other in a cycle.
 */
export const lockBudgets = async (tx: LedgerTx, ids: readonly string[]): Promise<void> => {
  if (ids.length > 0) {
    await tx.execute(sql`SELECT id FROM control.budgets WHERE id = ANY(${pgTextArray(ids)}) ORDER BY id FOR UPDATE`);
  }
};

export type PrincipalKind = 'user' | 'service';
export class PrincipalKeyError extends Error {
  constructor() { super('principal is not an opaque identifier'); this.name = 'PrincipalKeyError'; }
}

// Opaque id shapes produced by B2 identity: a user id (UUID / generated token) or
// `service:<client id>`. No dot, `@`, colon or space in the id itself, so no e-mail, hostname,
// IPv4 or IPv6 literal can match.
const OPAQUE_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;

/** `principal_key` is the verified opaque principal id; any other shape refuses admission. */
export const principalOf = (cost: Pick<CostContext, 'principalId'>): { kind: PrincipalKind; key: string } => {
  const id = cost.principalId;
  const service = typeof id === 'string' && id.startsWith('service:');
  const bare = typeof id === 'string' ? (service ? id.slice('service:'.length) : id) : '';
  if (!OPAQUE_ID.test(bare)) throw new PrincipalKeyError();
  return { kind: service ? 'service' : 'user', key: id };
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
    // Documented exception to the audit rule: the gateway never calls `admit` with an empty quote
    // (it refuses `no-route` first) and mesh bounds maxAttempts to 1..8, and the 0008 reason CHECK has
    // no code for a malformed quote (a new code needs a migration), so this guard writes no row.
    if (quote.candidates.length === 0 || !Number.isSafeInteger(quote.maxAttempts) || quote.maxAttempts < 1) {
      return { kind: 'unavailable' };
    }
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
    // A workspace-less caller cannot be matched to a workspace cap: never skip one silently.
    if (!cost.workspaceId) {
      const [scoped] = (await tx.execute(sql`SELECT 1 AS present FROM control.budgets
        WHERE tenant_id = ${cost.tenantId} AND scope_kind = 'workspace' LIMIT 1`)).rows;
      if (scoped) { await block('missing_bucket', { strategyId, liability }); return { kind: 'unavailable' }; }
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
        await lockBudgets(tx, hold.budget_ids as string[]);
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

/**
 * D2 partition (spec §2): the trusted server configuration revision is the sole authority on which
 * host serves a verified identity. Both hosts verify revision and content hash before admission;
 * missing, mismatched or overlapping configuration fails closed (503), and an identity assigned to
 * the other host, or to none, is refused as unauthenticated (401) before any account or budget effect.
 */
export type GatewayHostKind = 'product' | 'standalone';

export interface RoutePartitionRevision { readonly revision: string; readonly hash: string }

export interface RoutePartitionConfig extends RoutePartitionRevision {
  /** Per tenant: verified principal ids served by each host (disjoint sets). */
  readonly tenants: Readonly<Record<string, Readonly<Partial<Record<GatewayHostKind, readonly string[]>>>>>;
  readonly previous?: RoutePartitionRevision;
}

export interface RoutePartitionSource {
  /** Trusted server configuration (never request input). */
  load(): Promise<RoutePartitionConfig | undefined> | RoutePartitionConfig | undefined;
  /** Revision pinned by the operator (product: the `/gw` cutover evidence). */
  expected(): Promise<RoutePartitionRevision | undefined> | RoutePartitionRevision | undefined;
}

export class RoutePartitionUnavailableError extends Error {
  readonly code = 'llm_route_partition_unavailable';
  constructor() { super('route partition configuration unavailable'); this.name = 'RoutePartitionUnavailableError'; }
}

const sortedTenants = (tenants: RoutePartitionConfig['tenants']) => Object.keys(tenants).sort().map((tenant) => [
  tenant, (['product', 'standalone'] as const).map((host) => [host, [...(tenants[tenant]?.[host] ?? [])].sort()]),
]);

/** Content hash of a partition revision: sha256 over the canonical revision and assignments. */
export const routePartitionHash = (revision: string, tenants: RoutePartitionConfig['tenants']): string =>
  quoteHash({ revision, tenants: sortedTenants(tenants) });

export const createRoutePartition = (host: GatewayHostKind, source: RoutePartitionSource) => {
  const verified = async (): Promise<RoutePartitionConfig> => {
    let config: RoutePartitionConfig | undefined;
    let expected: RoutePartitionRevision | undefined;
    try {
      [config, expected] = await Promise.all([source.load(), source.expected()]);
    } catch {
      throw new RoutePartitionUnavailableError();
    }
    if (!config || !expected || typeof config.revision !== 'string' || !config.tenants
      || config.revision !== expected.revision || config.hash !== expected.hash
      || routePartitionHash(config.revision, config.tenants) !== config.hash) throw new RoutePartitionUnavailableError();
    for (const assignment of Object.values(config.tenants)) {
      const product = new Set(assignment.product ?? []);
      if ((assignment.standalone ?? []).some((principal) => product.has(principal))) throw new RoutePartitionUnavailableError();
    }
    return config;
  };
  return {
    host,
    /** True only when the verified principal is assigned to this host in its tenant. */
    async assigned(cost: Pick<CostContext, 'tenantId' | 'principalId'>): Promise<boolean> {
      const config = await verified();
      return (config.tenants[cost.tenantId]?.[host] ?? []).includes(cost.principalId);
    },
    async ready(): Promise<boolean> {
      await verified();
      return true;
    },
  };
};

export type RoutePartition = ReturnType<typeof createRoutePartition>;

/** Caller auth that refuses (401) identities not assigned to this host; configuration errors throw (503). */
export const withRoutePartition = (inner: CallerAuthPort, partition: RoutePartition): CallerAuthPort => ({
  async verify(headers, context) {
    const result = await inner.verify(headers, context);
    if (!result.ok || !result.cost) return result;
    if (!(await partition.assigned(result.cost))) return { ok: false, reason: 'identity not assigned to this gateway host' };
    return result;
  },
});

/** Transports that cannot apply a caller output ceiling (the Codex wire omits it). */
export const OUTPUT_CEILING_UNENFORCED_TRANSPORTS: readonly string[] = ['codex'];

/**
 * Mirror of llm-mesh 0.22.0 `mayUseUnenforcedTransport` (`packages/llm-mesh/src/route-quote.ts`,
 * not exported): a pinned transport decides; unpinned, the candidate is unenforced when any account
 * transport of the provider profile is `codex` (e.g. provider `openai`, transport `codex`).
 */
export const mayUseUnenforcedTransport = (providerId: string, transportProviderId?: string): boolean => {
  if (transportProviderId !== undefined) return OUTPUT_CEILING_UNENFORCED_TRANSPORTS.includes(transportProviderId);
  const provider = (providerProfiles as Record<string, {
    capabilities: { auth: { accountTransports: readonly string[] } };
  } | undefined>)[providerId];
  return provider?.capabilities.auth.accountTransports
    .some((transport) => OUTPUT_CEILING_UNENFORCED_TRANSPORTS.includes(transport)) ?? false;
};

/**
 * Pure, synchronous quote seam for catalog-backed planners (product and host route planes): the
 * candidates are the catalog entries of the requested model, one attempt, no account touched.
 * `plan({ quote })` refuses (`quote-mismatch`) any target the quote did not cover.
 */
export const withCatalogQuote = (planner: RoutePlanner, options: {
  readonly nativeMessagesModelIds?: readonly string[];
  readonly catalog: { listModels(): readonly { readonly modelId: string; readonly providerId: string }[] };
  readonly councilRevision: string;
  /** Transport pinned by the catalog entry, when known (undefined: any enrolled transport). */
  readonly transportFor?: (model: { readonly modelId: string; readonly providerId: string }) => string | undefined;
}): RoutePlanner => {
  const nativeModels = validateNativeModelAllowlist(options.nativeMessagesModelIds ?? []);
  const quote = (input: RouteQuoteInput): RouteQuote => {
    const { ceiling } = input;
    const count = (value: unknown, min: number) => typeof value === 'number' && Number.isSafeInteger(value) && value >= min;
    if (!(input.now instanceof Date) || Number.isNaN(input.now.getTime()) || !count(ceiling?.inputTokens, 0)
      || !count(ceiling?.outputTokens, 1)) throw new RouteQuoteError('invalid usage ceiling', 'invalid-ceiling');
    if (input.nativeMessages && Object.hasOwn(EXCLUSIVE_LAUNCH_ALIAS_TARGET_MAPPINGS, input.requestedModel)) {
      throw new RouteQuoteError('Native Messages target is unavailable', 'native-unavailable');
    }
    const models = options.catalog.listModels().filter((model) => model.modelId === input.requestedModel);
    if (models.length === 0) throw new RouteQuoteError('Unknown requested model', 'unknown-model');
    const eligible = input.nativeMessages ? models.filter(model => isNativeMessagesTarget(model, nativeModels)) : models;
    if (!eligible.length) throw new RouteQuoteError('Native Messages target is unavailable', 'native-unavailable');
    const candidates: QuotedRouteCandidate[] = eligible.map((model) => ({
      providerId: model.providerId, modelId: model.modelId, reason: 'exact',
      allowance: { ...ceiling }, outputCeilingEnforced: !mayUseUnenforcedTransport(model.providerId, options.transportFor?.(model)),
    }));
    const body = {
      requestedModel: input.requestedModel, candidates, maxAttempts: 1, quotedAt: input.now.toISOString(),
      policyRevision: 'default', councilRevision: options.councilRevision,
    };
    return { quoteRef: `quote_${quoteHash({ ...body, ...(input.nativeMessages ? { nativeMessages: true } : {}) }).slice(0, 32)}`, ...body };
  };
  return {
    ...planner,
    quote,
    async plan(subject, input) {
      const plan = await planner.plan(subject, input);
      const pinned = input.quote;
      if (pinned && (pinned.councilRevision !== plan.councilRevision || !plan.diagnostics.every((target) =>
        pinned.candidates.some((candidate) => candidate.providerId === target.actualProviderId
          && candidate.modelId === target.actualModelId)))) {
        throw new RoutePlanError('Planned target is not covered by the quote', 'quote-mismatch');
      }
      return plan;
    },
  };
};
