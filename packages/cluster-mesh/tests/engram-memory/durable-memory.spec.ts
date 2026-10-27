import { expect, it } from 'vitest';
import { memoryBlockedCases, memoryCaseInventory, MEMORY_STAGE_B_CASES, runMemoryCorpus } from './memory-corpus.js';
import { memoryCampaignHost } from './memory-pg-host.js';
import { runMemoryU64Corpus } from './memory-u64.js';
import { runMemoryOwnershipCorpus } from './memory-ownership.js';
import { runMemoryBoundaryCorpus } from './memory-boundaries.js';

// These explicit source gaps retain every case; they do not qualify Stage B.
// Missing PostgreSQL remains an error when the actual host can be exercised.
runMemoryCorpus(memoryCampaignHost);
runMemoryU64Corpus(memoryCampaignHost);
runMemoryOwnershipCorpus(memoryCampaignHost);
runMemoryBoundaryCorpus(memoryCampaignHost);

it('inventory: should retain every blocked case without claiming host qualification', () => {
  const expected = Object.entries(MEMORY_STAGE_B_CASES).flatMap(([profile, cases]) => cases.map((name) => `${profile}/${name}`));
  expect(memoryCaseInventory.slice().sort()).toEqual(expected.sort());
  expect(new Set(memoryCaseInventory).size).toBe(memoryCaseInventory.length);
  expect(memoryBlockedCases.map(({ name }) => name).sort()).toEqual(expected.sort());
  expect(memoryBlockedCases.every(({ blockers }) => blockers.includes('blocked: E7-fenced-writers'))).toBe(true);
  expect(memoryBlockedCases.filter(({ blockers }) => blockers.includes('blocked: E7'))).toHaveLength(3);
  console.info('MEMORY_STAGE_B_COUNTS', JSON.stringify(Object.fromEntries(Object.entries(MEMORY_STAGE_B_CASES)
    .map(([profile, cases]) => [profile, cases.length]))));
  console.info('MEMORY_STAGE_B_DISPOSITION', JSON.stringify({ status: 'blocked', qualified: false, cases: memoryBlockedCases }));
});
