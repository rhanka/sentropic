import { readFileSync } from 'node:fs';
import { parseBranchMd } from '../branch-md/parse.js';
import { checkScope } from '../checks/scope-check.js';
import { checkBranch } from '../checks/branch-check.js';
import { toVerificationRun } from '../run/emit.js';
import { sentropicProfile } from '../profile/sentropic.js';
import { stubProfile } from '../profile/stub.js';
import type { HarnessProfile } from '../profile/profile.js';
import type { CheckResult, VerificationCategory } from '../artifacts/verification-run.js';

type FlagValue = string | boolean;

function parseFlags(args: string[]): { positionals: string[]; flags: Record<string, FlagValue> } {
  const positionals: string[] = [];
  const flags: Record<string, FlagValue> = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = args[i + 1];
      if (next === undefined || next.startsWith('--')) {
        flags[key] = true;
      } else {
        flags[key] = next;
        i++;
      }
    } else {
      positionals.push(a);
    }
  }
  return { positionals, flags };
}

function str(v: FlagValue | undefined): string | undefined {
  return typeof v === 'string' ? v : undefined;
}

function list(v: FlagValue | undefined): string[] {
  const s = str(v);
  return s ? s.split(/[\s,]+/).filter(Boolean) : [];
}

const USAGE =
  'usage: harness check <scope|branch> [--current-branch <b>] [--expected-branch <b>] ' +
  '[--staged-files <list>] [--branch-md <path>] [--profile sentropic|stub] [--json]';

/**
 * Pure, arg-based CLI driver — reads everything from `argv`, writes via `out`, returns an exit code.
 * No internal git calls (the caller supplies branch + staged files), no `process.exit`.
 * Advisory (D5 Layer A): a failing check returns 0; only a usage error returns non-zero.
 * Acquiring git state under Docker-first (the `make scope-check` passthrough) is a separate,
 * to-be-double-reviewed concern.
 */
export function runHarnessCli(argv: string[], out: (s: string) => void): number {
  const { positionals, flags } = parseFlags(argv);
  const command = positionals[0];
  const sub = positionals[1];

  if (command !== 'check' || (sub !== 'scope' && sub !== 'branch')) {
    out(USAGE);
    return command === undefined ? 0 : 2;
  }

  const profile: HarnessProfile = str(flags.profile) === 'stub' ? stubProfile : sentropicProfile;
  const category: VerificationCategory = 'static';
  let result: CheckResult;
  let code: string;
  let commandLabel: string;

  if (sub === 'scope') {
    code = 'C2';
    commandLabel = 'harness check scope';
    const branchMdPath = str(flags['branch-md']);
    let parsed: ReturnType<typeof parseBranchMd> | undefined;
    if (branchMdPath) {
      try {
        parsed = parseBranchMd(readFileSync(branchMdPath, 'utf8'));
      } catch {
        out(`harness: cannot read plan file: ${branchMdPath}`);
        return 2;
      }
    }
    result = checkScope({
      stagedFiles: list(flags['staged-files']),
      boundary: {
        allowed: parsed?.allowedPaths ?? [],
        forbidden: parsed?.forbiddenPaths ?? [],
        conditional: parsed?.conditionalPaths ?? [],
      },
      profile,
      declaredExceptions: parsed?.exceptions ?? [],
    });
  } else {
    code = 'C1';
    commandLabel = 'harness check branch';
    result = checkBranch({
      currentBranch: str(flags['current-branch']) ?? '',
      expectedBranch: str(flags['expected-branch']) ?? '',
      profile,
    });
  }

  if (flags.json === true) {
    // Pure: a deterministic placeholder timestamp; a real run injects commit/env/clock context.
    const ts = '1970-01-01T00:00:00.000Z';
    const run = toVerificationRun([{ code, category, result }], {
      runId: 'cli',
      commit: str(flags.commit) ?? 'unknown',
      branch: str(flags['current-branch']) ?? 'unknown',
      env: str(flags.env) ?? 'cli',
      runner: 'harness',
      category,
      command: commandLabel,
      startedAt: ts,
      finishedAt: ts,
    });
    out(JSON.stringify(run, null, 2));
  } else {
    out(`${result.pass ? 'PASS' : 'FAIL'} ${code} (${profile.id})`);
    for (const v of result.violations) out(`  - ${v.severity}: ${v.message}`);
  }

  return 0;
}
