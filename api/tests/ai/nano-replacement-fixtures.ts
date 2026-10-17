export type NanoCase =
  | { id: string; kind: 'title'; text: string; terms: string[] }
  | { id: string; kind: 'effort'; text: string }
  | { id: string; kind: 'compaction'; facts: string[] }
  | { id: string; kind: 'tool_json'; strict: boolean }
  | { id: string; kind: 'history_document'; surface: 'history' | 'document'; estimatedTokens: number; singlePassLimit: number; chunkTarget: number; expectedChunks?: number };

export const NANO_CASES: NanoCase[] = [
  { id: 'title/en', kind: 'title', text: 'Plan the Atlas release: define the launch checklist and owner assignments.', terms: ['Atlas'] },
  { id: 'title/fr', kind: 'title', text: 'Préparer le lancement du projet Orion et répartir les tâches de validation.', terms: ['Orion'] },
  { id: 'title/verbose', kind: 'title', text: `Project Lyra release planning. ${'We need a clear checklist, named owners, evidence, and a measured rollout. '.repeat(12)}`, terms: ['Lyra'] },
  { id: 'effort/greeting', kind: 'effort', text: 'Say hello in French.' },
  { id: 'effort/comparison', kind: 'effort', text: 'Compare a disk cache and an in-memory cache for a small shared dashboard. Explain the main trade-offs.' },
  { id: 'effort/security', kind: 'effort', text: 'Design a security threat model for a multi-tenant financial ledger. Prove isolation invariants and consider concurrency, partial failures, replay and recovery.' },
  { id: 'compaction/atlas', kind: 'compaction', facts: ['Atlas', '2026-10-23', 'USD 150', 'MEMO-A729'] },
  { id: 'compaction/orion', kind: 'compaction', facts: ['Orion', '2026-10-21', 'EUR 275', 'MEMO-B318'] },
  { id: 'compaction/lyra', kind: 'compaction', facts: ['Lyra', '2026-10-22', 'CAD 420', 'MEMO-C864'] },
  { id: 'tool/json-object', kind: 'tool_json', strict: false },
  { id: 'tool/json-schema', kind: 'tool_json', strict: true },
  { id: 'history/single', kind: 'history_document', surface: 'history', estimatedTokens: 239_000, singlePassLimit: 240_000, chunkTarget: 120_000 },
  { id: 'history/chunk-merge', kind: 'history_document', surface: 'history', estimatedTokens: 119_000, singlePassLimit: 1, chunkTarget: 120_000 },
  { id: 'document/single', kind: 'history_document', surface: 'document', estimatedTokens: 699_000, singlePassLimit: 700_000, chunkTarget: 300_000 },
  { id: 'document/chunk-merge', kind: 'history_document', surface: 'document', estimatedTokens: 299_000, singlePassLimit: 1, chunkTarget: 300_000 },
];

export const LONG_FACTS = ['ATLAS-729', '2026-10-23', '13750', 'REF-Z915'];
export const NANO_PRODUCTION_CHUNK_CASES: Array<Extract<NanoCase, { kind: 'history_document' }>> = [
  { id: 'history/production-chunks', kind: 'history_document', surface: 'history', estimatedTokens: 261_000, singlePassLimit: 240_000, chunkTarget: 120_000, expectedChunks: 3 },
  { id: 'document/production-chunks', kind: 'history_document', surface: 'document', estimatedTokens: 711_000, singlePassLimit: 700_000, chunkTarget: 300_000, expectedChunks: 3 },
];
export const LONG_QUESTIONS = 'Identify the project code, launch deadline, approved budget amount and final reference code. Preserve the exact source identifiers and date format. Who signed the supplier agreement? If absent, answer NOT_STATED. Answer all five questions concisely; do not invent facts.';

/** Facts appear only at the beginning, middle and end; questions never contain their answers. */
export const makeLongFixture = (estimatedTokens: number): string => {
  const first = '# Synthetic archive\nThe project code is ATLAS-729.\n';
  const middle = '\nThe approved budget is USD 13750. The launch deadline is 2026-10-23.\n';
  const last = '\nThe final reference code is REF-Z915. No supplier agreement signer is recorded.\n';
  const remaining = Math.max(0, estimatedTokens * 4 - first.length - middle.length - last.length);
  const half = Math.floor(remaining / 2);
  const pad = (length: number) => ' data'.repeat(Math.ceil(length / 5)).slice(0, length);
  return first + pad(half) + middle + pad(remaining - half) + last;
};
