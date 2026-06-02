import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { runInit, type InitDeps } from '../src/commands/init.js';
import type { ProcessCommand, ProcessResult, ProcessRunner } from '../src/commands/process.js';
import type { InitOptions } from '../src/commands/options.js';
import { TINY_FIXTURE_MANIFEST } from './fixtures/tiny-manifest.js';

/**
 * `--h2a-register` (BR42a-F): emits a MINIMAL LOCAL non-protocol descriptor only — no
 * network call, no h2a session. Asserts the descriptor is written and that the only
 * processes invoked are local git steps (never any h2a/network shell-out).
 */

let dir: string;

function recordingRunner(): { runner: ProcessRunner; calls: ProcessCommand[] } {
    const calls: ProcessCommand[] = [];
    return {
        calls,
        runner: {
            run: async (cmd): Promise<ProcessResult> => {
                calls.push(cmd);
                return { code: 0, stdout: '', stderr: '' };
            },
        },
    };
}

function options(overrides: Partial<InitOptions> = {}): InitOptions {
    return {
        name: 'demo',
        dir: join(dir, 'demo'),
        provider: 'stub',
        git: false,
        github: false,
        githubVisibility: 'private',
        h2aRegister: true,
        yes: true,
        force: false,
        dryRun: false,
        ...overrides,
    };
}

function deps(extra: Partial<InitDeps> = {}): InitDeps {
    return { manifest: TINY_FIXTURE_MANIFEST, log: () => {}, ports: { api: 9211, ui: 5411, maildev: 1311 }, ...extra };
}

beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'build-cli-h2a-'));
});

afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
});

describe('runInit — --h2a-register', () => {
    it('writes a minimal local non-protocol descriptor and makes no network/h2a call', async () => {
        const { runner, calls } = recordingRunner();
        const result = await runInit(options(), deps({ runner }));

        const descriptorPath = join(result.targetDir, '.sentropic', 'h2a-local.json');
        expect(existsSync(descriptorPath)).toBe(true);
        const parsed = JSON.parse(await readFile(descriptorPath, 'utf8'));
        expect(parsed.kind).toBe('h2a-local-descriptor');
        expect(parsed.protocol).toBe(false);
        expect(parsed.app).toBe('demo');

        // No process invocation at all (git off, github off) — certainly no h2a/network call.
        expect(calls).toEqual([]);
    });

    it('does not write the descriptor on a dry-run', async () => {
        const result = await runInit(options({ dryRun: true }), deps());
        expect(existsSync(join(result.targetDir, '.sentropic', 'h2a-local.json'))).toBe(false);
    });
});
