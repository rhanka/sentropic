import { sql } from 'drizzle-orm';
import type { CostContext } from '@sentropic/llm-gateway';
import type { DecisionSettlement } from '@sentropic/llm-mesh/decision/host';
import { createId } from '../../utils/id';
import { outboxWriter } from '../outbox/outbox-writer';
import { lockBudgets, pgTextArray, principalOf, type LedgerDatabase } from './budget-admission';
import { decisionTransaction, evaluatorKey, lockDecisionEvaluator, lockDecisionHold, persistDecisionReceipt } from './decision-store';

/** Full charges, redacted receipts, disable evidence and outbox share the ledger transaction. */
export const settleDecision = async (database: LedgerDatabase, cost: CostContext, input: DecisionSettlement): Promise<void> => {
  const { receipt } = input;
  if (!receipt.evaluator) throw new Error('Decision evaluator missing');
  await decisionTransaction(database, async (tx) => {
    const key = evaluatorKey(receipt.evaluator!);
    await lockDecisionEvaluator(tx, key);
    const hold = await lockDecisionHold(tx, cost, input.holdId, receipt.callId);
    const [call] = (await tx.execute(sql`SELECT evaluator_key FROM control.decision_calls
      WHERE call_id = ${receipt.callId}`)).rows as Array<{ evaluator_key: string }>;
    if (call?.evaluator_key !== key) throw new Error('Decision evaluator mismatch');
    if (input.boundViolated) {
      await tx.execute(sql`UPDATE control.decision_evaluator_state SET disabled = true,
        evidence = ${JSON.stringify({ callId: receipt.callId, holdId: input.holdId, cost: receipt.cost })}::jsonb,
        updated_at = now() WHERE evaluator_key = ${key}`);
    }
    const [prior] = (await tx.execute(sql`SELECT hold_id, cost_micro_usd, reconciliation_state FROM control.cost_ledger
      WHERE idempotency_key = ${receipt.callId} FOR UPDATE`)).rows as Array<{
        hold_id: string; cost_micro_usd: string; reconciliation_state: string;
      }>;
    if (prior && prior.hold_id !== hold.id) throw new Error('Decision ledger collision');
    const pending = receipt.budget.state === 'pending-reconciliation';
    const correcting = hold.status === 'reconciled' && prior?.reconciliation_state === 'pending' && !pending;
    if (prior && !correcting) return;
    if (!['held', 'dispatched', 'reconciled'].includes(hold.status)) throw new Error('Decision hold closed');
    const amount = BigInt(receipt.cost.amountMicroUsd);
    if (pending && amount < BigInt(hold.liability_micro_usd)) throw new Error('Decision liability undercharge');
    const principal = principalOf(cost);
    const inputTokens = receipt.usage.tokens.input.value;
    const outputTokens = receipt.usage.tokens.output.value;
    const result = receipt.outcome === 'verdict' ? 'ok' : 'error';
    const state = pending ? 'pending' : 'none';
    const priceRevision = receipt.cost.status === 'not-incurred' ? null : receipt.cost.priceRevision;
    if (!priceRevision || !hold.pricing_versions.includes(priceRevision)) throw new Error('Decision price mismatch');
    if (correcting) {
      await tx.execute(sql`UPDATE control.cost_ledger SET cost_micro_usd = ${amount.toString()},
        input_tokens = ${inputTokens}, output_tokens = ${outputTokens}, total_tokens = ${receipt.usage.tokens.total.value},
        result = ${result}, reconciliation_state = 'reconciled' WHERE idempotency_key = ${receipt.callId}`);
    } else {
      await tx.execute(sql`INSERT INTO control.cost_ledger
        (id, idempotency_key, user_id, workspace_id, tenant_id, operation, provider_id, model_id,
         input_tokens, output_tokens, total_tokens, cost_micro_usd, principal_kind, principal_key,
         budget_strategy_id, pricing_version, result, hold_id, quote_ref, reconciliation_state, attempts)
        VALUES (${createId()}, ${receipt.callId}, ${principal.kind === 'user' ? principal.key : null},
          ${cost.workspaceId}, ${cost.tenantId}, 'decision', ${receipt.evaluator!.providerId},
          ${receipt.servedModelId ?? 'unknown'}, ${inputTokens}, ${outputTokens}, ${receipt.usage.tokens.total.value},
          ${amount.toString()}, ${principal.kind}, ${principal.key}, ${hold.budget_strategy_id}, ${priceRevision},
          ${result}, ${hold.id}, ${hold.quote_ref}, ${state}, ${JSON.stringify([{ attempts: receipt.attempts,
            evaluator: receipt.evaluator, servedEvaluator: receipt.servedEvaluator, cost: receipt.cost,
            usage: receipt.usage, experimental: receipt.experimental === true }])}::jsonb)`);
    }
    await lockBudgets(tx, hold.budget_ids);
    const open = ['held', 'dispatched'].includes(hold.status);
    const delta = amount - (open ? 0n : BigInt(prior?.cost_micro_usd ?? hold.liability_micro_usd));
    await tx.execute(sql`UPDATE control.budgets SET updated_at = now(),
      reserved_micro_usd = GREATEST(0, reserved_micro_usd - ${(open ? hold.liability_micro_usd : '0')}::bigint),
      spent_micro_usd = GREATEST(0, spent_micro_usd + ${delta.toString()}::bigint)
      WHERE id = ANY(${pgTextArray(hold.budget_ids)})`);
    await tx.execute(sql`UPDATE control.budget_holds SET status = ${pending || !open ? 'reconciled' : 'settled'},
      settled_at = now(), updated_at = now() WHERE id = ${hold.id}`);
    await persistDecisionReceipt(tx, cost, receipt);
    await outboxWriter.append(tx as Parameters<typeof outboxWriter.append>[0], {
      aggregateType: 'llm_request', aggregateId: receipt.callId, channel: 'llm_settlement',
      tenantId: cost.tenantId, workspaceId: cost.workspaceId,
      envelope: { type: 'llm.decision.settled', callId: receipt.callId, holdId: hold.id,
        costMicroUsd: amount.toString(), pending, experimental: receipt.experimental === true },
    });
  });
};
