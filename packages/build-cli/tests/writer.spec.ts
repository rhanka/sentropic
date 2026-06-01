import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm, writeFile, mkdir, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
    PathEscapeError,
    TargetExistsError,
    resolvePlan,
    writePlan,
    type ScaffoldManifest,
} from '../src/generator/index.js';

const MANIFEST: ScaffoldManifest = {
    entries: [
        { sourcePath: 'a', outputPath: 'pkg/a.txt', content: 'alpha\n' },
        { sourcePath: 'b', outputPath: 'pkg/nested/b.txt', content: 'beta\n' },
    ],
};

let dir: string;

beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'build-cli-writer-'));
});

afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
});

describe('writePlan', () => {
    it('materialises every planned file under the target dir', async () => {
        const plan = resolvePlan(MANIFEST, { tokens: {} });
        const written = await writePlan(plan, { targetDir: dir });
        expect(written).toHaveLength(2);
        expect(await readFile(join(dir, 'pkg/a.txt'), 'utf8')).toBe('alpha\n');
        expect(await readFile(join(dir, 'pkg/nested/b.txt'), 'utf8')).toBe('beta\n');
    });

    it('refuses to overwrite an existing file and leaves it untouched (no-partial-write)', async () => {
        await mkdir(join(dir, 'pkg'), { recursive: true });
        await writeFile(join(dir, 'pkg/a.txt'), 'ORIGINAL\n');
        const plan = resolvePlan(MANIFEST, { tokens: {} });

        await expect(writePlan(plan, { targetDir: dir })).rejects.toBeInstanceOf(TargetExistsError);
        // The pre-existing file is unchanged and the clean sibling was never written.
        expect(await readFile(join(dir, 'pkg/a.txt'), 'utf8')).toBe('ORIGINAL\n');
        expect(existsSync(join(dir, 'pkg/nested/b.txt'))).toBe(false);
    });

    it('overwrites scaffold-owned files only when overwrite is set', async () => {
        await mkdir(join(dir, 'pkg'), { recursive: true });
        await writeFile(join(dir, 'pkg/a.txt'), 'ORIGINAL\n');
        const plan = resolvePlan(MANIFEST, { tokens: {} });
        await writePlan(plan, { targetDir: dir, overwrite: true });
        expect(await readFile(join(dir, 'pkg/a.txt'), 'utf8')).toBe('alpha\n');
    });

    it('aborts before any write when a path escapes the target (..)', async () => {
        const plan = resolvePlan(
            { entries: [{ sourcePath: 's', outputPath: '../escape.txt', content: 'x' }] },
            { tokens: {} },
        );
        await expect(writePlan(plan, { targetDir: dir })).rejects.toBeInstanceOf(PathEscapeError);
        expect(await readdir(dir)).toEqual([]);
    });

    it('aborts before any write when a path is absolute', async () => {
        const plan = resolvePlan(
            { entries: [{ sourcePath: 's', outputPath: '/etc/passwd', content: 'x' }] },
            { tokens: {} },
        );
        await expect(writePlan(plan, { targetDir: dir })).rejects.toBeInstanceOf(PathEscapeError);
        expect(await readdir(dir)).toEqual([]);
    });
});
