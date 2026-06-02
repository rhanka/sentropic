import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
    InvalidAppNameError,
    InvalidTargetDirError,
    validateAppName,
    validateTargetDir,
} from '../src/commands/validate.js';
import { InvalidOptionError, parseInitOptions } from '../src/commands/options.js';
import { TargetNotEmptyError, runInit, type InitDeps } from '../src/commands/init.js';
import type { InitOptions } from '../src/commands/options.js';
import { TINY_FIXTURE_MANIFEST } from './fixtures/tiny-manifest.js';

describe('validateAppName — invalid names', () => {
    it.each([
        ['empty', ''],
        ['whitespace', '   '],
        ['leading space', ' demo'],
        ['trailing space', 'demo '],
        ['uppercase', 'Demo'],
        ['underscore', 'my_app'],
        ['leading hyphen', '-demo'],
        ['trailing hyphen', 'demo-'],
        ['double hyphen', 'de--mo'],
        ['dot', 'demo.app'],
        ['slash', 'a/b'],
        ['backslash', 'a\\b'],
        ['parent traversal', '..'],
        ['embedded traversal', 'a..b'],
    ])('rejects %s', (_label, name) => {
        expect(() => validateAppName(name)).toThrow(InvalidAppNameError);
    });

    it.each(['node_modules', 'test', 'con', 'nul', 'package'])('rejects reserved name %s', (name) => {
        expect(() => validateAppName(name)).toThrow(InvalidAppNameError);
    });

    it.each(['demo', 'my-app', 'a', 'app123', 'a-b-c'])('accepts valid slug %s', (name) => {
        expect(validateAppName(name)).toBe(name);
    });

    it('rejects a name longer than 64 chars', () => {
        expect(() => validateAppName('a'.repeat(65))).toThrow(InvalidAppNameError);
    });
});

describe('validateTargetDir — traversal rejection', () => {
    it.each(['../escape', 'a/../b', '..', 'nested/../../up'])('rejects traversal dir %s', (dir) => {
        expect(() => validateTargetDir(dir)).toThrow(InvalidTargetDirError);
    });

    it('allows a plain relative dir', () => {
        expect(validateTargetDir('./demo')).toBe('./demo');
    });

    it('allows an absolute dir (not a traversal)', () => {
        expect(validateTargetDir('/tmp/demo')).toBe('/tmp/demo');
    });
});

describe('parseInitOptions — invalid flags', () => {
    it('rejects an unknown flag', () => {
        expect(() => parseInitOptions(['demo', '--nope'])).toThrow(InvalidOptionError);
    });

    it('requires a value for a value-flag', () => {
        expect(() => parseInitOptions(['demo', '--dir'])).toThrow(InvalidOptionError);
    });

    it('rejects an invalid --github-visibility', () => {
        expect(() => parseInitOptions(['demo', '--github-visibility', 'secret'])).toThrow(
            InvalidOptionError,
        );
    });

    it('requires --github-owner when --github is set (never inferred — BR42a-G)', () => {
        expect(() => parseInitOptions(['demo', '--github'])).toThrow(/--github-owner/);
    });

    it('requires an app name positional', () => {
        expect(() => parseInitOptions(['--provider', 'stub'])).toThrow(InvalidAppNameError);
    });
});

describe('runInit — runtime negatives', () => {
    let dir: string;

    function options(overrides: Partial<InitOptions> = {}): InitOptions {
        return {
            name: 'demo',
            dir: join(dir, 'demo'),
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
        dir = await mkdtemp(join(tmpdir(), 'build-cli-negative-'));
    });

    afterEach(async () => {
        await rm(dir, { recursive: true, force: true });
    });

    it('rejects a raw path-traversal --dir before writing anything', async () => {
        // The CLI receives the raw, un-normalised user string (path.join would collapse
        // the `..` away, so we pass the literal traversal value here).
        await expect(runInit(options({ dir: '../escape' }), deps())).rejects.toBeInstanceOf(
            InvalidTargetDirError,
        );
    });

    it('rejects an invalid app name before writing anything', async () => {
        await expect(runInit(options({ name: 'Bad_Name' }), deps())).rejects.toBeInstanceOf(
            InvalidAppNameError,
        );
    });

    it('refuses an existing non-empty dir without --force', async () => {
        const target = join(dir, 'demo');
        await mkdir(target, { recursive: true });
        await writeFile(join(target, 'existing.txt'), 'x\n');
        await expect(runInit(options(), deps())).rejects.toBeInstanceOf(TargetNotEmptyError);
    });

    it('refuses an existing git repo dir without --force (treated as non-empty)', async () => {
        const target = join(dir, 'demo');
        await mkdir(join(target, '.git'), { recursive: true });
        await expect(runInit(options(), deps())).rejects.toBeInstanceOf(TargetNotEmptyError);
    });
});
