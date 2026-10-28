import { sql } from 'drizzle-orm';
import type { CostContext } from '@sentropic/llm-gateway';
import type { DecisionAdmission, DecisionAdmissionResult, DecisionDispatchResult,
  DecisionEvaluatorDescriptor } from '@sentropic/llm-mesh/decision/host';
import { createBudgetAdmission, loadPricing, type LedgerDatabase } from './budget-admission';
import { decisionTransaction, evaluatorKey, lockDecisionEvaluator, lockDecisionHold } from './decision-store';

export const createDecisionAdmission = (database: LedgerDatabase, cost: CostContext,
  descriptors: readonly DecisionEvaluatorDescriptor[]) => ({
  async admit(input: DecisionAdmission): Promise<DecisionAdmissionResult> {
    try {
      return await decisionTransaction(database, async (tx): Promise<DecisionAdmissionResult> => {
        const key = evaluatorKey(input.evaluator);
        if (!await lockDecisionEvaluator(tx, key)) return { ok: false, code: 'PROVIDER_UNAVAILABLE' };
        if (Date.now() >= input.deadlineAt) return { ok: false, code: 'BUDGET_UNAVAILABLE' };
        const descriptor = descriptors.find((item) => evaluatorKey(item.evaluator) === key);
        const price = input.quote.price;
        const current = await loadPricing(tx, input.evaluator.providerId, price.modelId, new Date());
        if (!descriptor || !current || current.id !== price.priceRevision
          || current.input.toString() !== price.inputMicroUsdPerMtok || current.output.toString() !== price.outputMicroUsdPerMtok
          || current.minCharge.toString() !== price.minimumMicroUsd) return { ok: false, code: 'BUDGET_UNAVAILABLE' };
        // Reuse the existing all-bucket admission in this evaluator-locked transaction.
        const inner: LedgerDatabase = { execute: tx.execute.bind(tx), transaction: (run) => run(tx) };
        const budget = createBudgetAdmission({ database: inner, ownerRef: 'product-api:decision', inputMarginPercent: 0,
          holdTtlMs: Math.max(1, input.deadlineAt - Date.now()) });
        const admitted = await budget.admit({ requestId: input.callId, cost, wire: 'openai-chat-completions', quote: {
          quoteRef: `decision:${input.callId}`, requestedModel: descriptor.wireModel, maxAttempts: 1,
          quotedAt: new Date().toISOString(), policyRevision: 'decision-host-v1', councilRevision: 'none',
          candidates: [{ providerId: input.evaluator.providerId, modelId: descriptor.wireModel, reason: 'exact',
            allowance: { inputTokens: descriptor.maxBillableInputTokens, outputTokens: descriptor.maxBillableOutputTokens },
            outputCeilingEnforced: true }],
        } });
        if (admitted.kind !== 'admitted') return { ok: false,
          code: admitted.kind === 'over-budget' ? 'BUDGET_EXHAUSTED' : 'BUDGET_UNAVAILABLE' };
        const [hold] = (await tx.execute(sql`SELECT liability_micro_usd FROM control.budget_holds
          WHERE id = ${admitted.holdRef}`)).rows as Array<{ liability_micro_usd: string }>;
        if (!hold || String(hold.liability_micro_usd) !== input.quote.reservedMicroUsd) {
          throw new Error('Decision liability mismatch');
        }
        await tx.execute(sql`INSERT INTO control.decision_calls
          (call_id, tenant_id, workspace_id, principal_key, evaluator_key, hold_id)
          VALUES (${input.callId}, ${cost.tenantId}, ${cost.workspaceId}, ${cost.principalId}, ${key}, ${admitted.holdRef})`);
        return { ok: true, holdId: admitted.holdRef };
      });
    } catch { return { ok: false, code: 'BUDGET_UNAVAILABLE' }; }
  },
  async markDispatched(input: { holdId: string; callId: string; evaluator: DecisionAdmission['evaluator']; deadlineAt: number }): Promise<DecisionDispatchResult> {
    try {
      return await decisionTransaction(database, async (tx): Promise<DecisionDispatchResult> => {
        if (!await lockDecisionEvaluator(tx, evaluatorKey(input.evaluator))) {
          return { ok: false, code: 'PROVIDER_UNAVAILABLE', provenUnsent: true };
        }
        const hold = await lockDecisionHold(tx, cost, input.holdId, input.callId);
        if (hold.status !== 'held' || Date.now() >= Math.min(input.deadlineAt, new Date(hold.deadline_at).getTime())) {
          return { ok: false, code: 'BUDGET_UNAVAILABLE', provenUnsent: hold.status === 'held' };
        }
        await tx.execute(sql`UPDATE control.budget_holds SET status = 'dispatched', dispatch_started_at = now(),
          dispatched_attempts = 1, fence = fence + 1, updated_at = now() WHERE id = ${input.holdId}`);
        return { ok: true };
      });
    } catch { return { ok: false, code: 'BUDGET_UNAVAILABLE', provenUnsent: false }; }
  },
  async release(input: { holdId: string; callId: string }): Promise<void> {
    await decisionTransaction(database, async (tx) => {
      const hold = await lockDecisionHold(tx, cost, input.holdId, input.callId);
      // The service invokes release only when it has proved no provider invocation occurred.
      if (!['held', 'dispatched'].includes(hold.status)) {
        if (hold.status === 'released') return;
        throw new Error('Decision hold cannot be released');
      }
      const inner: LedgerDatabase = { execute: tx.execute.bind(tx), transaction: (run) => run(tx) };
      await tx.execute(sql`UPDATE control.budget_holds SET status = 'held', dispatch_started_at = NULL WHERE id = ${input.holdId}`);
      await createBudgetAdmission({ database: inner, ownerRef: 'product-api:decision' }).release(input.holdId);
    });
  },
});
