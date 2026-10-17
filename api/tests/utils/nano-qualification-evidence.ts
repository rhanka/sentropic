import { closeSync, fsyncSync, mkdirSync, openSync, writeSync } from 'node:fs';
import { join } from 'node:path';
import type { NanoUsage } from './nano-qualification-budget';

/** The persistent exclusive-create file is also the one-use campaign lock. Never reset it on retry. */
export const createNanoJournal = (directory: string, metadata: Record<string, unknown>) => {
  mkdirSync(directory, { recursive: true });
  const descriptor = openSync(join(directory, 'campaign.jsonl'), 'wx', 0o600);
  let closed = false;
  const append = (event: Record<string, unknown>) => {
    if (closed) throw new Error('Qualification journal is closed');
    writeSync(descriptor, `${JSON.stringify({ at: new Date().toISOString(), ...event })}\n`);
    fsyncSync(descriptor);
  };
  append({ type: 'campaign', ...metadata });
  return { append, close: () => { if (!closed) { closeSync(descriptor); closed = true; } } };
};

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' ? value as Record<string, unknown> : {};

/** Read before the mesh normalizer so synchronous reasoning and served identity are not lost. */
export const decodeNanoUsage = (response: unknown): { usage: NanoUsage; reasoningReported: boolean } | null => {
  const usage = record(record(response).usage);
  const input = usage.input_tokens ?? usage.prompt_tokens;
  const output = usage.output_tokens ?? usage.completion_tokens;
  if (typeof input !== 'number' || typeof output !== 'number') return null;
  const inputDetails = record(usage.input_tokens_details ?? usage.prompt_tokens_details);
  const outputDetails = record(usage.output_tokens_details ?? usage.completion_tokens_details);
  const reasoningReported = typeof outputDetails.reasoning_tokens === 'number';
  return {
    usage: { input, output, cached: typeof inputDetails.cached_tokens === 'number' ? inputDetails.cached_tokens : 0,
      reasoning: reasoningReported ? outputDetails.reasoning_tokens as number : 0 },
    reasoningReported,
  };
};
