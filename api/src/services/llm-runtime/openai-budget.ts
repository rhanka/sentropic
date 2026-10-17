import { LUNA_CONTEXT_WINDOW, LUNA_MAX_INPUT_TOKENS, LUNA_MAX_OUTPUT_TOKENS } from '../../config/models';

export const validateOpenAIRequestBudget = (model: string, request: unknown, outputTokens: number): void => {
  if (!Number.isInteger(outputTokens) || outputTokens < 1 || outputTokens > LUNA_MAX_OUTPUT_TOKENS) {
    throw new RangeError('Invalid OpenAI output token budget');
  }
  if (model !== 'gpt-6-luna' && model !== 'gpt-5.6-luna') return;
  // Same chars/4 heuristic as product context admission; provider tokenization remains authoritative.
  // Count rendered messages, tool definitions/results and structured-output schemas together.
  const estimatedInput = Math.ceil(JSON.stringify(request).length / 4);
  if (estimatedInput > LUNA_MAX_INPUT_TOKENS || estimatedInput + outputTokens > LUNA_CONTEXT_WINDOW) {
    throw new RangeError('OpenAI input context budget exceeded');
  }
};
