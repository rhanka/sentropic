import type { GenerateRequest, PreparedRouteAttempt, RoutePlanner, StreamEvent } from '@sentropic/llm-mesh';
import { describe, expect, it, vi } from 'vitest';
import { BUDGET_ATTACHMENT_INPUT_TOKENS, routeUsageCeiling, runRouteJsonFlow, runRouteStreamFlow } from '../src/index.js';
import { estimateAnthropicInputTokens } from '../src/canonical-stream.js';
import {
  MODEL, WIRES, budgetConfig, budgetRouter, jsonAttempt, quotingPlanner, recordingBudget, send,
  streamAttempt, textResponse, type BudgetRecorder,
} from './fixtures/budget.js';

const allowanceUsage = { inputTokens: 100, outputTokens: 64, estimated: true };
const flowRequest = (stream: boolean) => ({
  wire: 'openai-chat-completions' as const, headers: {}, model: MODEL, stream,
  authContext: { method: 'POST', url: 'https://gateway.test/v1/chat/completions', requestId: 'req-1' },
  body: { model: MODEL, max_tokens: 64, stream, messages: [{ role: 'user', content: 'hello' }] },
});
const deps = (planner: RoutePlanner, recorder: BudgetRecorder) => ({
  config: budgetConfig, routePlanner: planner, metering: recorder.metering, budget: recorder.options,
});
const failWith = (status: number) => jsonAttempt(async () => { throw Object.assign(Error('upstream'), { status }); });

describe('budget default output ceiling', () => {
  it.each(WIRES.flatMap((wire) => [false, true].map((stream) => ({ ...wire, stream }))))(
    'sends the reserved default ceiling to the dispatch ($wire, stream=$stream)', async ({ path, stream }) => {
      const received: GenerateRequest[] = [];
      const attempt: PreparedRouteAttempt = {
        ...jsonAttempt(async () => textResponse({ inputTokens: 3, outputTokens: 2 })()),
        async generate(request) { received.push(request); return textResponse({ inputTokens: 3, outputTokens: 2 })() as never; },
        async stream(request) {
          received.push(request);
          return (async function* (): AsyncGenerator<StreamEvent> {
            yield { type: 'content_delta', data: { delta: 'answer' } };
            yield { type: 'done', data: { finishReason: 'stop', usage: { inputTokens: 3, outputTokens: 2 } } };
          })();
        },
      };
      const { planner, calls } = quotingPlanner([attempt]);
      const recorder = recordingBudget(undefined, { defaultOutputTokens: 512 });
      const response = await send(budgetRouter({ planner, recorder }), path, stream, { max_tokens: undefined });
      await response.text();
      expect(response.status).toBe(200);
      expect(calls.quote[0]!.ceiling.outputTokens).toBe(512);
      expect(received).toHaveLength(1);
      expect(received[0]!.maxOutputTokens).toBe(512);
    });
});

describe('budget multimodal input ceiling', () => {
  it('counts images, files and tool media as imageUnits with a per-attachment allowance', () => {
    const file = 'A'.repeat(80_000);
    const request: GenerateRequest = { messages: [
      { role: 'user', content: [{ type: 'text', text: 'describe' },
        { type: 'image', mediaType: 'image/png', data: 'iVBORw0KGgo='.repeat(5_000) },
        { type: 'file', mediaType: 'application/pdf', data: file, filename: 'a.pdf' }] },
      { role: 'tool', content: '', toolResult: { toolCallId: 't1', output: null,
        content: [{ type: 'media', mediaType: 'image/png', url: 'https://example.test/a.png' }] } },
    ] } as GenerateRequest;
    const ceiling = routeUsageCeiling({ request, requiredCapabilities: [] },
      { ...recordingBudget().options, defaultOutputTokens: 256 });
    const fileTokens = Math.ceil(Math.ceil((file.length * 3) / 4) / 4);
    expect(ceiling).toEqual({
      inputTokens: estimateAnthropicInputTokens(request) + 2 * BUDGET_ATTACHMENT_INPUT_TOKENS + fileTokens,
      outputTokens: 256, imageUnits: 3,
    });
  });
  it('keeps text-only ceilings without imageUnits', () => {
    const request: GenerateRequest = { messages: [{ role: 'user', content: 'hello' }], maxOutputTokens: 8 };
    expect(routeUsageCeiling({ request, requiredCapabilities: [] }, recordingBudget().options))
      .toEqual({ inputTokens: estimateAnthropicInputTokens(request), outputTokens: 8 });
  });
});

describe('budget unmeasured usage', () => {
  it.each([
    ['empty usage {}', {}],
    ['partial usage { totalTokens }', { totalTokens: 70 }],
    ['zero-filled usage', { inputTokens: 0, outputTokens: 0 }],
  ])('charges the allowance for %s', async (_name, usage) => {
    const { planner } = quotingPlanner([jsonAttempt(async () => ({ ...(await textResponse()()), usage }))]);
    const recorder = recordingBudget();
    await runRouteJsonFlow(deps(planner, recorder), flowRequest(false));
    expect(recorder.settlements[0]!.usage).toEqual(allowanceUsage);
  });
  it('charges the allowance for a stream error carrying partial usage', async () => {
    const { planner } = quotingPlanner([streamAttempt(async function* (): AsyncGenerator<StreamEvent> {
      yield { type: 'error', data: { message: 'boom', usage: { inputTokens: 40 } } as never };
    })]);
    const recorder = recordingBudget();
    await expect(runRouteStreamFlow(deps(planner, recorder), flowRequest(true))).rejects.toThrow();
    expect(recorder.settlements[0]!.attempts[0]!.usage).toEqual(allowanceUsage);
  });
});

describe('budget release and marker failures', () => {
  it('settles once and keeps the original error when release fails', async () => {
    const { planner } = quotingPlanner([]);
    const recorder = recordingBudget();
    recorder.port.release = async () => { recorder.events.push('release-failed'); throw Error('store down'); };
    await expect(runRouteJsonFlow(deps(planner, recorder), flowRequest(false)))
      .rejects.toMatchObject({ kind: 'no-eligible-account' });
    expect(recorder.events).toEqual(['admit', 'release-failed', 'settle']);
    expect(recorder.settlements).toHaveLength(1);
  });
  it('charges attempt 1 and never releases when the marker fails on attempt 2', async () => {
    const generate = vi.fn();
    const { planner } = quotingPlanner([failWith(500), jsonAttempt(generate)]);
    let marks = 0;
    const recorder = recordingBudget(undefined, {
      markDispatched: async () => { marks += 1; if (marks === 2) throw Error('store down'); },
    });
    await expect(runRouteJsonFlow(deps(planner, recorder), flowRequest(false)))
      .rejects.toMatchObject({ kind: 'budget-unavailable' });
    expect(generate).not.toHaveBeenCalled();
    expect(recorder.events).toEqual(['admit', 'mark:hold-1:0', 'mark:hold-1:1', 'settle']);
    expect(recorder.settlements[0]).toMatchObject({ outcome: 'failed', holdRef: 'hold-1',
      attempts: [{ candidateRef: 'candidate-0', usage: allowanceUsage }], usage: allowanceUsage });
  });
});
