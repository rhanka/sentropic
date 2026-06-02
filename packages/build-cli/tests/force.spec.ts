import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { TargetNotEmptyError, runInit, type InitDeps } from '../src/commands/init.js';
import type { InitOptions } from '../src/commands/options.js';
import { TINY_FIXTURE_MANIFEST } from './fixtures/tiny-manifest.js';

let dir: string;
let target: string;

function options(overrides: Partial<InitOptions> = {}): InitOptions {
    return {
        name: 'demo',
        dir: target,
        provider: 'stub',
        git: false,
        github: false,
        githubVisibility: 'private',
        h2aRegister: false,
        yes: true,
        force: false,
        dryRun: false,
        ...overrides,
    };
}

function deps(): InitDeps {
    return { manifest: TINY_FIXTURE_MANIFEST, log: () => {}, ports: { api: 9211, ui: 5411, maildev: 1311 } };
}

beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'build-cli-force-'));
    target = join(dir, 'demo');
    await mkdir(target, { recursive: true });
});

afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
});

describe('runInit — --force semantics', () => {
    it('refuses with a list of conflicting entries when the dir is non-empty and --force is absent', async () => {
        await writeFile(join(target, 'README.md'), 'PRE-EXISTING\n');
        await writeFile(join(target, 'unrelated.txt'), 'keep me\n');

        let caught: unknown;
        try {
            await runInit(options(), deps());
        } catch (err) {
            caught = err;
        }
        expect(caught).toBeInstanceOf(TargetNotEmptyError);
        const e = caught as TargetNotEmptyError;
        expect(e.entries).toEqual(['README.md', 'unrelated.txt']);
        // The pre-existing files are untouched (no partial write).
        expect(await readFile(join(target, 'README.md'), 'utf8')).toBe('PRE-EXISTING\n');
    });

    it('overwrites scaffold-owned files only and leaves unrelated files intact with --force', async () => {
        // A scaffold-owned file (README.md is in the manifest) + an unrelated file.
        await writeFile(join(target, 'README.md'), 'PRE-EXISTING\n');
        await writeFile(join(target, 'unrelated.txt'), 'keep me\n');

        await runInit(options({ force: true }), deps());

        // Scaffold-owned README.md was overwritten with the rendered content.
        const readme = await readFile(join(target, 'README.md'), 'utf8');
        expect(readme).toContain('# demo');
        // The unrelated file was NOT deleted (never blanket-delete the directory).
        expect(await readFile(join(target, 'unrelated.txt'), 'utf8')).toBe('keep me\n');
    });

    it('scaffolds normally into an empty existing dir without --force', async () => {
        const result = await runInit(options(), deps());
        expect(result.written.length).toBeGreaterThan(0);
        expect(await readFile(join(target, 'package.json'), 'utf8')).toContain('"name": "demo"');
    });
});
