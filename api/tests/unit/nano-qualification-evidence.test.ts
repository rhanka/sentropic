import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('nano qualification durable evidence', () => {
  it('should refuse a second campaign against an existing reservation journal', async () => {
    const { createNanoJournal } = await import('../utils/nano-qualification-evidence');
    const dir = mkdtempSync(join(tmpdir(), 'nano-ledger-'));
    try {
      const journal = createNanoJournal(dir, { sourceCommit: 'fixture-sha' });
      journal.append({ type: 'reserved', reservedMicroUsd: 100 });
      journal.close();
      expect(() => createNanoJournal(dir, {})).toThrow();
      const rows = readFileSync(join(dir, 'campaign.jsonl'), 'utf8').trim().split('\n').map((row) => JSON.parse(row));
      expect(rows).toHaveLength(2);
      expect(rows[1].reservedMicroUsd).toBe(100);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('should capture raw Chat Completions and Responses reasoning counters', async () => {
    const { decodeNanoUsage } = await import('../utils/nano-qualification-evidence');
    for (const usage of [
      { prompt_tokens: 1000, completion_tokens: 100, prompt_tokens_details: { cached_tokens: 10 }, completion_tokens_details: { reasoning_tokens: 20 } },
      { input_tokens: 1000, output_tokens: 100, input_tokens_details: { cached_tokens: 10 }, output_tokens_details: { reasoning_tokens: 20 } },
    ]) {
      expect(decodeNanoUsage({ usage })).toEqual({ usage: { input: 1000, output: 100, cached: 10, reasoning: 20 }, reasoningReported: true });
    }
    expect(decodeNanoUsage({ usage: null })).toBeNull();
    expect(decodeNanoUsage({ usage: { input_tokens: 5, output_tokens: 1 } })?.reasoningReported).toBe(false);
  });
});
