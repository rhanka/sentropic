import type { CostContext } from '@sentropic/llm-gateway';
import type { DecisionBudgetPort, DecisionEvaluatorDescriptor, DecisionReceiptSink } from '@sentropic/llm-mesh/decision/host';
import type { LedgerDatabase } from './budget-admission';
import { createDecisionAdmission } from './decision-admission';
import { settleDecision } from './decision-settlement';
import { decisionTransaction, persistDecisionReceipt } from './decision-store';
import { resolveDecisionPrice } from './decision-pricing';

export const createDecisionMetering = (database: LedgerDatabase, cost: CostContext,
  descriptors: readonly DecisionEvaluatorDescriptor[]) => {
  const budget: DecisionBudgetPort = { ...createDecisionAdmission(database, cost, descriptors),
    settle: (input) => settleDecision(database, cost, input) };
  const receipts: DecisionReceiptSink = {
    persist: (receipt) => decisionTransaction(database, (tx) => persistDecisionReceipt(tx, cost, receipt)),
  };
  return { budget, receipts, resolvePrice: (key: Parameters<typeof resolveDecisionPrice>[1]) => resolveDecisionPrice(database, key),
    probe: () => decisionTransaction(database, async (tx) => {
      const { sql } = await import('drizzle-orm');
      await tx.execute(sql`SELECT call_id, receipt FROM control.decision_calls LIMIT 0`);
      return true;
    }) };
};
