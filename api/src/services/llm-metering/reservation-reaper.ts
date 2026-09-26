/**
 * Reservation reaper (spec D5 crash handling). Expires holds past `deadline_at`:
 * - never dispatched (`held`, no dispatch marker): refund the reserve, status `released`;
 * - possibly dispatched: never free the liability; charge it as conservative spend, write the
 *   request's one ledger row (`reconciliation_state = 'pending'`) and mark the hold `reconciled`.
 *   A late settlement corrects that row once to the actual charge (see `route-settlement.ts`).
 * Idempotent and concurrency safe: `FOR UPDATE SKIP LOCKED` claims, open-status predicates, and the
 * ledger `idempotency_key` fence shared with settlement. Scheduling is the host's concern.
 */
import { sql } from 'drizzle-orm';

import { createId } from '../../utils/id';
import { pgTextArray, type LedgerDatabase } from './budget-admission';

export interface ReapResult {
  readonly released: number;
  readonly reconciled: number;
}

export const reapExpiredHolds = async (options: {
  readonly database: LedgerDatabase;
  readonly now?: Date;
  readonly limit?: number;
}): Promise<ReapResult> => {
  const now = options.now ?? new Date();
  return options.database.transaction(async (tx) => {
    const holds = (await tx.execute(sql`SELECT id, request_id, status, dispatch_started_at, liability_micro_usd,
        budget_ids, budget_strategy_id, quote_ref, pricing_versions, tenant_id, workspace_id, principal_kind, principal_key
      FROM control.budget_holds
      WHERE status IN ('held', 'dispatched') AND deadline_at <= ${now}
      ORDER BY deadline_at, id LIMIT ${options.limit ?? 100} FOR UPDATE SKIP LOCKED`)).rows as Array<Record<string, unknown>>;
    let released = 0;
    let reconciled = 0;
    for (const hold of holds) {
      const liability = String(hold.liability_micro_usd);
      const buckets = pgTextArray(hold.budget_ids as string[]);
      if (hold.status === 'held' && hold.dispatch_started_at === null) {
        await tx.execute(sql`UPDATE control.budgets SET updated_at = ${now},
            reserved_micro_usd = GREATEST(0, reserved_micro_usd - ${liability}::bigint) WHERE id = ANY(${buckets})`);
        await tx.execute(sql`UPDATE control.budget_holds SET status = 'released', settled_at = ${now}, updated_at = ${now}
          WHERE id = ${String(hold.id)}`);
        released += 1;
        continue;
      }
      const principalKey = String(hold.principal_key);
      const inserted = await tx.execute(sql`INSERT INTO control.cost_ledger (id, idempotency_key, user_id, workspace_id,
          tenant_id, operation, provider_id, model_id, cost_micro_usd, principal_kind, principal_key, budget_strategy_id,
          pricing_version, result, hold_id, quote_ref, reconciliation_state)
        VALUES (${createId()}, ${String(hold.request_id)}, ${hold.principal_kind === 'user' ? principalKey : null},
          ${(hold.workspace_id as string | null) ?? null}, ${String(hold.tenant_id)}, 'generate', 'none', 'none',
          ${liability}, ${String(hold.principal_kind)}, ${principalKey}, ${String(hold.budget_strategy_id)},
          ${(hold.pricing_versions as string[])[0] ?? null}, 'error', ${String(hold.id)}, ${String(hold.quote_ref)}, 'pending')
        ON CONFLICT (idempotency_key) DO NOTHING RETURNING id`);
      // Already settled (row exists): only close the reserve; otherwise charge the full liability.
      const spend = inserted.rows.length === 1 ? liability : '0';
      await tx.execute(sql`UPDATE control.budgets SET updated_at = ${now},
          reserved_micro_usd = GREATEST(0, reserved_micro_usd - ${liability}::bigint),
          spent_micro_usd = spent_micro_usd + ${spend}::bigint
        WHERE id = ANY(${buckets})`);
      await tx.execute(sql`UPDATE control.budget_holds SET status = 'reconciled', settled_at = ${now}, updated_at = ${now}
        WHERE id = ${String(hold.id)}`);
      reconciled += 1;
    }
    return { released, reconciled };
  });
};
