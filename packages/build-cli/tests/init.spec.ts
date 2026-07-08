import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { runInit, type InitDeps } from '../src/commands/init.js';
import { parseInitOptions, type InitOptions } from '../src/commands/options.js';
import type { ProcessCommand, ProcessResult, ProcessRunner } from '../src/commands/process.js';
import { TINY_FIXTURE_MANIFEST } from './fixtures/tiny-manifest.js';
import { loadChatAppManifest } from '../src/manifest/chat-app.js';

let dir: string;
let logs: string[];

/** A runner that records every command and never has side effects (git/gh succeed). */
function recordingRunner(): { runner: ProcessRunner; calls: ProcessCommand[] } {
    const calls: ProcessCommand[] = [];
    const runner: ProcessRunner = {
        run: async (cmd): Promise<ProcessResult> => {
            calls.push(cmd);
            // `git remote` returns empty (no remote); `gh repo view` returns non-zero (absent).
            if (cmd.file === 'gh' && cmd.args[0] === 'repo' && cmd.args[1] === 'view') {
                return { code: 1, stdout: '', stderr: 'not found' };
            }
            return { code: 0, stdout: '', stderr: '' };
        },
    };
    return { runner, calls };
}

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

function deps(extra: Partial<InitDeps> = {}): InitDeps {
    return {
        manifest: TINY_FIXTURE_MANIFEST,
        log: (l) => logs.push(l),
        ports: { api: 9211, ui: 5411, maildev: 1311 },
        ...extra,
    };
}

beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'build-cli-init-'));
    logs = [];
});

afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
});

describe('runInit — dry-run', () => {
    it('prints the full plan and writes NOTHING', async () => {
        const result = await runInit(options({ dryRun: true }), deps());
        expect(result.dryRun).toBe(true);
        expect(result.written).toEqual([]);
        expect(existsSync(result.targetDir)).toBe(false);
        const printed = logs.join('\n');
        expect(printed).toContain('+ package.json');
        expect(printed).toContain('+ .gitignore');
        expect(printed).toContain('dry-run: no files written');
    });

    it('prints the EXACT gh repo create command and creates no repo', async () => {
        const { runner, calls } = recordingRunner();
        const result = await runInit(
            options({ dryRun: true, github: true, githubOwner: 'acme', githubVisibility: 'private' }),
            deps({ runner }),
        );
        expect(result.ghCommand).toBe(
            `gh repo create acme/demo --private --source ${result.targetDir} --push`,
        );
        expect(logs.join('\n')).toContain(`GitHub (would run, not executed): ${result.ghCommand}`);
        // Zero process calls on a dry-run (no collision probe, no creation).
        expect(calls).toEqual([]);
    });
});

describe('runInit — full materialise', () => {
    it('writes the expected tree with tokens substituted', async () => {
        const result = await runInit(options(), deps());
        expect(result.dryRun).toBe(false);
        const tree = (await readdir(result.targetDir)).sort();
        expect(tree).toEqual(['.env.example', '.gitignore', 'README.md', 'api', 'package.json']);
        const pkg = await readFile(join(result.targetDir, 'package.json'), 'utf8');
        expect(pkg).toContain('"name": "demo"');
        const readme = await readFile(join(result.targetDir, 'README.md'), 'utf8');
        expect(readme).toContain('UI on 5411, API on 9211.');
        const server = await readFile(join(result.targetDir, 'api/src/server.ts'), 'utf8');
        expect(server).toContain("export const provider = 'stub';");
    });

    it('generates a .gitignore that excludes .env (no-secret-leak)', async () => {
        const result = await runInit(options(), deps());
        const gitignore = await readFile(join(result.targetDir, '.gitignore'), 'utf8');
        expect(gitignore.split('\n')).toContain('.env');
    });

    it('does not emit a .env file in the scaffold', async () => {
        const result = await runInit(options(), deps());
        expect(existsSync(join(result.targetDir, '.env'))).toBe(false);
    });

    it('runs git init + first commit when --git is on', async () => {
        const { runner, calls } = recordingRunner();
        await runInit(options({ git: true }), deps({ runner }));
        const gitCmds = calls.filter((c) => c.file === 'git').map((c) => c.args[0]);
        expect(gitCmds).toEqual(['init', 'add', 'commit']);
    });
});

