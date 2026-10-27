import { afterAll, expect } from 'vitest';
import { memoryCaseInventory, MEMORY_STAGE_B_CASES, runMemoryCorpus } from './memory-corpus.js';
import { memoryCampaignHost } from './memory-pg-host.js';
import { runMemoryU64Corpus } from './memory-u64.js';
import { runMemoryOwnershipCorpus } from './memory-ownership.js';
import { runMemoryBoundaryCorpus } from './memory-boundaries.js';

// Acceptance infrastructure is mandatory. Never turn an absent PG into a skip.
runMemoryCorpus(memoryCampaignHost);
runMemoryU64Corpus(memoryCampaignHost);
runMemoryOwnershipCorpus(memoryCampaignHost);
runMemoryBoundaryCorpus(memoryCampaignHost);

afterAll(() => {
  const expected = Object.entries(MEMORY_STAGE_B_CASES).flatMap(([profile, cases]) => cases.map((name) => `${profile}/${name}`));
  expect(memoryCaseInventory.filter((name) => name !== 'inventory').sort()).toEqual(expected.sort());
  expect(new Set(memoryCaseInventory).size).toBe(memoryCaseInventory.length);
  console.info('MEMORY_STAGE_B_COUNTS', JSON.stringify(Object.fromEntries(Object.entries(MEMORY_STAGE_B_CASES)
    .map(([profile, cases]) => [profile, cases.length]))));
});
