import { chatService, compactConversationContext } from '../../src/services/chat-service';
import type { NanoCandidate } from '../utils/nano-qualification-budget';
import type { NanoCase } from './nano-replacement-fixtures';
import { sha256 } from './nano-replacement-runtime';

export type NanoCaseResult = { output: unknown; checks: Record<string, boolean>; fixtureSha256: string };
const contains = (text: string, fact: string) => text.replace(/\s/g, '').toLowerCase().includes(fact.replace(/\s/g, '').toLowerCase());

export const runNanoShortCase = async (fixture: NanoCase, model: NanoCandidate, signal: AbortSignal): Promise<NanoCaseResult> => {
  if (fixture.kind === 'title') {
    const title = await (chatService as any).generateSessionTitle({ lastUserMessage: fixture.text });
    return { output: title, fixtureSha256: sha256(fixture.text), checks: {
      nonempty: typeof title === 'string' && title.trim().length > 0,
      bounded: typeof title === 'string' && title.length <= 80,
      relevant: typeof title === 'string' && fixture.terms.every((term) => contains(title, term)),
    } };
  }
  if (fixture.kind === 'effort') {
    const conversation = [{ role: 'user', content: fixture.text }];
    const result = await (chatService as any).evaluateReasoningEffortInternal({ selectedProviderId: 'openai', selectedModel: model,
      userId: '', workspaceId: '', conversation, signal });
    return { output: result, fixtureSha256: sha256(JSON.stringify(conversation)), checks: {
      validLabel: ['none', 'low', 'medium', 'high', 'xhigh'].includes(result.effortLabel),
      actualEvaluation: result.shouldEvaluate === true && result.evaluatedBy === model && result.evaluatorModel === model,
      noMaskedFailure: !result.failure,
    } };
  }
  if (fixture.kind !== 'compaction') throw new Error('Unexpected short qualification case');
  const messages = [
    { role: 'system' as const, content: 'Maintain an accurate working record.' },
    { role: 'user' as const, content: `Project facts: ${fixture.facts.join('; ')}. The launch requires owner approval.` },
    { role: 'assistant' as const, content: 'Tool evidence: the budget and memo reference were verified.' },
    { role: 'user' as const, content: 'Preserve those facts and the unresolved supplier agreement question.' },
    { role: 'assistant' as const, content: 'The supplier agreement signer remains unknown.' },
    ...Array.from({ length: 8 }, (_, index) => ({ role: index % 2 ? 'assistant' as const : 'user' as const, content: `Recent operational turn ${index}.` })),
  ];
  const result = await compactConversationContext({ messages, providerId: 'openai', modelId: model, userId: '', workspaceId: '', signal });
  return { output: { summary: result.summary, summarizedCount: result.summarizedCount }, fixtureSha256: sha256(JSON.stringify(messages)),
    checks: { ...Object.fromEntries(fixture.facts.map((fact) => [`retains:${fact}`, contains(result.summary, fact)])),
      unresolvedQuestion: /supplier|agreement/i.test(result.summary),
      injectedIntoNextContext: String(result.compactedMessages[0]?.content).includes(result.summary),
      recentTailPreserved: result.compactedMessages.length === 9,
    } };
};
