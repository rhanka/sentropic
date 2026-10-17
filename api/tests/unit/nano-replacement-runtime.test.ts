import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it, vi } from 'vitest';

vi.mock('../../src/config/env', () => ({ env: { OPENAI_API_KEY: 'offline-test-key' } }));
vi.mock('../../src/services/settings', () => ({ settingsService: {
  getAISettings: vi.fn().mockResolvedValue({ defaultProviderId: 'openai', defaultModel: 'gpt-6-luna' }),
  get: vi.fn().mockResolvedValue(null),
} }));

it('should exercise the injected native SDK with physical admission and raw usage capture offline', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'nano-native-'));
  const transport = vi.fn(async () => new Response(JSON.stringify({ id: 'offline-response', model: 'gpt-6-luna',
    choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: 'Project Atlas' } }],
    usage: { prompt_tokens: 100, completion_tokens: 3, completion_tokens_details: { reasoning_tokens: 0 } },
  }), { headers: { 'content-type': 'application/json' } }));
  vi.stubGlobal('fetch', transport);
  const { createNanoJournal } = await import('../utils/nano-qualification-evidence');
  const { createNanoRuntime } = await import('../ai/nano-replacement-runtime');
  const { providerRegistry } = await import('../../src/services/provider-registry');
  const journal = createNanoJournal(dir, {});
  const runtime = createNanoRuntime(journal);
  try {
    runtime.activate('gpt-6-luna', 'offline/title');
    await providerRegistry.requireProvider('openai').generate({ mode: 'chat-completions', requestOptions: {
      model: 'gpt-6-luna', messages: [{ role: 'user', content: 'Title' }], reasoning_effort: 'none', max_completion_tokens: 32,
    } });
    expect(runtime.receipts[0]).toMatchObject({ servedModel: 'gpt-6-luna', usage: { input: 100, output: 3, reasoning: 0 } });
    expect(runtime.budget.snapshot().calls).toBe(1);
    expect(transport).toHaveBeenCalledOnce();
    expect(readFileSync(join(dir, 'campaign.jsonl'), 'utf8')).not.toContain('offline-test-key');
    const sse = (events: unknown[]) => new Response(events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(''),
      { headers: { 'content-type': 'text/event-stream' } });
    const response = (id: string) => ({ id, model: 'gpt-6-luna', status: 'completed',
      usage: { input_tokens: 100, output_tokens: 20, output_tokens_details: { reasoning_tokens: 0 } } });
    transport.mockResolvedValueOnce(sse([
      { type: 'response.output_item.added', item: { type: 'function_call', id: 'fc_unit', call_id: 'call_unit', name: 'lookup_record', arguments: '' } },
      { type: 'response.function_call_arguments.delta', item_id: 'fc_unit', delta: '{"project_code":"ATOM-X17"}' },
      { type: 'response.completed', response: response('resp_tool') },
    ])).mockResolvedValueOnce(sse([
      { type: 'response.output_text.delta', delta: '{"project_code":"ATOM-X17","budget":13750,"reference":"Q-884"}' },
      { type: 'response.completed', response: response('resp_final') },
    ]));
    const { runNanoToolCase } = await import('../ai/nano-replacement-tool-cases');
    const signal = runtime.activate('gpt-6-luna', 'offline/tool-json-schema');
    const result = await runNanoToolCase({ id: 'tool/json-schema', kind: 'tool_json', strict: true }, 'gpt-6-luna', signal, runtime);
    expect(Object.values(result.checks).every(Boolean)).toBe(true);
    expect(runtime.budget.snapshot().calls).toBe(3);
    expect(runtime.receipts[2].responseId).toBe('resp_final');
  } finally { runtime.close(); journal.close(); vi.unstubAllGlobals(); rmSync(dir, { recursive: true, force: true }); }
});
