import type { HarnessProfile } from '../profile/profile.js';
import type { CheckResult, Violation } from '../artifacts/verification-run.js';
import { classifyPath, type ScopeBoundary } from '../scope/scope-boundary.js';

export interface ScopeCheckInput {
  /** Repo-relative staged file paths. */
  stagedFiles: string[];
  boundary: ScopeBoundary;
  profile: HarnessProfile;
  /** Exception ids declared in the BRANCH.md (e.g. parser `exceptions`). */
  declaredExceptions?: string[];
  bypass?: { reason: string };
}

/**
 * C2 — verify staged files stay within the declared scope.
 *  - `forbidden` (explicit or profile-default) → violation;
 *  - `conditional` → violation unless a declared exception matches the profile's
 *    `exceptionIdPattern` (grammar binding) AND `conditionalRequiresException` is set;
 *  - `unknown` (outside Allowed/Forbidden/Conditional) → violation.
 */
export function checkScope(input: ScopeCheckInput): CheckResult {
  if (input.bypass) return { pass: true, violations: [], bypass: input.bypass };
  const { stagedFiles, boundary, profile, declaredExceptions = [] } = input;
  const hasValidException = declaredExceptions.some((id) => profile.exceptionIdPattern.test(id));
  const violations: Violation[] = [];
  for (const path of stagedFiles) {
    const cls = classifyPath(path, boundary, profile);
    if (cls === 'forbidden') {
      violations.push({ code: 'C2', path, message: `forbidden path touched: ${path}`, severity: 'advisory' });
    } else if (cls === 'conditional' && profile.conditionalRequiresException && !hasValidException) {
      violations.push({
        code: 'C2',
        path,
        message: `conditional path touched without a matching exception: ${path}`,
        severity: 'advisory',
      });
    } else if (cls === 'unknown') {
      violations.push({ code: 'C2', path, message: `path outside declared scope (unknown): ${path}`, severity: 'advisory' });
    }
  }
  return { pass: violations.length === 0, violations };
}
