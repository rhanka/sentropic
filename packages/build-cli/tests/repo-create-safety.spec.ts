import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
    ExistingRemoteError,
    RepoCollisionError,
    runInit,
    type InitDeps,
} from '../src/commands/init.js';
import { nodeProcessRunner } from '../src/commands/process.js';
import type { InitOptions } from '../src/commands/options.js';
import { TINY_FIXTURE_MANIFEST } from './fixtures/tiny-manifest.js';

/**
 * Repo-creation safety (SPEC §6.1 #4): stub `gh` AND `git` on a temp PATH + temp HOME and
 * run BOTH the `--github --dry-run` path and the REAL `--github` path against the stubs.
 * Assert ZERO side effects: no remote creation, no writes outside the temp workspace, the
 * EXACT `gh repo create` string, collision refusal, and existing-remote refusal.
 *
 * The stubs record every invocation to a log file so we can verify exactly what ran.
 */

let workdir: string; // temp working dir (contains target dir + stub bin + home + log)
let stubBin: string;
let logFile: string;
let target: string;

/** Write a shell stub that appends its argv to the log file and exits with `code`. */
async function writeStub(name: string, code: number, stdout = ''): Promise<void> {
    const path = join(stubBin, name);
    const script =
        '#!/bin/sh\n' +
        `printf '%s\\n' "${name} $*" >> "${logFile}"\n` +
        (stdout ? `printf '%s' '${stdout}'\n` : '') +
        `exit ${code}\n`;
    await writeFile(path, script);
    await chmod(path, 0o755);
}

/** A runner that runs the REAL spawn but with PATH=stubBin:... and HOME=temp. */
function stubbedRunner(): InitDeps['runner'] {
    const env = {
        ...process.env,
        PATH: `${stubBin}:${process.env.PATH ?? ''}`,
        HOME: join(workdir, 'home'),
    } as Record<string, string>;
    return {
        run: (cmd) => nodeProcessRunner.run({ ...cmd, env }),
    };
}

function options(overrides: Partial<InitOptions> = {}): InitOptions {
    return {
        name: 'demo',
        dir: target,
        provider: 'stub',
        git: true,
        github: true,
        githubVisibility: 'private',
        githubOwner: 'acme',
        h2aRegister: false,
        yes: true,
        force: false,
        dryRun: false,
        ...overrides,
    };
}

function deps(): InitDeps {
    return {
        manifest: TINY_FIXTURE_MANIFEST,
        log: () => {},
        ports: { api: 9211, ui: 5411, maildev: 1311 },
        runner: stubbedRunner(),
    };
}

async function readLog(): Promise<string[]> {
    if (!existsSync(logFile)) {
        return [];
    }
    return (await readFile(logFile, 'utf8')).split('\n').filter((l) => l.length > 0);
}

beforeEach(async () => {
    workdir = await mkdtemp(join(tmpdir(), 'build-cli-ghsafety-'));
    stubBin = join(workdir, 'bin');
    logFile = join(workdir, 'invocations.log');
    target = join(workdir, 'demo');
    await mkdir(stubBin, { recursive: true });
    await mkdir(join(workdir, 'home'), { recursive: true });
});

afterEach(async () => {
    await rm(workdir, { recursive: true, force: true });
});

describe('repo-create safety — --github --dry-run', () => {
    it('prints the EXACT gh repo create string and invokes NEITHER gh NOR git', async () => {
        // Even if stubs existed, dry-run must not call them.
        await writeStub('gh', 0);
        await writeStub('git', 0);
        const result = await runInit(options({ dryRun: true }), deps());

        expect(result.ghCommand).toBe(`gh repo create acme/demo --private --source ${target} --push`);
        expect(result.written).toEqual([]);
        expect(existsSync(target)).toBe(false);
        expect(await readLog()).toEqual([]);
    });
});

describe('repo-create safety — real --github path against stubs', () => {
    it('creates no real repo, writes only inside the temp workspace, and runs the exact gh create', async () => {
        await writeStub('gh', 0); // gh repo view → 0 would mean collision, so:
        // Override: gh must return non-zero for `repo view` (absent) but 0 for `repo create`.
        // The simplest correct stub branches on the first two args.
        await writeStub('git', 0);
        await writeGhBranchingStub();

        const result = await runInit(options(), deps());

        // Wrote only inside the temp target dir.
        expect(result.written.every((p) => p.startsWith(target))).toBe(true);
        const log = await readLog();
        // The exact create command was invoked.
        expect(log).toContain('gh repo create acme/demo --private --source ' + target + ' --push');
        // A collision pre-check ran first.
        expect(log.some((l) => l.startsWith('gh repo view acme/demo'))).toBe(true);
    });

    it('refuses on repo-name collision (gh repo view succeeds) without creating', async () => {
        await writeStub('git', 0);
        await writeStub('gh', 0); // every gh call (incl. `repo view`) returns 0 → collision.

        await expect(runInit(options(), deps())).rejects.toBeInstanceOf(RepoCollisionError);
        const log = await readLog();
        // It probed for collision but NEVER reached create.
        expect(log.some((l) => l.startsWith('gh repo view'))).toBe(true);
        expect(log.some((l) => l.startsWith('gh repo create'))).toBe(false);
    });

    it('refuses to mutate an existing remote and never creates a repo', async () => {
        // Pre-seed a .git dir + a git stub that reports an existing remote.
        await mkdir(join(target, '.git'), { recursive: true });
        await writeStub('git', 0, 'origin\n'); // `git remote` prints a remote.
        await writeGhBranchingStub();

        await expect(runInit(options(), deps())).rejects.toBeInstanceOf(ExistingRemoteError);
        const log = await readLog();
        expect(log.some((l) => l.startsWith('git remote'))).toBe(true);
        expect(log.some((l) => l.startsWith('gh repo create'))).toBe(false);
    });
});

/** A gh stub that returns non-zero for `repo view` (absent) and 0 for everything else. */
async function writeGhBranchingStub(): Promise<void> {
    const path = join(stubBin, 'gh');
    const script =
        '#!/bin/sh\n' +
        `printf '%s\\n' "gh $*" >> "${logFile}"\n` +
        'if [ "$1" = "repo" ] && [ "$2" = "view" ]; then exit 1; fi\n' +
        'exit 0\n';
    await writeFile(path, script);
    await chmod(path, 0o755);
}
