import { readFileSync } from 'node:fs';
import { parseBranchMd } from '../branch-md/parse.js';
import { checkScope } from '../checks/scope-check.js';
import { checkBranch } from '../checks/branch-check.js';
import { toVerificationRun } from '../run/emit.js';
import { sentropicProfile } from '../profile/sentropic.js';
import { stubProfile } from '../profile/stub.js';
import type { HarnessProfile } from '../profile/profile.js';
import type { CheckResult, VerificationCategory } from '../artifacts/verification-run.js';
import { parseFlags, str, list, type FlagValue } from './args.js';
import { handleMethodVerb } from './method-verbs.js';

const USAGE = [
  'usage: harness check <scope|branch> [--current-branch <b>] [--expected-branch <b>] ' +
    '[--staged-files <list>] [--branch-md <path>] [--profile sentropic|stub] [--json]',
  '       harness brainstorm [<topic>] [--peers <n>] [--ladder study|vol|evol] [--json]',
  '       harness test [<scope>] [--category unit|integration|e2e] [--watch] [--json]',
  '       harness debug [<symptom>] [--json]',
  '       harness review [<target>] [--consensus] [--peers <n>] [--json]',
  '       harness plan [<spec>] [--lots <n>] [--json]',
  '       harness branch <init|close> [<slug>] [--json]',
  '       harness skills install --host <claude|codex|gemini> [--json]',
].join('\n');

/** The `check scope|branch` static checks (C2/C1) — emit a neutral VerificationRun. */
function handleCheck(
  positionals: string[],
  flags: Record<string, FlagValue>,
  out: (s: string) => void,
): number {
  const sub = positionals[1];
  if (sub !== 'scope' && sub !== 'branch') {
    out(USAGE);
    return 2;
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

/**
 * Pure, arg-based CLI driver — reads everything from `argv`, writes via `out`, returns an exit code.
 * No internal git calls (the caller supplies branch + staged files), no `process.exit`, no fs writes.
 * Advisory (D5 Layer A): a failing check returns 0; only a usage error returns non-zero.
 *
 * Verb families: `check` (C1/C2 → VerificationRun); method/recorder verbs (brainstorm/test/debug/
 * review/plan/branch/skills → WorkEvent + skill pointer, see `method-verbs.ts`).
 */
export function runHarnessCli(argv: string[], out: (s: string) => void): number {
  const { positionals, flags } = parseFlags(argv);
  const command = positionals[0];

  if (command === 'check') {
    return handleCheck(positionals, flags, out);
  }

  const methodCode = handleMethodVerb(positionals, flags, out);
  if (methodCode !== null) return methodCode;

  out(USAGE);
  return command === undefined ? 0 : 2;
}
