import { isDeepStrictEqual } from 'node:util';
import { NativeSseFramer } from '@sentropic/llm-gateway';
import { safeQualificationModel } from '../../src/services/llm-runtime/gw-native-qualification-observer';
import { inputUsageReceipt } from './gw-native-qualification-receipts';
import { requireQualification } from './gw-native-qualification-readiness';

const safeCount = (value: unknown): number | null => Number.isSafeInteger(value) && (value as number) >= 0 ? value as number : null;
const usage = (value: Record<string, any> = {}) => {
  const project = (object: Record<string, unknown>, keys: string[]) => Object.fromEntries(keys.filter(key => Object.hasOwn(object, key))
    .map(key => [key, object[key] === null ? null : typeof object[key] === 'number' ? object[key] : 'invalid']));
  return { ...project(value, ['input_tokens', 'cache_read_input_tokens', 'cache_creation_input_tokens', 'output_tokens']),
    ...(value.cache_creation == null ? {} : { cache_creation: typeof value.cache_creation === 'object'
      ? project(value.cache_creation, ['ephemeral_5m_input_tokens', 'ephemeral_1h_input_tokens']) : 'invalid' }) };
};
/** Consume HTTP bytes only; keep bounded named usage categories and equality booleans. */
export const readQualificationReply = async (response: Response, stream: boolean, expectedResults: unknown) => {
  const reader = response.body?.getReader(); requireQualification(reader);
  const framer = new NativeSseFramer(); const json: Uint8Array[] = [];
  let responseBytes = 0, servedModel = 'other', present = false, equal = true, stopped = false, started = false;
  let start: Record<string, unknown> = {}; const deltas: Record<string, unknown>[] = [];
  let finalOutput: number | null = null, countTokens: number | null = null, searches = 0, serverTool = false, resultObserved = false;
  const safeguards = (body: Record<string, unknown>) => {
    if (Object.hasOwn(body, 'safeguard_results')) { present = true; equal &&= isDeepStrictEqual(body.safeguard_results, expectedResults); }
  };
  const tool = (block: Record<string, unknown> | undefined) => {
    if (block?.type === 'server_tool_use' && block.name === 'web_search') serverTool = true;
    if (block?.type === 'web_search_tool_result' && Array.isArray(block.content) && block.content.length > 0
      && block.content.every(value => value?.type === 'web_search_result')) resultObserved = true;
  };
  const event = (body: Record<string, any>) => {
    requireQualification(body.type !== 'error');
    if (body.type === 'message_start') {
      requireQualification(!started); started = true; servedModel = safeQualificationModel(body.message?.model); start = usage(body.message?.usage);
    }
    if (body.type === 'message_delta') {
      requireQualification(started && deltas.length < 256); safeguards(body.delta ?? {}); deltas.push(usage(body.usage));
      if (body.usage?.output_tokens != null) finalOutput = safeCount(body.usage.output_tokens);
      searches = Math.max(searches, safeCount(body.usage?.server_tool_use?.web_search_requests) ?? 0);
    }
    if (body.type === 'content_block_start') tool(body.content_block);
    if (body.type === 'message_stop') { requireQualification(started); stopped = true; }
  };
  try {
    while (true) {
      const chunk = await reader!.read(); if (chunk.done) break;
      responseBytes += chunk.value.byteLength; requireQualification(responseBytes <= 1_048_576);
      if (stream) for (const frame of framer.frames(chunk.value)) { if (frame.data) event(JSON.parse(frame.data)); }
      else json.push(chunk.value);
    }
    if (stream) { framer.finish(); requireQualification(stopped); }
    else {
      const body = JSON.parse(Buffer.concat(json).toString('utf8')); servedModel = safeQualificationModel(body.model);
      safeguards(body); start = usage(body.usage); finalOutput = safeCount(body.usage?.output_tokens); countTokens = safeCount(body.input_tokens);
      if (Array.isArray(body.content)) body.content.forEach(tool);
    }
  } finally { await reader!.cancel().catch(() => undefined); reader!.releaseLock(); }
  return { servedModel, responseBytes, safeguardResultsPresent: present, safeguardResultsEqual: present && equal, messageStop: stopped,
    finalOutput, countTokens, serverTool, resultObserved, webSearchRequests: searches, input: inputUsageReceipt(start, deltas) };
};
