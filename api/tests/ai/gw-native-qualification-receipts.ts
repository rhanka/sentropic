import { QUALIFICATION_MODELS } from '../../src/services/llm-runtime/gw-native-qualification-plan';
type Usage = Record<string, unknown>;
const categories = ['input_tokens', 'cache_read_input_tokens', 'cache_creation_input_tokens',
  'ephemeral_5m_input_tokens', 'ephemeral_1h_input_tokens'] as const;
const category = (usage: Usage, name: string): unknown => name.startsWith('ephemeral_')
  ? (usage.cache_creation as Usage | undefined)?.[name] : usage[name];
const count = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0;
export const safeInputCategories = (usage: Usage) => Object.fromEntries(categories.map(name => {
  const value = category(usage, name);
  return [name, value === undefined ? 'absent' : value === null ? 'null' : count(value) ? value : 'invalid'];
}));

/** Evidence comparisons only: reported categories, no TTL inference or pricing fold. */
export const inputUsageReceipt = (start: Usage, deltas: readonly Usage[]) => {
  let accepted = safeInputCategories(start);
  let repeats = false, equal = true, decreased = false, growth = false;
  for (const usage of deltas) {
    const supplied: Record<string, number> = {};
    let valid = usage.cache_creation == null || (typeof usage.cache_creation === 'object' && !Array.isArray(usage.cache_creation));
    if (!valid) equal = false;
    let candidateDecrease = false, candidateGrowth = false;
    for (const name of categories) {
      const value = category(usage, name);
      if (value === undefined || value === null) continue;
      repeats = true;
      if (!count(value) || value !== category(start, name)) equal = false;
      const previous = accepted[name];
      if (typeof value === 'number' && Number.isFinite(value) && typeof previous === 'number' && value < previous) candidateDecrease = true;
      if (!count(value)) { valid = false; continue; }
      supplied[name] = value;
      if (typeof previous === 'number' && value > previous) candidateGrowth = true;
    }
    const candidate = { ...accepted, ...supplied };
    const w5 = candidate.ephemeral_5m_input_tokens, w1 = candidate.ephemeral_1h_input_tokens;
    // Do not compare inherited TTL allocation with aggregate growth unless the split was actually supplied.
    if ('ephemeral_5m_input_tokens' in supplied && 'ephemeral_1h_input_tokens' in supplied
      && typeof w5 === 'number' && typeof w1 === 'number'
      && (!Number.isSafeInteger(w5 + w1) || w5 + w1 !== candidate.cache_creation_input_tokens)) valid = false;
    decreased ||= candidateDecrease;
    if (valid && !candidateDecrease) { accepted = candidate; growth ||= candidateGrowth; }
  }
  return { message_delta_repeats_input: repeats, message_delta_input_equals_start: repeats && equal,
    message_delta_input_decreased: decreased, numeric_input_growth: growth,
    input_start: safeInputCategories(start), input_deltas: deltas.map(safeInputCategories) };
};
export const cleanNativeMeasured = (model: string, observation: Usage, financial: Usage, stream = true): boolean => {
  const raw = observation.usage_raw as Usage | undefined;
  const attempts = financial.attempts as Usage[] | undefined;
  const attempt = attempts?.[0];
  return !!raw && !!attempt && attempts?.length === 1 && raw.input_usage_validated === true
    && (stream ? ['message_start', 'message_delta'] : ['json']).includes(String(raw.input_usage_source))
    && raw.uncertainty_reason == null && raw.estimated === false && attempt.estimated === false
    && raw.final_output_observed === true && raw.termination === 'completed'
    && raw.fallback_present === false && raw.iterations_present === false
    && raw.native_selected_model_id === model && raw.native_served_model_id === model
    && count(observation.input_tokens) && count(observation.output_tokens) && observation.output_tokens === raw.output_tokens
    && observation.output_tokens === financial.output_tokens && observation.output_tokens === attempt.outputTokens
    && observation.input_tokens === financial.input_tokens && observation.input_tokens === attempt.inputTokens;
};
export type ServerToolEvidence = {
  selectedModel: string; servedModel: string; native: boolean; requestId: string;
  toolName: string; serverTool: boolean; resultObserved: boolean; webSearchRequests: number;
  input: ReturnType<typeof inputUsageReceipt>;
};
export const serverToolQualifies = (turn: ServerToolEvidence): boolean =>
  QUALIFICATION_MODELS.some(model => model === turn.selectedModel) && turn.servedModel === turn.selectedModel
  && turn.native && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(turn.requestId)
  && turn.toolName === 'web_search' && turn.serverTool && turn.resultObserved
  && count(turn.webSearchRequests) && turn.webSearchRequests > 0
  && turn.input.message_delta_repeats_input && turn.input.numeric_input_growth && !turn.input.message_delta_input_decreased;
