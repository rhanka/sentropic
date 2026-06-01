/**
 * Thin arg dispatcher for the `stp app` verbs.
 *
 * `runAppCli(argv)` is the importable entry the umbrella `@sentropic/cli` (lot a2) wires
 * as `stp app`. It dispatches `init` / `doctor` / `--version` / `--help` and returns a
 * process exit code (never calls `process.exit` itself, so it is unit-testable). All
 * side-effecting dependencies flow through {@link AppCliDeps}.
 *
 * The real `templates/chat-app/**` scaffold manifest is supplied by a later lot; until it
 * lands, an `init` call without an injected `manifestProvider` exits non-zero with a
 * clear, honest message rather than scaffolding an empty app.
 */

import type { ScaffoldManifest } from './templating/types.js';
import { runInit, type InitDeps } from './commands/init.js';
import { parseInitOptions } from './commands/options.js';
import { formatDoctorReport, runDoctor, type DoctorDeps } from './commands/doctor.js';
import { validateAppName, validateTargetDir } from './commands/validate.js';

/** Package version surfaced by `--version` (kept in sync with package.json on bump). */
export const BUILD_CLI_VERSION = '0.1.0';

const HELP = `stp app — scaffold a runnable @sentropic chat application

Usage:
  stp app init <name> [flags]   Scaffold (+ optional git/GitHub/h2a) a chat app
  stp app doctor [flags]        Non-mutating pre-flight checks
  stp app --version             Print the build-cli version
  stp app --help                Show this help

init flags:
  --dir <path>                  Target directory (default ./<name>)
  --provider stub|openai|gemini|anthropic|mistral|cohere   Seed provider (default stub)
  --git / --no-git              Init a local git repo + first commit (default --git)
  --github / --no-github        Create + push a GitHub repo (default --no-github)
  --github-visibility private|public                       (default private)
  --github-owner <org>          Owner/org (required with --github; never inferred)
  --h2a-register                Emit a minimal local non-protocol h2a descriptor
  --yes, -y                     Non-interactive (fail on missing required input)
  --force                       Overwrite scaffold-owned files in a non-empty dir
  --dry-run                     Print the plan + exact gh command; write nothing
`;

/** Injectable dependencies for the dispatcher. */
export interface AppCliDeps {
    /** Output sink (default: console.log). */
    readonly log?: (line: string) => void;
    /** Error sink (default: console.error). */
    readonly error?: (line: string) => void;
    /** Supplies the scaffold manifest for `init` (the real subtree lands a later lot). */
    readonly manifestProvider?: () => ScaffoldManifest;
    /** Extra init deps (runner/ports) forwarded to {@link runInit}. */
    readonly initDeps?: Omit<InitDeps, 'manifest' | 'log'>;
    /** Doctor deps forwarded to {@link runDoctor}. */
    readonly doctorDeps?: DoctorDeps;
}

/**
 * Dispatch `stp app <argv>` and resolve to a process exit code.
 *
 * @returns `0` on success, non-zero on any failure (validation, missing input, runtime).
 */
export async function runAppCli(argv: readonly string[], deps: AppCliDeps = {}): Promise<number> {
    const log = deps.log ?? ((line: string) => console.log(line));
    const error = deps.error ?? ((line: string) => console.error(line));

    const [verb, ...rest] = argv;

    if (verb === undefined || verb === '--help' || verb === '-h') {
        log(HELP);
        return 0;
    }
    if (verb === '--version' || verb === '-v') {
        log(BUILD_CLI_VERSION);
        return 0;
    }

    if (verb === 'doctor') {
        const requireGithub = rest.includes('--github');
        const report = await runDoctor({ ...deps.doctorDeps, requireGithub });
        log(formatDoctorReport(report));
        return report.ok ? 0 : 1;
    }

    if (verb === 'init') {
        if (rest.includes('--help') || rest.includes('-h')) {
            log(HELP);
            return 0;
        }
        try {
            const options = parseInitOptions(rest);
            validateAppName(options.name);
            validateTargetDir(options.dir);

            if (!deps.manifestProvider) {
                error(
                    'init: no scaffold template available yet (the chat-app template subtree ' +
                        'lands in a later lot). Provide a manifest provider to scaffold.',
                );
                return 1;
            }
            await runInit(options, {
                manifest: deps.manifestProvider(),
                log,
                ...deps.initDeps,
            });
            return 0;
        } catch (err) {
            error(`init: ${(err as Error).message}`);
            return 1;
        }
    }

    error(`Unknown command: ${verb}. Run \`stp app --help\`.`);
    return 1;
}
