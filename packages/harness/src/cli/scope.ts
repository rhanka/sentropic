// Shared scope-check input resolution — used by `check scope`, `verify`, and `audit` so the
// BRANCH.md parsing + boundary wiring lives in ONE place (no duplicated file IO).

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { findRepoRoot } from '../profile/resolve.js';
import { parseBranchMd } from '../branch-md/parse.js';
import { checkScope } from '../checks/scope-check.js';
import type { CheckResult } from '../artifacts/verification-run.js';
import type { HarnessProfile } from '../profile/profile.js';
import { list, str, type FlagValue } from './args.js';

export interface ScopeOutcome {
  /** The scope CheckResult, when inputs resolved. */
  result?: CheckResult;
  /** The unreadable plan-file path, when `--branch-md` could not be read. */
  unreadable?: string;
}

/** Resolve `--branch-md` + `--staged-files` into a C2 scope CheckResult (pure but for the file read). */
export function scopeFromFlags(flags: Record<string, FlagValue>, profile: HarnessProfile): ScopeOutcome {
  const explicitPath = str(flags['branch-md']);
  const branchMdPath = explicitPath ?? (profile.branchMd ? resolve(findRepoRoot(), profile.branchMd.file) : undefined);
  let parsed: ReturnType<typeof parseBranchMd> | undefined;
  if (branchMdPath && (explicitPath !== undefined || existsSync(branchMdPath))) {
    try {
      parsed = parseBranchMd(readFileSync(branchMdPath, 'utf8'), profile);
    } catch {
      return { unreadable: branchMdPath };
    }
  }
  const result = checkScope({
    stagedFiles: list(flags['staged-files']),
    boundary: {
      allowed: parsed?.allowedPaths ?? [],
      forbidden: parsed?.forbiddenPaths ?? [],
      conditional: parsed?.conditionalPaths ?? [],
    },
    profile,
    declaredExceptions: parsed?.exceptions ?? [],
    commitMessage: str(flags['commit-message']),
  });
  return { result };
}
