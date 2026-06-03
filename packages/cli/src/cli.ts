/**
 * Umbrella dispatcher for the `stp` binary (alias `sentropic`).
 *
 * Parses `stp <subcommand> ...` and delegates to a {@link SubcommandRegistry} entry,
 * returning a process exit code (never calls `process.exit` itself, so it is unit-testable
 * and the bin owns the exit). Top-level `--version`/`-v` and `--help`/`-h` are handled here;
 * unknown subcommands fail with a clear, non-zero error that lists the available ones.
 *
 * The dispatcher is plugin-agnostic: it reads only the typed {@link Subcommand} contract.
 * The concrete `app` subcommand (backed by `@sentropic/build-cli`) is wired by the bin, so
 * this module imports no subcommand package (no dependency cycle).
 */

import type { SubcommandRegistry } from './registry.js';

/** CLI version surfaced by `stp --version` (kept in sync with package.json on bump). */
export const CLI_VERSION = '0.1.0';

/** Injectable IO sinks so the dispatcher stays pure and unit-testable. */
export interface CliDeps {
    /** Standard output sink (default: console.log). */
    readonly log?: (line: string) => void;
    /** Error output sink (default: console.error). */
    readonly error?: (line: string) => void;
}

function formatHelp(registry: SubcommandRegistry): string {
    const subcommands = registry.list();
    const lines = [
        'stp — the Sentropic umbrella CLI (alias: sentropic)',
        '',
        'Usage:',
        '  stp <subcommand> [args...]',
        '  stp --version | -v        Print the CLI version and registered subcommand versions',
        '  stp --help | -h           Show this help',
        '',
        'Subcommands:',
    ];
    if (subcommands.length === 0) {
        lines.push('  (none registered)');
    } else {
        const width = Math.max(...subcommands.map((s) => s.name.length));
        for (const s of subcommands) {
            lines.push(`  ${s.name.padEnd(width)}  ${s.summary}`);
        }
    }
    lines.push('', 'Run `stp <subcommand> --help` for subcommand-specific help.');
    return lines.join('\n');
}

function formatVersion(registry: SubcommandRegistry): string {
    const lines = [`stp ${CLI_VERSION}`];
    for (const s of registry.list()) {
        lines.push(`  ${s.name} ${s.version}`);
    }
    return lines.join('\n');
}

function formatUnknown(name: string, registry: SubcommandRegistry): string {
    const available = registry.list().map((s) => s.name);
    const list = available.length > 0 ? available.join(', ') : '(none)';
    return `Unknown subcommand: ${name}. Available subcommands: ${list}. Run \`stp --help\`.`;
}

/**
 * Dispatch `stp <argv>` against the given registry and resolve to a process exit code.
 *
 * @returns `0` on success, non-zero on any failure (unknown subcommand, subcommand error).
 */
export async function runCli(
    argv: readonly string[],
    registry: SubcommandRegistry,
    deps: CliDeps = {},
): Promise<number> {
    const log = deps.log ?? ((line: string) => console.log(line));
    const error = deps.error ?? ((line: string) => console.error(line));

    const [first, ...rest] = argv;

    if (first === undefined || first === '--help' || first === '-h') {
        log(formatHelp(registry));
        return 0;
    }
    if (first === '--version' || first === '-v') {
        log(formatVersion(registry));
        return 0;
    }

    const subcommand = registry.get(first);
    if (subcommand === undefined) {
        error(formatUnknown(first, registry));
        return 1;
    }

    return subcommand.run(rest);
}
