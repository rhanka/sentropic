import { vi } from 'vitest';
import type { EvaluateReasoningEffortInput, ReasoningEffortEvaluation } from '../../../packages/chat-core/src/runtime';
import type { ChatService } from '../../src/services/chat-service';
import { getDefaultOpenAIModel } from '../../src/config/models';

/** Domain tool/prompt tests isolate classification; nano helper contracts exercise the evaluator. */
export const mockDefaultModelEffort = (service: ChatService): void => {
  const target = service as unknown as {
    evaluateReasoningEffortInternal(input: EvaluateReasoningEffortInput): Promise<ReasoningEffortEvaluation>;
  };
  const original = target.evaluateReasoningEffortInternal.bind(target);
  vi.spyOn(target, 'evaluateReasoningEffortInternal').mockImplementation((input) => {
    if (input.selectedModel !== getDefaultOpenAIModel()) return original(input);
    return Promise.resolve({ shouldEvaluate: true, effortLabel: 'none', effortForMessage: 'none',
      evaluatedBy: getDefaultOpenAIModel(), evaluatorModel: getDefaultOpenAIModel() });
  });
};
