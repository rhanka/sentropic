import type { DecisionPriceLookupKey, DecisionPrice } from '@sentropic/llm-mesh/decision/host';
import { loadPricing, type LedgerDatabase } from './budget-admission';
import { decisionTransaction } from './decision-store';

/** A revision is the immutable row id; it is never inferred from a model's current chat tariff. */
export const resolveDecisionPrice = async (database: LedgerDatabase, key: DecisionPriceLookupKey): Promise<DecisionPrice | null> => {
  const protocol = key.providerId === 'typesafe' && key.modelId === 'jev-1.13.0' ? 'jev-native'
    : key.providerId === 'openai' && key.modelId === 'gpt-6-luna' ? 'openai-decisions' : undefined;
  if (key.authority !== 'control.model_pricing' || key.protocol !== protocol || !protocol) return null;
  return decisionTransaction(database, async (tx) => {
    const row = await loadPricing(tx, key.providerId, key.modelId, new Date());
    if (!row || row.id !== key.priceRevision || row.output !== 0n || row.reasoning !== 0n
      || row.image !== 0n || row.toolCall !== 0n) return null;
    return { ...key, protocol, inputMicroUsdPerMtok: row.input.toString(), outputMicroUsdPerMtok: '0',
      minimumMicroUsd: row.minCharge.toString(), identityMismatchPricing: 'requires-reconciliation' };
  });
};
