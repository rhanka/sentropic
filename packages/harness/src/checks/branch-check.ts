import type { HarnessProfile } from '../profile/profile.js';
import type { CheckResult } from '../artifacts/verification-run.js';

export interface BranchCheckInput {
  currentBranch: string;
  /** Caller-supplied this slice (parsing a BRANCH.md identity block is a follow-on). */
  expectedBranch: string;
  profile: HarnessProfile;
  /** Documented reason to skip the check (advisory bypass). */
  bypass?: { reason: string };
}

/** C1 — verify the working branch is the expected one (per the profile's `branchMatch`). */
export function checkBranch(input: BranchCheckInput): CheckResult {
  if (input.bypass) {
    return { pass: true, violations: [], bypass: input.bypass };
  }
  const { currentBranch, expectedBranch, profile } = input;
  const ok =
    profile.branchMatch === 'prefix'
      ? currentBranch.startsWith(expectedBranch)
      : currentBranch === expectedBranch;
  if (ok) return { pass: true, violations: [] };
  return {
    pass: false,
    violations: [
      {
        code: 'C1',
        message: `on branch '${currentBranch}', expected '${expectedBranch}' (${profile.branchMatch})`,
        severity: 'advisory',
      },
    ],
  };
}
