import { expect, it } from 'vitest';
import { memoryBlockedCases, memoryCaseInventory, MEMORY_STAGE_B_CASES, runMemoryCorpus } from './memory-corpus.js';
import { memoryCampaignHost } from './memory-pg-host.js';
import { runMemoryU64Corpus } from './memory-u64.js';
import { runMemoryOwnershipCorpus } from './memory-ownership.js';
import { runMemoryBoundaryCorpus } from './memory-boundaries.js';
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const installedRoot = process.env.MEMORY_INSTALLED_ROOT;
if (!installedRoot) throw new Error('Stage B must run through the make-owned installed consumer');
for (const name of ['@sentropic/cluster-mesh/engram-memory', '@sentropic/engram/memory-substrate']) {
  expect(realpathSync(fileURLToPath(import.meta.resolve(name))).startsWith(`${installedRoot}/node_modules/`)).toBe(true);
}
runMemoryCorpus(memoryCampaignHost);
runMemoryU64Corpus(memoryCampaignHost);
runMemoryOwnershipCorpus(memoryCampaignHost);
runMemoryBoundaryCorpus(memoryCampaignHost);

it('inventory: should execute every Stage B case through the installed handle', () => {
  const expected = Object.entries(MEMORY_STAGE_B_CASES).flatMap(([profile, cases]) => cases.map((name) => `${profile}/${name}`));
  expect(memoryCaseInventory.slice().sort()).toEqual(expected.sort());
  expect(new Set(memoryCaseInventory).size).toBe(memoryCaseInventory.length);
  expect(memoryBlockedCases).toEqual([]);
  console.info('MEMORY_STAGE_B_COUNTS', JSON.stringify(Object.fromEntries(Object.entries(MEMORY_STAGE_B_CASES)
    .map(([profile, cases]) => [profile, cases.length]))));
  // Qualification is determined from the runner's complete zero-skip result.
  console.info('MEMORY_STAGE_B_INVENTORY', JSON.stringify({ cases: expected, installedRoot }));
});
