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
