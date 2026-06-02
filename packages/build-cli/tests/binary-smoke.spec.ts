import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import {
    existsSync,
    mkdirSync,
    mkdtempSync,
    readFileSync,
    readdirSync,
    rmSync,
    statSync,
    symlinkSync,
} from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

/**
 * Real-binary smoke for the assembled `stp` CLI (BR-42a1 headline "real flow" gate).
 *
 * Unlike the unit/golden specs (which import `src/**` directly), this spawns the published
 * `stp` binary the way `npm i -g @sentropic/cli` would: `node packages/cli/bin/stp.mjs`,
 * resolving `@sentropic/build-cli` through its package.json `exports` map (which MUST point
 * at `dist/**`, not `src/*.ts`, or Node cannot load it). It is the regression guard for the
 * exports-map fix.
 *
 * Both packages must be BUILT first (`make build-build-cli && make build-cli`). Because the
 * `test-*` make targets and the CI `validate-cli` job run the tests BEFORE the build step,
 * the `dist/` artifacts are absent there — the spec self-skips in that case (the per-package
 * golden/init specs already cover the generator logic). Locally, after a build, it runs the
 * real binary end to end.
 *
 * ESM ignores `NODE_PATH`; bare specifiers resolve by walking `node_modules` up from the
 * importing file (`packages/cli/bin/stp.mjs`). So the dep symlink is placed in
 * `packages/cli/node_modules/@sentropic/build-cli` (gitignored), exactly where a real
 * `npm i @sentropic/build-cli` inside the cli package would put it, then removed in teardown.
 */
const HERE = dirname(fileURLToPath(import.meta.url));
const PKG_BUILD_CLI = join(HERE, '..'); // packages/build-cli
const PKG_CLI = join(PKG_BUILD_CLI, '..', 'cli'); // packages/cli
const STP_BIN = join(PKG_CLI, 'bin', 'stp.mjs');
const CLI_SCOPE = join(PKG_CLI, 'node_modules', '@sentropic');
const CLI_DEP_LINK = join(CLI_SCOPE, 'build-cli');

const built =
    existsSync(join(PKG_BUILD_CLI, 'dist', 'index.js')) && existsSync(join(PKG_CLI, 'dist', 'index.js'));

const run = built ? describe : describe.skip;

run('stp real binary smoke (requires built dist)', () => {
    let root: string;
    let env: NodeJS.ProcessEnv;
    let createdLink = false;
    const cliNodeModules = join(PKG_CLI, 'node_modules');
    const preexistingNodeModules = existsSync(cliNodeModules);

    function stp(args: string[], cwd = root): string {
        return execFileSync('node', [STP_BIN, ...args], { encoding: 'utf8', env, cwd });
    }
    function walk(dir: string, acc: string[] = []): string[] {
        for (const e of readdirSync(dir)) {
            const p = join(dir, e);
            if (statSync(p).isDirectory()) walk(p, acc);
            else acc.push(p);
        }
        return acc;
    }

    beforeAll(() => {
        root = mkdtempSync(join(tmpdir(), 'stp-binary-smoke-'));
        // Resolve `@sentropic/build-cli` (exports map -> dist/**) where the bin's ESM resolver
        // looks: packages/cli/node_modules. Recorded so teardown only removes what it created.
        mkdirSync(CLI_SCOPE, { recursive: true });
        if (!existsSync(CLI_DEP_LINK)) {
            symlinkSync(PKG_BUILD_CLI, CLI_DEP_LINK);
            createdLink = true;
        }
        env = { ...process.env };
    });

    afterAll(() => {
        if (root) rmSync(root, { recursive: true, force: true });
        if (createdLink) rmSync(CLI_DEP_LINK, { recursive: true, force: true });
        // Only remove the cli node_modules tree if this spec created it.
        if (!preexistingNodeModules) rmSync(cliNodeModules, { recursive: true, force: true });
    });

    it('reports a semver version', () => {
        expect(stp(['--version'])).toMatch(/\d+\.\d+\.\d+/);
    });

    it('lists the `app` subcommand in --help', () => {
        expect(stp(['--help'])).toMatch(/\bapp\b/);
    });

    it('delegates `app --help` to build-cli', () => {
        expect(stp(['app', '--help'])).toMatch(/init/);
    });

    it('writes nothing on --dry-run', () => {
        const dryDir = join(root, 'demo-dry');
        stp(['app', 'init', 'demo', '--yes', '--provider', 'stub', '--no-git', '--no-github', '--dir', dryDir, '--dry-run']);
        expect(existsSync(dryDir)).toBe(false);
    });

    it('scaffolds a runnable canonical chat-server app via `app init`', () => {
        const out = join(root, 'demo');
        stp(['app', 'init', 'demo', '--yes', '--provider', 'stub', '--no-git', '--no-github', '--dir', out]);
        expect(existsSync(out)).toBe(true);

        for (const f of ['package.json', '.gitignore', 'docker-compose.yml', 'Makefile', 'api/src/server.ts', 'ui/src/App.svelte']) {
            expect(existsSync(join(out, f)), `missing ${f}`).toBe(true);
        }

        const server = readFileSync(join(out, 'api/src/server.ts'), 'utf8');
        expect(server).toMatch(/createChatServer\(\s*createInMemoryChatServerDeps\(/);
        expect(server).toMatch(/routes:\s*'canonical'/);

        const gitignore = readFileSync(join(out, '.gitignore'), 'utf8');
        expect(gitignore).toMatch(/(^|\n)\.env(\n|$)/);

        const pkg = JSON.parse(readFileSync(join(out, 'package.json'), 'utf8')) as {
            dependencies?: Record<string, string>;
        };
        const deps = pkg.dependencies ?? {};
        for (const d of ['@sentropic/chat-server', '@sentropic/chat-ui', '@sentropic/design-system-svelte']) {
            expect(deps[d], `missing pinned ${d}`).toBeTruthy();
        }

        for (const f of walk(out)) {
            const txt = readFileSync(f, 'utf8');
            expect(/\{\{[a-zA-Z0-9_.]+\}\}/.test(txt), `leftover {{token}} in ${f}`).toBe(false);
            expect(/\/sessions\/:id\/events/.test(txt), `forbidden replay surface in ${f}`).toBe(false);
            expect(/Sec-Sentropic-Wire-Version/.test(txt), `forbidden wire-version surface in ${f}`).toBe(false);
        }
    });
});
