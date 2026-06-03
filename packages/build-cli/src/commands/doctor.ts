/**
 * `stp app doctor` — non-mutating pre-flight checks (SPEC §2.1, §6.1 #3).
 *
 * Verifies the host can run a clean `init` + the generated app's `make dev`:
 *   - Docker present
 *   - `make` present
 *   - `gh auth status` OK (only required when GitHub creation is intended)
 *   - Node engine satisfies the minimum
 *   - the generated-app default ports are free (BR42a-Q9 port-conflict detection)
 *
 * Every external probe is INJECTED (binary lookup, `gh` runner, port probe, node
 * version) so the suite can drive each branch deterministically without touching the
 * host. The default wiring uses Node built-ins only.
 */

import { createServer } from 'node:net';
import { nodeProcessRunner, type ProcessRunner } from './process.js';

/** Minimum Node major version the generated app + tooling assume. */
export const MIN_NODE_MAJOR = 20;

/** Default generated-app ports that must be free (never the monorepo 8787/5173/1080). */
export const DEFAULT_GENERATED_APP_PORTS: readonly number[] = [9211, 5411];

/** A single check outcome. */
export interface DoctorCheck {
    /** Stable check id (e.g. `docker`, `make`, `gh-auth`, `node-engine`, `port:9211`). */
    readonly id: string;
    /** Human-readable label. */
    readonly label: string;
    /** Whether the check passed. */
    readonly ok: boolean;
    /** Actionable detail (especially on failure). */
    readonly detail: string;
}

/** Aggregate doctor result. */
export interface DoctorReport {
    readonly checks: readonly DoctorCheck[];
    /** True when every check passed. */
    readonly ok: boolean;
}

/** Injectable probes (all default to real Node-built-in implementations). */
export interface DoctorDeps {
    /** Resolve whether a binary is on PATH (default: shells out to the OS). */
    readonly hasBinary?: (name: string) => Promise<boolean>;
    /** Process runner for `gh auth status` (default: real spawn). */
    readonly runner?: ProcessRunner;
    /** Report whether a TCP port is free (default: tries to bind on localhost). */
    readonly isPortFree?: (port: number) => Promise<boolean>;
    /** Node version string (default: `process.version`). */
    readonly nodeVersion?: string;
    /** Whether GitHub repo creation is intended (gates the `gh auth` check severity). */
    readonly requireGithub?: boolean;
    /** Generated-app ports to check for conflicts. */
    readonly ports?: readonly number[];
}

/** Default binary lookup using `command -v` via the process runner. */
async function defaultHasBinary(runner: ProcessRunner, name: string): Promise<boolean> {
    try {
        const result = await runner.run({ file: 'sh', args: ['-c', `command -v ${name}`] });
        return result.code === 0 && result.stdout.trim().length > 0;
    } catch {
        return false;
    }
}

/** Default port probe: bind+release on 127.0.0.1; free iff bind succeeds. */
function defaultIsPortFree(port: number): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
        const server = createServer();
        server.once('error', () => resolve(false));
        server.once('listening', () => {
            server.close(() => resolve(true));
        });
        server.listen(port, '127.0.0.1');
    });
}

/** Parse a Node version string (`v20.11.0` or `20.11.0`) to its major number. */
function nodeMajor(version: string): number {
    const match = /v?(\d+)\./.exec(version);
    return match ? Number(match[1]) : 0;
}

/**
 * Run the pre-flight checks.
 *
 * Pure aside from the injected probes. Never mutates the filesystem or any remote.
 */
export async function runDoctor(deps: DoctorDeps = {}): Promise<DoctorReport> {
    const runner = deps.runner ?? nodeProcessRunner;
    const hasBinary = deps.hasBinary ?? ((name: string) => defaultHasBinary(runner, name));
    const isPortFree = deps.isPortFree ?? defaultIsPortFree;
    const nodeVersion = deps.nodeVersion ?? process.version;
    const ports = deps.ports ?? DEFAULT_GENERATED_APP_PORTS;

    const checks: DoctorCheck[] = [];

    const dockerOk = await hasBinary('docker');
    checks.push({
        id: 'docker',
        label: 'Docker available',
        ok: dockerOk,
        detail: dockerOk ? 'docker found on PATH' : 'docker not found on PATH — install Docker',
    });

    const makeOk = await hasBinary('make');
    checks.push({
        id: 'make',
        label: 'make available',
        ok: makeOk,
        detail: makeOk ? 'make found on PATH' : 'make not found on PATH — install make',
    });

    const ghPresent = await hasBinary('gh');
    if (deps.requireGithub) {
        let ghAuthOk = false;
        let ghDetail: string;
        if (!ghPresent) {
            ghDetail = 'gh not found on PATH — install GitHub CLI for --github';
        } else {
            const result = await runner.run({ file: 'gh', args: ['auth', 'status'] });
            ghAuthOk = result.code === 0;
            ghDetail = ghAuthOk
                ? 'gh authenticated'
                : 'gh present but not authenticated — run `gh auth login`';
        }
        checks.push({ id: 'gh-auth', label: 'GitHub CLI authenticated', ok: ghAuthOk, detail: ghDetail });
    } else {
        checks.push({
            id: 'gh-auth',
            label: 'GitHub CLI authenticated',
            ok: true,
            detail: ghPresent
                ? 'gh present (auth only required with --github)'
                : 'gh absent (only required with --github)',
        });
    }

    const major = nodeMajor(nodeVersion);
    const nodeOk = major >= MIN_NODE_MAJOR;
    checks.push({
        id: 'node-engine',
        label: `Node >= ${MIN_NODE_MAJOR}`,
        ok: nodeOk,
        detail: nodeOk
            ? `Node ${nodeVersion} satisfies >= ${MIN_NODE_MAJOR}`
            : `Node ${nodeVersion} is below the required major ${MIN_NODE_MAJOR}`,
    });

    for (const port of ports) {
        const free = await isPortFree(port);
        checks.push({
            id: `port:${port}`,
            label: `Generated-app port ${port} free`,
            ok: free,
            detail: free
                ? `port ${port} is available`
                : `port ${port} is in use — free it or pick non-conflicting ports`,
        });
    }

    return { checks, ok: checks.every((c) => c.ok) };
}

/** Render a doctor report as human-readable lines (for CLI output). */
export function formatDoctorReport(report: DoctorReport): string {
    const lines = report.checks.map((c) => `${c.ok ? 'OK' : 'FAIL'}\t${c.label} — ${c.detail}`);
    lines.push(report.ok ? 'doctor: all checks passed' : 'doctor: one or more checks failed');
    return lines.join('\n');
}
