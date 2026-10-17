import { expect, it, vi } from 'vitest';
vi.mock('../../src/services/llm-runtime', () => ({ callLLM: vi.fn(), callLLMStream: vi.fn() }));
import { callLLM } from '../../src/services/llm-runtime';
import { NANO_PRODUCTION_CHUNK_CASES } from '../ai/nano-replacement-fixtures';
import { runNanoLongCase } from '../ai/nano-replacement-long-cases';

it.each(NANO_PRODUCTION_CHUNK_CASES)('should trigger three real production chunks and merge for $surface', async (fixture) => {
  const generate = vi.mocked(callLLM).mockReset().mockResolvedValue({
    choices: [{ message: { content: 'ATLAS-729; 2026-10-23; 13750; REF-Z915; NOT_STATED' } }],
  } as any);
  const result = await runNanoLongCase(fixture, 'gpt-6-luna', new AbortController().signal);
  expect(result.checks.expectedPath).toBe(true);
  expect(generate).toHaveBeenCalledTimes(4);
  const chunks = generate.mock.calls.slice(0, 3).map(([options]) => JSON.stringify(options.messages));
  expect(chunks[0]).toContain('ATLAS-729');
  expect(chunks[1]).toContain('13750');
  expect(chunks[2]).toContain('REF-Z915');
  for (const [index, [options]] of generate.mock.calls.entries()) {
    expect(options).toMatchObject({ model: 'gpt-6-luna', reasoningEffort: 'none', maxOutputTokens: index === 3 ? 20_000 : 6000 });
  }
});
