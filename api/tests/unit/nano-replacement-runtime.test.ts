import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it, vi } from 'vitest';

vi.mock('../../src/config/env', () => ({ env: { OPENAI_API_KEY: 'offline-test-key' } }));

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
  } finally { runtime.close(); journal.close(); vi.unstubAllGlobals(); rmSync(dir, { recursive: true, force: true }); }
});
