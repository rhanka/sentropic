import { z } from 'zod';
import { callLLMStream, type CallLLMStreamOptions } from '../../src/services/llm-runtime';
import type { NanoCandidate } from '../utils/nano-qualification-budget';
import type { NanoCase } from './nano-replacement-fixtures';
import type { NanoCaseResult } from './nano-replacement-short-cases';
import { sha256, type createNanoRuntime } from './nano-replacement-runtime';

const collect = async (options: CallLLMStreamOptions) => {
  let text = '';
  const calls = new Map<string, { id: string; name: string; args: string }>();
  for await (const event of callLLMStream(options)) {
    const data = event.data as Record<string, any>;
    if (event.type === 'content_delta') text += data.delta ?? '';
    if (event.type === 'tool_call_start') calls.set(data.tool_call_id, { id: data.tool_call_id, name: data.name, args: data.args ?? '' });
    if (event.type === 'tool_call_delta') {
      const call = calls.get(data.tool_call_id);
      if (call) call.args += data.delta ?? '';
    }
    if (event.type === 'error') throw new Error('Qualification product stream failed');
  }
  return { text, calls: [...calls.values()] };
};

const tool = { type: 'function' as const, function: { name: 'lookup_record', description: 'Read the authoritative project budget and memo reference.',
  parameters: { type: 'object', properties: { project_code: { type: 'string' } }, required: ['project_code'], additionalProperties: false } } };
const schema = { type: 'object', properties: { project_code: { type: 'string' }, budget: { type: 'integer' }, reference: { type: 'string' } },
  required: ['project_code', 'budget', 'reference'], additionalProperties: false };
const resultSchema = z.object({ project_code: z.literal('ATOM-X17'), budget: z.literal(13750), reference: z.literal('Q-884') }).strict();
const prompt = 'Call lookup_record exactly once for project ATOM-X17 to retrieve its authoritative budget and memo reference. Do not answer before the tool result. Then return one JSON object with project_code, budget and reference, copying the tool result. Never infer missing values.';

export const runNanoToolCase = async (fixture: Extract<NanoCase, { kind: 'tool_json' }>, model: NanoCandidate,
  signal: AbortSignal, runtime: ReturnType<typeof createNanoRuntime>): Promise<NanoCaseResult> => {
  const format = fixture.strict ? { structuredOutput: { name: 'project_budget', schema, strict: true } }
    : { responseFormat: 'json_object' as const };
  const first = await collect({ model, messages: [{ role: 'user', content: prompt }], tools: [tool], toolChoice: 'required',
    reasoningEffort: 'none', maxOutputTokens: 2048, signal, ...format });
  const previousResponseId = runtime.receipts.at(-1)?.responseId;
  let validArgs = false;
  try { validArgs = first.calls.length === 1 && JSON.parse(first.calls[0].args).project_code === 'ATOM-X17'; } catch { /* Invalid JSON is a measured failure. */ }
  if (!first.calls.length || !previousResponseId) return { output: first, fixtureSha256: sha256(prompt + JSON.stringify(format)),
    checks: { toolCalled: false, continuation: false, schemaValid: false } };
  const rawInput = first.calls.map((call) => ({ type: 'function_call_output', call_id: call.id,
    output: JSON.stringify({ project_code: 'ATOM-X17', budget: 13750, reference: 'Q-884' }) }));
  const final = await collect({ model, messages: [], rawInput, previousResponseId,
    reasoningEffort: 'none', maxOutputTokens: 2048, signal, ...format });
  let schemaValid = false;
  try { schemaValid = resultSchema.safeParse(JSON.parse(final.text)).success; } catch { /* Never repair or rerun an invalid candidate output. */ }
  return { output: { calls: first.calls, previousResponseId, submittedCallIds: rawInput.map((item) => item.call_id), final: final.text },
    fixtureSha256: sha256(prompt + JSON.stringify(format)), checks: {
      exactTool: first.calls.length === 1 && first.calls[0].name === 'lookup_record',
      validArguments: validArgs, matchingCallIds: rawInput.every((item, index) => item.call_id === first.calls[index].id),
      continuation: typeof previousResponseId === 'string', schemaValid,
    } };
};
