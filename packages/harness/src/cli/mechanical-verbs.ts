// Mechanical / producer verbs of the harness CLI.
//
// Unlike the method verbs (which record a WorkEvent), these COMPUTE a verdict and emit a neutral
// `VerificationRun`: `verify` is the category-level roll-up over the available static checks (the
// canonical VerificationRun producer); `audit` diffs the repo against the active profile; `init`
// scaffolds a profile descriptor so the same C1/C2 kernel can run against ANY repo. Pure: the only
// IO is reading the `--branch-md` file (shared with `check scope`); no git/docker/fs writes.

import { toVerificationRun } from '../run/emit.js';
import type { NamedCheck } from '../run/emit.js';
import { checkBranch } from '../checks/branch-check.js';
import { sentropicProfile } from '../profile/sentropic.js';
import { stubProfile } from '../profile/stub.js';
import type { HarnessProfile } from '../profile/profile.js';
import type { VerificationCategory } from '../artifacts/verification-run.js';
import { scopeFromFlags } from './scope.js';
import { str, type FlagValue } from './args.js';

const PLACEHOLDER_TS = '1970-01-01T00:00:00.000Z';
const CATEGORIES = ['none', 'static', 'unit', 'integration', 'e2e', 'ci', 'uat'] as const;

export const MECHANICAL_VERBS = ['verify', 'init', 'audit'] as const;
export type MechanicalVerb = (typeof MECHANICAL_VERBS)[number];

function isMechanicalVerb(v: string | undefined): v is MechanicalVerb {
  return v !== undefined && (MECHANICAL_VERBS as readonly string[]).includes(v);
}

function isCategory(s: string): s is VerificationCategory {
  return (CATEGORIES as readonly string[]).includes(s);
}

function resolveProfile(flags: Record<string, FlagValue>): HarnessProfile {
  return str(flags.profile) === 'stub' ? stubProfile : sentropicProfile;
}

function runContext(flags: Record<string, FlagValue>, category: VerificationCategory, command: string) {
  return {
    runId: 'cli',
    commit: str(flags.commit) ?? 'unknown',
    branch: str(flags['current-branch']) ?? 'unknown',
    env: str(flags.env) ?? 'cli',
    runner: 'harness',
    category,
    command,
    startedAt: PLACEHOLDER_TS,
    finishedAt: PLACEHOLDER_TS,
  };
}

/** Gather the static checks computable from supplied flags (C2 scope, C1 branch). */
function staticChecks(
  flags: Record<string, FlagValue>,
  profile: HarnessProfile,
  out: (s: string) => void,
): NamedCheck[] | null {
  const checks: NamedCheck[] = [];
  if (flags['staged-files'] !== undefined || flags['branch-md'] !== undefined) {
    const outcome = scopeFromFlags(flags, profile);
    if (outcome.unreadable !== undefined) {
      out(`harness: cannot read plan file: ${outcome.unreadable}`);
      return null;
    }
    if (outcome.result) checks.push({ code: 'C2', category: 'static', result: outcome.result });
  }
  if (flags['current-branch'] !== undefined || flags['expected-branch'] !== undefined) {
    const result = checkBranch({
      currentBranch: str(flags['current-branch']) ?? '',
      expectedBranch: str(flags['expected-branch']) ?? '',
      profile,
    });
    checks.push({ code: 'C1', category: 'static', result });
  }
  return checks;
}

function emitRun(
  checks: NamedCheck[],
  flags: Record<string, FlagValue>,
  category: VerificationCategory,
  command: string,
  out: (s: string) => void,
): number {
  const run = toVerificationRun(checks, runContext(flags, category, command));
  if (flags.json === true) {
    out(JSON.stringify(run, null, 2));
  } else {
    out(`${run.result === 'pass' ? 'PASS' : 'FAIL'} ${command} (${category}): ${checks.length} check(s)`);
    for (const v of run.violations) out(`  - ${v.severity}: ${v.message}`);
  }
  return 0;
}

/**
 * Handle a mechanical/producer verb. Returns the exit code (`null` when `verb` is not one of
 * `verify`/`init`/`audit`). Emits a `VerificationRun` (`--json`) or a human summary via `out`.
 */
export function handleMechanicalVerb(
  positionals: string[],
  flags: Record<string, FlagValue>,
  out: (s: string) => void,
): number | null {
  const verb = positionals[0];
  if (!isMechanicalVerb(verb)) return null;

  const profile = resolveProfile(flags);

  if (verb === 'init') {
    const descriptor = {
      id: profile.id,
      forbiddenPathDefaults: profile.forbiddenPathDefaults,
      exceptionIdPattern: profile.exceptionIdPattern.source,
      conditionalRequiresException: profile.conditionalRequiresException,
      branchMatch: profile.branchMatch,
    };
    if (flags.json === true) {
      out(JSON.stringify(descriptor, null, 2));
    } else {
      out(`harness init — profile '${descriptor.id}' (edit and commit as harness.profile.json):`);
      out(`  forbiddenPathDefaults: ${descriptor.forbiddenPathDefaults.join(', ') || '(none)'}`);
      out(`  exceptionIdPattern: ${descriptor.exceptionIdPattern}`);
      out(`  conditionalRequiresException: ${descriptor.conditionalRequiresException}`);
      out(`  branchMatch: ${descriptor.branchMatch}`);
    }
    return 0;
  }

  if (verb === 'verify') {
    const cat = str(flags.category) ?? 'static';
    if (!isCategory(cat)) {
      out(`usage: harness verify [--category ${CATEGORIES.join('|')}] ...`);
      return 2;
    }
    const checks = staticChecks(flags, profile, out);
    if (checks === null) return 2;
    return emitRun(checks, flags, cat, 'harness verify', out);
  }

  // verb === 'audit' — repo-vs-profile drift as a static VerificationRun.
  const outcome = scopeFromFlags(flags, profile);
  if (outcome.unreadable !== undefined) {
    out(`harness: cannot read plan file: ${outcome.unreadable}`);
    return 2;
  }
  const checks: NamedCheck[] = outcome.result
    ? [{ code: 'C2', category: 'static', result: outcome.result }]
    : [];
  return emitRun(checks, flags, 'static', 'harness audit', out);
}
