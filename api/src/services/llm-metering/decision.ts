import type { CostContext } from '@sentropic/llm-gateway';
import { sql } from 'drizzle-orm';
import type { DecisionBudgetPort, DecisionEvaluatorDescriptor, DecisionReceiptSink } from '@sentropic/llm-mesh/decision/host';
import type { LedgerDatabase } from './budget-admission';
import { createDecisionAdmission } from './decision-admission';
import { settleDecision } from './decision-settlement';
import { decisionTransaction, evaluatorKey, persistDecisionReceipt } from './decision-store';
import { resolveDecisionPrice } from './decision-pricing';

export const createDecisionMetering = (database: LedgerDatabase, cost: CostContext,
  descriptors: readonly DecisionEvaluatorDescriptor[]) => {
  const budget: DecisionBudgetPort = { ...createDecisionAdmission(database, cost, descriptors),
    settle: (input) => settleDecision(database, cost, input) };
  const receipts: DecisionReceiptSink = {
    persist: (receipt) => decisionTransaction(database, (tx) => persistDecisionReceipt(tx, cost, receipt)),
  };
  return { budget, receipts, resolvePrice: (key: Parameters<typeof resolveDecisionPrice>[1]) => resolveDecisionPrice(database, key),
    probe: (ref?: DecisionEvaluatorDescriptor['evaluator']) => decisionTransaction(database, async (tx) => {
      await tx.execute(sql`SELECT call_id, receipt FROM control.decision_calls LIMIT 0`);
      const [row] = (await tx.execute(sql`SELECT
        EXISTS (SELECT 1 FROM control.tenant_budget_strategy WHERE tenant_id = ${cost.tenantId} AND status = 'active')
        AND EXISTS (SELECT 1 FROM control.budgets WHERE tenant_id = ${cost.tenantId}
          AND scope_kind = 'tenant' AND scope_key = ${cost.tenantId} AND period = 'monthly')
        AND NOT EXISTS (SELECT 1 FROM control.decision_evaluator_state
          WHERE evaluator_key = ${ref ? evaluatorKey(ref) : ''} AND disabled) AS ready`)).rows as Array<{ ready: boolean }>;
      return row?.ready === true;
    }) };
};
