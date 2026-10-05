import type { NativeUsageSnapshot, TokenUsage } from '@sentropic/llm-mesh';
import { createId } from '../../utils/id';
import { recordLlmUsage } from '../llm-metering/cost-ledger-sink';

const modelId = (value: unknown) => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/.test(value) ? value : 'unknown';
const count = (value: number | undefined) => Number.isSafeInteger(value) && value! >= 0 ? value : undefined;

/** Named physical/raw fields only; pricing floors and arbitrary provider objects never enter observations. */
export const nativeObservationUsage = (snapshot: NativeUsageSnapshot): TokenUsage => ({
  inputTokens: count(snapshot.inputTokens), outputTokens: count(snapshot.outputTokens), totalTokens: count(snapshot.totalTokens),
  providerRawUsage: {
    input_tokens: count(snapshot.rawUsage?.input_tokens), output_tokens: count(snapshot.rawUsage?.output_tokens),
    cache_read_input_tokens: count(snapshot.rawUsage?.cache_read_input_tokens),
    cache_creation_input_tokens: count(snapshot.rawUsage?.cache_creation_input_tokens),
    ...(snapshot.rawUsage?.cache_creation ? { cache_creation: {
      ephemeral_5m_input_tokens: count(snapshot.rawUsage.cache_creation.ephemeral_5m_input_tokens),
      ephemeral_1h_input_tokens: count(snapshot.rawUsage.cache_creation.ephemeral_1h_input_tokens),
    } } : {}),
    estimated: snapshot.estimated, final_output_observed: snapshot.finalOutputObserved, termination: snapshot.termination,
    uncertainty_reason: snapshot.nativeUsageUncertainty, native_pricing_policy: snapshot.nativePricingPolicy,
    native_selected_model_id: modelId(snapshot.nativeSelectedModelId), native_served_model_id: modelId(snapshot.nativeServedModelId),
    input_usage_validated: snapshot.nativeInputUsageValidated === true, input_usage_source: snapshot.nativeInputUsageSource,
    cache_write_split_reason: snapshot.nativeCacheWriteSplitReason,
    fallback_present: snapshot.fallbackPresent, iterations_present: snapshot.iterationsPresent,
  },
});

/** Created at prepare: retain only attribution, bounded response state and the terminal snapshot. */
export const createNativeObservation = (identity: { userId?: string; workspaceId?: string; credentialSource: string },
  record: typeof recordLlmUsage = recordLlmUsage) => {
  const callId = `native-call:${createId()}`;
  let responseId: string | undefined; let stream = false; let started = false; let finalized = false;
  return {
    bind(requestId: string, isStream: boolean) { responseId = requestId; stream = isStream; },
    started() { started = true; },
    async finalize(snapshot: NativeUsageSnapshot) {
      if (finalized || !started || !responseId) return;
      finalized = true;
      // The gateway's bounded helper catches this write's rejection/expiry. Do not
      // disguise a failed write as confirmed observation or recompute usage here.
      await record({ ...identity, callId, responseId, operation: stream ? 'stream' : 'generate', providerId: 'anthropic',
        modelId: modelId(snapshot.nativeServedModelId), finishReason: snapshot.termination, usage: nativeObservationUsage(snapshot) });
    },
  };
};