describe('runInit — materialise the REAL chat-app template', () => {
    function realDeps(extra: Partial<InitDeps> = {}): InitDeps {
        return {
            manifest: loadChatAppManifest(),
            log: (l) => logs.push(l),
            ports: { api: 9211, ui: 5411, maildev: 1311 },
            ...extra,
        };
    }

    it('writes the full app tree (api + ui + tooling)', async () => {
        const result = await runInit(options(), realDeps());
        const tree = (await readdir(result.targetDir)).sort();
        // .gitignore is materialised from the dotfile-safe _gitignore source.
        expect(tree).toContain('.gitignore');
        expect(tree).toContain('.env.example');
        expect(tree).toContain('package.json');
        expect(tree).toContain('docker-compose.yml');
        expect(tree).toContain('Makefile');
        expect(tree).toContain('LICENSE');
        expect(tree).toContain('api');
        expect(tree).toContain('ui');
        expect(existsSync(join(result.targetDir, 'api/src/server.ts'))).toBe(true);
        expect(existsSync(join(result.targetDir, 'ui/src/App.svelte'))).toBe(true);
        // The dotfile-safe source name must NOT leak into the scaffold.
        expect(tree).not.toContain('_gitignore');
    });

    it('backend mounts @sentropic/chat-server canonical routes', async () => {
        const result = await runInit(options(), realDeps());
        const server = await readFile(join(result.targetDir, 'api/src/server.ts'), 'utf8');
        expect(server).toContain("from '@sentropic/chat-server'");
        expect(server).toContain('createChatServer(');
        expect(server).toContain("routes: 'canonical'");
        expect(server).not.toMatch(/Sec-Sentropic-Wire-Version/i);
    });

    it('generated .gitignore excludes .env and no .env file is emitted', async () => {
        const result = await runInit(options(), realDeps());
        const gitignore = await readFile(join(result.targetDir, '.gitignore'), 'utf8');
        expect(gitignore.split('\n')).toContain('.env');
        expect(existsSync(join(result.targetDir, '.env'))).toBe(false);
    });

    it('pins the published @sentropic/* versions in the generated package.json', async () => {
        const result = await runInit(options(), realDeps());
        const pkg = JSON.parse(await readFile(join(result.targetDir, 'package.json'), 'utf8')) as {
            name: string;
            dependencies: Record<string, string>;
        };
        expect(pkg.name).toBe('demo');
        expect(pkg.dependencies['@sentropic/chat-server']).toBe('^0.1.0');
        expect(pkg.dependencies['@sentropic/chat-ui']).toBe('^0.1.1');
        expect(pkg.dependencies['@sentropic/design-system-svelte']).toBe('^0.34.69');
    });

    it('bakes the deterministic assistant reply (offline) into the backend', async () => {
        const result = await runInit(options({ name: 'demo' }), realDeps());
        const server = await readFile(join(result.targetDir, 'api/src/server.ts'), 'utf8');
        expect(server).toContain('Hello from demo');
    });

    it('compose project name is the app slug on non-reserved ports', async () => {
        const result = await runInit(options(), realDeps());
        const compose = await readFile(join(result.targetDir, 'docker-compose.yml'), 'utf8');
        expect(compose).toContain('name: demo');
        expect(compose).not.toMatch(/\b8787\b|\b5173\b|\b1080\b/);
    });
});

describe('parseInitOptions — provider validation', () => {
    it('accepts stub + every real llm-mesh provider id', () => {
        for (const p of ['stub', 'openai', 'gemini', 'anthropic', 'mistral', 'cohere']) {
            expect(parseInitOptions(['demo', '--provider', p]).provider).toBe(p);
        }
    });

    it('rejects an unknown provider id', () => {
        expect(() => parseInitOptions(['demo', '--provider', 'google'])).toThrow(/--provider/);
    });

    it('defaults the provider to stub', () => {
        expect(parseInitOptions(['demo']).provider).toBe('stub');
    });
});
