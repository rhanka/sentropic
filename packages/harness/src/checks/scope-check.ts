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
  /** Optional commit text; absent means commit guards are not run. */
  commitMessage?: string;
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
  if (input.commitMessage !== undefined && profile.commitMessage) {
    const { requiredPattern, forbiddenPatterns } = profile.commitMessage;
    if (requiredPattern !== undefined && !new RegExp(requiredPattern).test(input.commitMessage)) {
      violations.push({ code: 'C2', message: 'commit message does not match required pattern', severity: 'advisory' });
    }
    for (const pattern of forbiddenPatterns) {
      if (new RegExp(pattern).test(input.commitMessage)) {
        violations.push({ code: 'C2', message: `commit message matches forbidden pattern: ${pattern}`, severity: 'advisory' });
      }
    }
  }
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
