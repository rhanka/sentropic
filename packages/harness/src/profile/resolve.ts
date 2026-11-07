import { existsSync, lstatSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { sentropicProfile } from './sentropic.js';
import { stubProfile } from './stub.js';
import type { HarnessProfile } from './profile.js';
import { parseHarnessProfile, ProfileValidationError } from './document.js';

/** Works for ordinary repositories and worktrees (.git may be a file), without spawning git. */
export function findRepoRoot(cwd = process.cwd()): string {
  const start = resolve(cwd);
  for (let directory = start; ; directory = dirname(directory)) {
    if (existsSync(join(directory, '.git'))) return directory;
    if (dirname(directory) === directory) return start;
  }
}

export function loadProfileFile(path: string): HarnessProfile {
  let text: string;
  try { text = readFileSync(path, 'utf8'); }
  catch { throw new ProfileValidationError('PROFILE_READ', path, 'cannot read profile file'); }
  let document: unknown;
  try { document = JSON.parse(text); }
  catch { throw new ProfileValidationError('PROFILE_JSON', path, 'invalid JSON'); }
  return parseHarnessProfile(document);
}

function flagValue(value: unknown, flag: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new ProfileValidationError('INVALID_PROFILE', flag, 'expected a nonempty value');
  }
  return value;
}

/** Resolve explicit built-in > explicit file > root discovery > sentropic. */
export function resolveProfile(flags: Record<string, unknown>, cwd = process.cwd()): HarnessProfile {
  if (flags.profile !== undefined) {
    const name = flagValue(flags.profile, '--profile');
    if (name === 'sentropic') return sentropicProfile;
    if (name === 'stub') return stubProfile;
    throw new ProfileValidationError('UNKNOWN_PROFILE', '--profile', `unknown built-in profile: ${name}`);
  }
  if (flags['profile-file'] !== undefined) {
    return loadProfileFile(resolve(cwd, flagValue(flags['profile-file'], '--profile-file')));
  }
  const path = join(findRepoRoot(cwd), 'harness.profile.json');
  try { lstatSync(path); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return sentropicProfile;
    throw new ProfileValidationError('PROFILE_READ', path, 'cannot inspect profile file');
  }
  return loadProfileFile(path);
}
