/**
 * Single-writer checked insert for `control.model_pricing` (decision B0-A4, spec §12.7), moved
 * verbatim from the B2 test helper of `api/tests/api/llm-admission-schema.test.ts`.
 *
 * `FOR UPDATE` cannot lock an absent predecessor, so a transaction-scoped advisory lock keyed on
 * (provider, model) serializes writers first; the predecessor lookup `FOR UPDATE` and the overlap
 * check run in the same transaction; the unique `(provider_id, model_id, effective_from)` key stays
 * the last-resort guard. Only `effective_to` of the open predecessor is ever closed. Non-overlap is a
 * single-writer discipline: a direct SQL write with another `effective_from` can bypass it.
 */
import { sql } from 'drizzle-orm';

import type { db } from '../../db/client';
import { createId } from '../../utils/id';

type Database = Pick<typeof db, 'transaction'>;

export interface ModelPricingRates {
  readonly inputMicroUsdPerMtok: number;
  readonly outputMicroUsdPerMtok: number;
  readonly cachedInputMicroUsdPerMtok?: number | null;
  readonly reasoningMicroUsdPerMtok?: number | null;
  readonly imageMicroUsdPerUnit?: number | null;
  readonly toolCallMicroUsdPerUnit?: number | null;
  readonly minChargeMicroUsd?: number | null;
}

export interface ModelPricingWrite extends ModelPricingRates {
  readonly id?: string;
  readonly providerId: string;
  readonly modelId: string;
  readonly effectiveFrom: Date;
  readonly effectiveTo?: Date | null;
}

export class ModelPricingOverlapError extends Error {
  readonly code = 'model_pricing_overlap';

  constructor() {
    super('model_pricing_overlap');
    this.name = 'ModelPricingOverlapError';
  }
}

const rate = (value: number | null | undefined): number | null => {
  if (value === undefined || value === null) return null;
  if (!Number.isSafeInteger(value) || value < 0) throw new RangeError('pricing rates are non-negative integer micro-USD');
  return value;
};

/** Inserts one immutable pricing window; closes the open predecessor at the new start. */
export const insertModelPricing = async (database: Database, write: ModelPricingWrite): Promise<string> => {
  const id = write.id ?? createId();
  const input = rate(write.inputMicroUsdPerMtok);
  const output = rate(write.outputMicroUsdPerMtok);
  if (input === null || output === null) throw new RangeError('input and output rates are required');
  const to = write.effectiveTo ?? null;
  await database.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${write.providerId}), hashtext(${write.modelId}))`);
    const existing = (await tx.execute(sql`
      SELECT id, effective_from, effective_to FROM control.model_pricing
      WHERE provider_id = ${write.providerId} AND model_id = ${write.modelId}
      ORDER BY effective_from FOR UPDATE`)).rows as Array<{ id: string; effective_from: Date; effective_to: Date | null }>;
    const end = to?.getTime() ?? Number.POSITIVE_INFINITY;
    let predecessor: string | null = null;
    for (const row of existing) {
      const from = new Date(row.effective_from).getTime();
      const until = row.effective_to ? new Date(row.effective_to).getTime() : Number.POSITIVE_INFINITY;
      if (row.effective_to === null && from < write.effectiveFrom.getTime()) { predecessor = row.id; continue; }
      if (from < end && write.effectiveFrom.getTime() < until) throw new ModelPricingOverlapError();
    }
    if (predecessor) {
      await tx.execute(sql`UPDATE control.model_pricing SET effective_to = ${write.effectiveFrom}
        WHERE id = ${predecessor} AND effective_to IS NULL`);
    }
    await tx.execute(sql`INSERT INTO control.model_pricing
      (id, provider_id, model_id, input_micro_usd_per_mtok, output_micro_usd_per_mtok, cached_input_micro_usd_per_mtok,
       reasoning_micro_usd_per_mtok, image_micro_usd_per_unit, tool_call_micro_usd_per_unit, min_charge_micro_usd,
       effective_from, effective_to)
      VALUES (${id}, ${write.providerId}, ${write.modelId}, ${input}, ${output}, ${rate(write.cachedInputMicroUsdPerMtok)},
       ${rate(write.reasoningMicroUsdPerMtok)}, ${rate(write.imageMicroUsdPerUnit)}, ${rate(write.toolCallMicroUsdPerUnit)},
       ${rate(write.minChargeMicroUsd)}, ${write.effectiveFrom}, ${to})`);
  });
  return id;
};
