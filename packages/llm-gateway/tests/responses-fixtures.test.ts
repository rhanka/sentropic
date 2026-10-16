/**
 * Responses ingress pinned fixtures (spec §16.3, §16.9): every committed
 * CLI capture parses through the strict codec with its tools, controls and
 * correlations intact. The Vibe chat projection is refused on this codec
 * (wire separation); its Chat-path coverage lives in the target tests.
 */
import { describe, expect, it } from 'vitest';

import {
  normalizeResponsesIngress,
  ResponsesIngressError,
} from '../src/responses-ingress.js';

const ingress = (body: unknown) => normalizeResponsesIngress(body);

const bad = (body: unknown): { fieldPath: string; errorCode: string } => {
  try {
    ingress(body);
  } catch (error) {
    expect(error).toBeInstanceOf(ResponsesIngressError);
    const failure = error as ResponsesIngressError;
    return { fieldPath: failure.fieldPath, errorCode: failure.errorCode };
  }
  throw new Error('Expected ResponsesIngressError');
};

describe('responses ingress pinned fixtures', () => {
  const load = async (name: string): Promise<unknown> => {
    const { readFile } = await import('node:fs/promises');
    const url = new URL(`./fixtures/responses/${name}`, import.meta.url);
    return JSON.parse(await readFile(url, 'utf8'));
  };

  it('parses both Muse initials without losing fields, tools or controls', async () => {
    // Initial A carries the 26-function toolset; initial B is the leaner
    // skill-reminder observer shape with a single tool. Both share controls.
    for (const [name, toolNames, effort] of [
      ['muse-1.4.6-initial-a.json', 26, 'max'],
      ['muse-1.4.6-initial-b.json', 1, 'low'],
    ] as const) {
      const result = ingress(await load(name));
      expect(result.request.model).toBe('muse-spark-1.3-contributor');
      expect(result.request.messages[0]).toMatchObject({ role: 'system' });
      expect(result.request.messages.length).toBeGreaterThanOrEqual(2);
      expect(result.request.tools?.map((tool) => tool.name)).toHaveLength(toolNames);
      expect(result.request.maxOutputTokens).toBe(128000);
      expect(result.request.reasoning).toMatchObject({ effort, summary: 'auto' });
      expect(result.requiredCapabilities).toEqual(expect.arrayContaining(['tools', 'reasoning']));
      expect(result.requiredExecutionFeatures).toEqual(expect.arrayContaining([
        'reasoning-controls', 'explicit-output-ceiling',
      ]));
      expect(result.requiredExecutionFeatures).not.toContain('native-reasoning-replay');
    }
    const fullA = ingress(await load('muse-1.4.6-initial-a.json'));
    expect(fullA.request.tools?.map((tool) => tool.name)).toContain('work_list');
  });

  it('replays the Muse tool continuation with call_id correlation', async () => {
    const result = ingress(await load('muse-1.4.6-tool-result.json'));
    expect(result.request.messages).toHaveLength(5);
    const [call, output] = result.request.messages.slice(3);
    if (call?.role !== 'assistant' || output?.role !== 'tool') {
      throw new Error('Expected an assistant call followed by a tool result');
    }
    const callId = call.toolCalls?.[0]?.providerCallId;
    expect(callId).toBe('call_rec1');
    expect(call.toolCalls?.[0]?.toolCallId).toBe('call_rec1');
    expect(output.toolResult?.providerCallId).toBe(callId);
    expect(call.toolCalls?.[0]?.name).toBe('work_list');
  });

  it('parses the Codex probe with custom tools, context and verbosity intact', async () => {
    for (const name of ['codex-0.162.1-initial.json', 'codex-0.162.1-tools.json']) {
      const result = ingress(await load(name));
      expect(result.request.model).toBe('gpt-6.1-sol');
      expect(result.request.messages).toHaveLength(6);
      expect(result.request.toolChoice).toBe('auto');
      expect(result.request.parallelToolCalls).toBe(false);
      expect(result.request.reasoning).toMatchObject({ effort: 'low' });
      expect(result.requiredExecutionFeatures).toEqual(expect.arrayContaining([
        'parallel-tool-control', 'reasoning-controls', 'reasoning-context',
        'verbosity', 'custom-tools',
      ]));
      const carrier = (result.request.providerOptions as Record<string, unknown>)
        .responses as { customTools: { name: string }[]; itemIds: unknown[] };
      expect(carrier.customTools.map((tool) => tool.name)).toContain('exec');
      expect(carrier.itemIds.length).toBeGreaterThan(0);
    }
  });

  it('replays the Codex tool continuation including the error output', async () => {
    const result = ingress(await load('codex-0.162.1-tool-result.json'));
    expect(result.request.messages).toHaveLength(8);
    const [call, output] = result.request.messages.slice(6);
    if (call?.role !== 'assistant' || output?.role !== 'tool') {
      throw new Error('Expected an assistant call followed by a tool result');
    }
    expect(call.toolCalls?.[0]?.providerCallId).toBe('call_rec1');
    expect(output.toolResult?.providerCallId).toBe('call_rec1');
    expect(JSON.stringify(output.toolResult?.output)).toContain('unsupported call');
  });

  it('refuses the Vibe chat projection on the Responses codec (wire separation)', async () => {
    expect(bad(await load('vibe-2.26.1-default.json')))
      .toMatchObject({ fieldPath: 'messages', errorCode: 'unsupported_parameter' });
  });
});
