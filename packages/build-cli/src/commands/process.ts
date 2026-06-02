/**
 * Thin, injectable process-runner seam.
 *
 * The command layer never calls `child_process` directly: every shell-out (`git`, `gh`)
 * goes through a {@link ProcessRunner}. Unit tests inject a fake runner to assert the
 * EXACT argv that would run (and to guarantee zero real side effects), while the
 * repo-create-safety suite uses the real {@link nodeProcessRunner} against stub binaries
 * placed on a temp `PATH` (SPEC §6.1 #4).
 *
 * The runner is intentionally minimal (argv + cwd + env), Node-built-in only — no shell
 * string interpolation, so there is no shell-injection surface (args are passed as an
 * array to `spawn`, never concatenated).
 */

import { spawn } from 'node:child_process';

/** A single command invocation: a binary plus an explicit argv array (no shell). */
export interface ProcessCommand {
    /** Executable name or path (resolved against `PATH` by the OS). */
    readonly file: string;
    /** Argument vector; passed verbatim to the process (never shell-expanded). */
    readonly args: readonly string[];
    /** Working directory for the child process. */
    readonly cwd?: string;
    /** Environment for the child process (defaults to the parent env when omitted). */
    readonly env?: Readonly<Record<string, string>>;
}

/** Captured result of a finished process. */
export interface ProcessResult {
    /** Exit code (null when the process was killed by a signal). */
    readonly code: number | null;
    /** Captured standard output. */
    readonly stdout: string;
    /** Captured standard error. */
    readonly stderr: string;
}

/** The injectable runner contract. */
export interface ProcessRunner {
    run(command: ProcessCommand): Promise<ProcessResult>;
}

/**
 * Default runner backed by `child_process.spawn`.
 *
 * Uses an argv array (no `shell: true`), so arguments are never interpreted by a shell.
 */
export const nodeProcessRunner: ProcessRunner = {
    run(command: ProcessCommand): Promise<ProcessResult> {
        return new Promise<ProcessResult>((resolve, reject) => {
            const child = spawn(command.file, [...command.args], {
                cwd: command.cwd,
                env: command.env ? { ...command.env } : process.env,
                stdio: ['ignore', 'pipe', 'pipe'],
            });
            let stdout = '';
            let stderr = '';
            child.stdout?.on('data', (chunk: Buffer) => {
                stdout += chunk.toString('utf8');
            });
            child.stderr?.on('data', (chunk: Buffer) => {
                stderr += chunk.toString('utf8');
            });
            child.on('error', reject);
            child.on('close', (code) => {
                resolve({ code, stdout, stderr });
            });
        });
    },
};

/** Render a command as the exact shell-equivalent string (for `--dry-run` printing). */
export function renderCommand(command: ProcessCommand): string {
    return [command.file, ...command.args].map(shellQuote).join(' ');
}

/** Minimal POSIX-shell quoting: only quote when an argument needs it. */
function shellQuote(arg: string): string {
    if (arg.length > 0 && /^[A-Za-z0-9_\-./:@]+$/.test(arg)) {
        return arg;
    }
    return `'${arg.replace(/'/g, `'\\''`)}'`;
}
