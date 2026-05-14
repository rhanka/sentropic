import type OpenAI from 'openai';

import { callLLM, callLLMStream } from '../llm-runtime';
import type { ProviderId } from '../provider-runtime';
import type {
  MeshDispatchPort,
  MeshInvokeRequest,
  MeshInvokeResponse,
  MeshStreamEvent,
  MeshStreamRequest,
} from '../../../../packages/chat-core/src/mesh-port';

/**
 * Per SPEC §1 / §5 — MeshDispatchAdapter implements MeshDispatchPort over
 * the existing `callLLM` / `callLLMStream` surface in
 * `api/src/services/llm-runtime/index.ts`. BR14b Lot 10 — first concrete
 * mesh boundary adapter. Mirrors the verbatim-extraction pattern set by
 * `postgres-stream-buffer.ts` (Lot 7): the adapter delegates to the
 * existing module-level callables without behavior change. Opaque
 * payload-typed fields (`messages`, `tools`, `rawInput`, `raw`) cross the
 * port boundary as `unknown` — the adapter narrows them via local casts
 * back to the precise OpenAI / vendor shapes consumed by `callLLM`.
 *
 * Behavior preservation contract: any chat-service.ts orchestration that
 * already migrates onto `ChatRuntime` and routes through this adapter
 * MUST observe byte-identical inputs/outputs vs. the pre-Lot-10 path
 * that called `callLLM` / `callLLMStream` directly.
 */
export class MeshDispatchAdapter implements MeshDispatchPort {
  async invoke(request: MeshInvokeRequest): Promise<MeshInvokeResponse> {
    const raw = await callLLM({
      messages: request.messages as OpenAI.Chat.Completions.ChatCompletionMessageParam[],
      providerId: request.providerId as ProviderId | undefined,
      model: request.model,
      credential: request.credential,
      userId: request.userId,
      workspaceId: request.workspaceId,
      tools: request.tools as OpenAI.Chat.Completions.ChatCompletionTool[] | undefined,
      toolChoice: request.toolChoice,
      responseFormat: request.responseFormat,
      maxOutputTokens: request.maxOutputTokens,
      signal: request.signal,
    });
    return { raw };
  }

  invokeStream(request: MeshStreamRequest): AsyncIterable<MeshStreamEvent> {
    return callLLMStream({
      messages: request.messages as OpenAI.Chat.Completions.ChatCompletionMessageParam[],
      providerId: request.providerId as ProviderId | undefined,
      model: request.model,
      credential: request.credential,
      userId: request.userId,
      workspaceId: request.workspaceId,
      reasoningEffort: request.reasoningEffort,
      reasoningSummary: request.reasoningSummary,
      tools: request.tools as OpenAI.Chat.Completions.ChatCompletionTool[] | undefined,
      previousResponseId: request.previousResponseId,
      rawInput: request.rawInput as unknown[] | undefined,
      responseFormat: request.responseFormat,
      structuredOutput: request.structuredOutput,
      toolChoice: request.toolChoice,
      maxOutputTokens: request.maxOutputTokens,
      signal: request.signal,
    }) as AsyncIterable<MeshStreamEvent>;
  }
}

export const meshDispatchAdapter = new MeshDispatchAdapter();
