/**
 * `stp app init` flag parsing + validation (SPEC §2.2).
 *
 * Dependency-light: a hand-rolled argv reader over Node built-ins (no CLI framework, per
 * SPEC §4.5). Parsing is pure and side-effect free so it is unit-testable in isolation.
 */

import { InvalidAppNameError } from './validate.js';

/** Providers the generated app may be seeded with (SPEC §2.2). */
export const VALID_PROVIDERS: readonly string[] = [
    'stub',
    'openai',
    'gemini',
    'anthropic',
    'mistral',
    'cohere',
] as const;

/** Real llm-mesh provider ids (everything except the template-owned `stub`). */
export const LLM_MESH_PROVIDERS: readonly string[] = VALID_PROVIDERS.filter((p) => p !== 'stub');

/** GitHub repository visibility. */
export type GithubVisibility = 'private' | 'public';

/** Fully-resolved, validated options for an `init` run. */
export interface InitOptions {
    readonly name: string;
    /** Target directory (defaults to `./<name>`). */
    readonly dir: string;
    /** Seed provider id (`stub` or a real llm-mesh id). */
    readonly provider: string;
    /** Initialise a local git repo + first commit. */
    readonly git: boolean;
    /** Create + push a GitHub repo via `gh`. */
    readonly github: boolean;
    /** Visibility for the created GitHub repo. */
    readonly githubVisibility: GithubVisibility;
    /** Owner/org for the created repo (required when `github` is on; never inferred). */
    readonly githubOwner?: string;
    /** Emit the minimal local h2a descriptor (non-protocol). */
    readonly h2aRegister: boolean;
    /** Non-interactive mode: missing required input fails instead of prompting. */
    readonly yes: boolean;
    /** Overwrite scaffold-owned files in a non-empty dir. */
    readonly force: boolean;
    /** Compute + print the plan + gh command; write nothing, create no repo. */
    readonly dryRun: boolean;
}

/** Error thrown when a flag value is invalid or a required flag is missing. */
export class InvalidOptionError extends Error {
    readonly flag: string;
    constructor(flag: string, reason: string) {
        super(`Invalid option ${flag}: ${reason}`);
        this.name = 'InvalidOptionError';
        this.flag = flag;
    }
}

interface RawFlags {
    dir?: string;
    provider?: string;
    git: boolean;
    github: boolean;
    githubVisibility?: string;
    githubOwner?: string;
    h2aRegister: boolean;
    yes: boolean;
    force: boolean;
    dryRun: boolean;
}

/** Read the inline value of `--flag value` or `--flag=value`. */
function takeValue(argv: readonly string[], index: number, arg: string): { value: string; next: number } {
    const eq = arg.indexOf('=');
    if (eq !== -1) {
        return { value: arg.slice(eq + 1), next: index };
    }
    const value = argv[index + 1];
    if (value === undefined || value.startsWith('--')) {
        throw new InvalidOptionError(arg.split('=')[0], 'expects a value');
    }
    return { value, next: index + 1 };
}

/**
 * Parse + validate `init <name> [flags]` argv (everything after the `init` verb).
 *
 * The first non-flag positional is the app name. Name slug validation is deferred to the
 * caller (`validateAppName`) so this stays a pure flag parser, but a missing name is an
 * error here.
 *
 * @throws {InvalidOptionError} on unknown flags, missing values, invalid enum values, or
 *   missing required combinations (e.g. `--github` without `--github-owner`).
 * @throws {InvalidAppNameError} when no positional name is supplied.
 */
export function parseInitOptions(argv: readonly string[]): InitOptions {
    const flags: RawFlags = {
        git: true,
        github: false,
        h2aRegister: false,
        yes: false,
        force: false,
        dryRun: false,
    };
    let name: string | undefined;

    for (let i = 0; i < argv.length; i += 1) {
        const arg = argv[i];
        const bare = arg.split('=')[0];
        switch (bare) {
            case '--dir': {
                const { value, next } = takeValue(argv, i, arg);
                flags.dir = value;
                i = next;
                break;
            }
            case '--provider': {
                const { value, next } = takeValue(argv, i, arg);
                flags.provider = value;
                i = next;
                break;
            }
            case '--git':
                flags.git = true;
                break;
            case '--no-git':
                flags.git = false;
                break;
            case '--github':
                flags.github = true;
                break;
            case '--no-github':
                flags.github = false;
                break;
            case '--github-visibility': {
                const { value, next } = takeValue(argv, i, arg);
                flags.githubVisibility = value;
                i = next;
                break;
            }
            case '--github-owner': {
                const { value, next } = takeValue(argv, i, arg);
                flags.githubOwner = value;
                i = next;
                break;
            }
            case '--h2a-register':
                flags.h2aRegister = true;
                break;
            case '--yes':
            case '-y':
                flags.yes = true;
                break;
            case '--force':
                flags.force = true;
                break;
            case '--dry-run':
                flags.dryRun = true;
                break;
            default:
                if (arg.startsWith('-')) {
                    throw new InvalidOptionError(bare, 'unknown flag');
                }
                if (name !== undefined) {
                    throw new InvalidOptionError(arg, 'unexpected extra positional argument');
                }
                name = arg;
        }
    }

    if (name === undefined) {
        throw new InvalidAppNameError('', 'an app name positional is required');
    }

    const provider = flags.provider ?? 'stub';
    if (!VALID_PROVIDERS.includes(provider)) {
        throw new InvalidOptionError(
            '--provider',
            `must be one of ${VALID_PROVIDERS.join('|')} (got "${provider}")`,
        );
    }

    let visibility: GithubVisibility = 'private';
    if (flags.githubVisibility !== undefined) {
        if (flags.githubVisibility !== 'private' && flags.githubVisibility !== 'public') {
            throw new InvalidOptionError('--github-visibility', 'must be "private" or "public"');
        }
        visibility = flags.githubVisibility;
    }

    if (flags.github && (flags.githubOwner === undefined || flags.githubOwner.trim().length === 0)) {
        // BR42a-G: owner is explicit, never inferred.
        throw new InvalidOptionError('--github-owner', 'is required when --github is set (never inferred)');
    }

    return {
        name,
        dir: flags.dir ?? `./${name}`,
        provider,
        git: flags.git,
        github: flags.github,
        githubVisibility: visibility,
        githubOwner: flags.githubOwner,
        h2aRegister: flags.h2aRegister,
        yes: flags.yes,
        force: flags.force,
        dryRun: flags.dryRun,
    };
}
