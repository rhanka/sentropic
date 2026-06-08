import type { HarnessProfile } from './profile.js';

// The Sentropic policy, as data (from rules/MASTER.md). The engine never branches on
// `id` — it only reads these fields.
export const sentropicProfile: HarnessProfile = {
  id: 'sentropic',
  // MASTER.md "Default forbidden": Makefile, docker-compose*.yml, .cursor/rules/**.
  forbiddenPathDefaults: ['Makefile', 'docker-compose*.yml', '.cursor/rules/**'],
  // Scope exceptions look like `BR42h-EX1` / `BR04-EX2` (MASTER.md `BRxx-EXn`).
  exceptionIdPattern: /^BR\d+[a-z]?-EX\d+$/,
  conditionalRequiresException: true,
  branchMatch: 'exact',
};
