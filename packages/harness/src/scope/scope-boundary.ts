import type { HarnessProfile } from '../profile/profile.js';

export type PathClass = 'allowed' | 'forbidden' | 'conditional' | 'unknown';

/** The Allowed / Forbidden / Conditional path globs declared by a BRANCH.md. */
export interface ScopeBoundary {
  allowed: string[];
  forbidden: string[];
  conditional: string[];
}

/** Translate a path glob into an anchored RegExp. `**` spans `/`; `*` stays within a segment. */
export function globToRegExp(glob: string): RegExp {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*') {
      if (glob[i + 1] === '*') {
        re += '.*';
        i++;
      } else {
        re += '[^/]*';
      }
    } else if ('\\^$+?.()|[]{}/'.includes(c)) {
      re += '\\' + c;
    } else {
      re += c;
    }
  }
  return new RegExp('^' + re + '$');
}

export function matchGlob(glob: string, path: string): boolean {
  return globToRegExp(glob).test(path);
}

/**
 * Classify a repo-relative path against a branch ScopeBoundary + the profile's default
 * forbidden globs (C2 scope-check core).
 *
 * Precedence (first match wins):
 *   explicit allowed > explicit forbidden > explicit conditional > profile default-forbidden > unknown
 *
 * `allowed` wins over `forbidden` so an explicitly-granted subtree (e.g. `packages/harness/**`)
 * is `allowed` even when a broader `packages/**` is forbidden — the Allowed list is the granted
 * implementation scope. `conditional` is checked before profile defaults so a Conditional listing
 * (e.g. `Makefile` with an exception) overrides the profile's default-forbidden classification.
 */
export function classifyPath(
  path: string,
  boundary: ScopeBoundary,
  profile: HarnessProfile,
): PathClass {
  if (boundary.allowed.some((g) => matchGlob(g, path))) return 'allowed';
  if (boundary.forbidden.some((g) => matchGlob(g, path))) return 'forbidden';
  if (boundary.conditional.some((g) => matchGlob(g, path))) return 'conditional';
  if (profile.forbiddenPathDefaults.some((g) => matchGlob(g, path))) return 'forbidden';
  return 'unknown';
}
