import { sql } from 'drizzle-orm';
import type { EvaluatorRef, DecisionReceipt } from '@sentropic/llm-mesh/decision';
import type { CostContext } from '@sentropic/llm-gateway';
import type { LedgerDatabase, LedgerTx } from './budget-admission';

export const evaluatorKey = (ref: EvaluatorRef): string =>
  JSON.stringify([ref.providerId, ref.evaluatorId, ref.revision]);

/** Bounded host I/O; a timed-out admission remains ambiguous and keeps its durable liability. */
export const decisionTransaction = async <T>(database: LedgerDatabase, run: (tx: LedgerTx) => Promise<T>): Promise<T> => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      database.transaction(async (tx) => {
        await tx.execute(sql`SET LOCAL statement_timeout = '2000ms'`);
        await tx.execute(sql`SET LOCAL lock_timeout = '1000ms'`);
        await tx.execute(sql`SET LOCAL transaction_timeout = '5000ms'`);
        return run(tx);
      }),
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('Decision store unavailable')), 5_000); }),
    ]);
  } finally { clearTimeout(timer); }
};

/** The evaluator lock always precedes hold and budget locks, including disable after an overrun. */
export const lockDecisionEvaluator = async (tx: LedgerTx, key: string): Promise<boolean> => {
  await tx.execute(sql`INSERT INTO control.decision_evaluator_state (evaluator_key) VALUES (${key}) ON CONFLICT DO NOTHING`);
  const [row] = (await tx.execute(sql`SELECT disabled FROM control.decision_evaluator_state
    WHERE evaluator_key = ${key} FOR UPDATE`)).rows as Array<{ disabled: boolean }>;
  return row?.disabled === false;
};

export interface DecisionHold extends Record<string, unknown> {
  id: string; status: string; request_id: string; tenant_id: string; workspace_id: string;
  principal_key: string; budget_ids: string[]; liability_micro_usd: string; budget_strategy_id: string;
  pricing_versions: string[]; deadline_at: Date; quote_ref: string; dispatch_started_at: Date | null;
}

export const lockDecisionHold = async (tx: LedgerTx, cost: CostContext, holdId: string, callId: string) => {
  const [hold] = (await tx.execute(sql`SELECT h.* FROM control.budget_holds h
    JOIN control.decision_calls c ON c.hold_id = h.id AND c.call_id = h.request_id
    WHERE h.id = ${holdId} AND h.request_id = ${callId} AND h.tenant_id = ${cost.tenantId}
      AND h.workspace_id = ${cost.workspaceId} AND h.principal_key = ${cost.principalId} FOR UPDATE OF h`)).rows as DecisionHold[];
  if (!hold) throw new Error('Decision hold unavailable');
  return hold;
};

/** Receipts contain accounting metadata only; no request or verdict crosses this boundary. */
export const persistDecisionReceipt = async (tx: LedgerTx, cost: CostContext, receipt: DecisionReceipt): Promise<void> => {
  const result = await tx.execute(sql`INSERT INTO control.decision_calls
    (call_id, tenant_id, workspace_id, principal_key, evaluator_key, receipt)
    VALUES (${receipt.callId}, ${cost.tenantId}, ${cost.workspaceId}, ${cost.principalId},
      ${receipt.evaluator ? evaluatorKey(receipt.evaluator) : null}, ${JSON.stringify(receipt)}::jsonb)
    ON CONFLICT (call_id) DO UPDATE SET receipt = EXCLUDED.receipt
    WHERE decision_calls.tenant_id = EXCLUDED.tenant_id AND decision_calls.workspace_id = EXCLUDED.workspace_id
      AND decision_calls.principal_key = EXCLUDED.principal_key RETURNING call_id`);
  if (result.rows.length !== 1) throw new Error('Decision receipt unavailable');
};
