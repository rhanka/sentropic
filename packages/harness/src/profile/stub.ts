import type { HarnessProfile } from './profile.js';

// A deliberately-different 2nd profile that PROVES the engine is profile-generic.
// It differs from `sentropic` on dimensions C2 actually consumes — a different
// exception-id grammar, a different forbidden-default set, and conditional-without-
// exception allowed — so the Lot 4 genericity test can assert DIVERGENT outcomes on the
// same BRANCH.md + staged-file input (not "both pass", which would prove nothing).
export const stubProfile: HarnessProfile = {
  id: 'stub',
  forbiddenPathDefaults: ['secret/**'],
  exceptionIdPattern: /^EXC-\d+$/,
  conditionalRequiresException: false,
  branchMatch: 'prefix',
};
