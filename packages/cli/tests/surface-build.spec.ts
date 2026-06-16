import { describe, expect, it } from 'vitest';
import {
    SurfaceBuildError,
    buildSurface,
    type ProcessCommand,
    type ProcessResult,
    type ProcessRunner,
} from '../src/surface/build.js';
import type { AnalysisSurfaceManifest } from '../src/surface/manifest.js';

function manifest(overrides: Partial<AnalysisSurfaceManifest> = {}): AnalysisSurfaceManifest {
    return {
        id: 'team-surface',
        repos: [
            {
                path: '/repos/app',
                branch: 'main',
                window: '2026-01-01T00:00:00Z..2026-01-31T23:59:59Z',
            },
            { path: '/repos/lib' },
        ],
        options: { includeTests: true },
        ...overrides,
    };
}

function createFiles(initial: Readonly<Record<string, string>> = {}): {
    exists: (path: string) => boolean;
    readFile: (path: string) => Promise<string>;
    writeFile: (path: string, data: string) => Promise<void>;
    writes: Array<{ path: string; data: string }>;
} {
    const files = new Map(Object.entries(initial));
    const writes: Array<{ path: string; data: string }> = [];
    return {
        exists: (path) => files.has(path),
        async readFile(path) {
            const data = files.get(path);
            if (data === undefined) {
                throw new Error(`missing test file: ${path}`);
            }
            return data;
        },
        async writeFile(path, data) {
            files.set(path, data);
            writes.push({ path, data });
        },
        writes,
    };
}

function fakeRunner(
    handler: (command: ProcessCommand, callIndex: number) => Promise<ProcessResult> | ProcessResult,
): {
    runner: ProcessRunner;
    calls: ProcessCommand[];
} {
    const calls: ProcessCommand[] = [];
    return {
        calls,
        runner: {
            async run(command) {
                calls.push(command);
                return handler(command, calls.length - 1);
            },
        },
    };
}

describe('buildSurface', () => {
    it('merges resolved graphify graph.json files once and reads graph.json from --out', async () => {
        const graph = {
            attributes: { id: 'team-surface' },
            nodes: [
                { key: 'repo:app', attributes: { label: 'app' } },
                { key: 'repo:lib', attributes: { label: 'lib' } },
                { key: 'repo:tool', attributes: { label: 'tool' } },
            ],
            edges: [{ key: 'edge:app-lib', source: 'repo:app', target: 'repo:lib' }],
        };
        const files = createFiles({
            '/repos/app/.graphify/graph.json': '{}',
            '/repos/lib/.graphify/graph.json': '{}',
            '/repos/tool/.graphify/graph.json': '{}',
        });
        const { runner, calls } = fakeRunner(async (command) => {
            if (command.args[0] === 'merge-graphs') {
                const outIndex = command.args.indexOf('--out');
                await files.writeFile(command.args[outIndex + 1], `${JSON.stringify(graph)}\n`);
            }
            return { code: 0, stdout: 'merged 3 graphs', stderr: '' };
        });
        const mkdirCalls: string[] = [];

        const result = await buildSurface(manifest({
            repos: [
                {
                    path: '/repos/app',
                    branch: 'main',
                    window: '2026-01-01T00:00:00Z..2026-01-31T23:59:59Z',
                },
                { path: '/repos/lib/.graphify' },
                { path: '/repos/tool/.graphify/graph.json' },
            ],
        }), {
            cwd: '/workspace',
            runner,
            mkdir: async (path) => {
                mkdirCalls.push(path);
            },
            exists: files.exists,
            readFile: files.readFile,
        });

        expect(calls).toEqual([{
            file: 'graphify',
            args: [
                'merge-graphs',
                '/repos/app/.graphify/graph.json',
                '/repos/lib/.graphify/graph.json',
                '/repos/tool/.graphify/graph.json',
                '--out',
                '/workspace/.stp/surfaces/team-surface/graph.json',
            ],
            cwd: '/workspace',
            env: undefined,
        }]);
        expect(mkdirCalls).toEqual(['/workspace/.stp/surfaces/team-surface']);
        expect(files.writes).toEqual([{
            path: '/workspace/.stp/surfaces/team-surface/graph.json',
            data: `${JSON.stringify(graph)}\n`,
        }]);
        expect(result.outputPath).toBe('/workspace/.stp/surfaces/team-surface/graph.json');
        expect(result.graph).toEqual(graph);
    });

    it('throws a clear error when a repo graph.json is missing', async () => {
        const files = createFiles({ '/repos/app/.graphify/graph.json': '{}' });
        const { runner, calls } = fakeRunner(() => ({ code: 0, stdout: '', stderr: '' }));

        await expect(
            buildSurface(manifest({ repos: [{ path: '/repos/app' }, { path: '/repos/lib' }] }), {
                cwd: '/workspace',
                runner,
                mkdir: async () => {},
                exists: files.exists,
                readFile: files.readFile,
            }),
        ).rejects.toThrow(
            'Missing graphify graph for /repos/lib: expected /repos/lib/.graphify/graph.json. Run graphify on this repository first, or rebuild with refresh enabled.',
        );
        expect(calls).toHaveLength(0);
    });

    it('updates repos before merging when refresh is enabled', async () => {
        const graph = { nodes: [], edges: [] };
        const files = createFiles({ '/repos/app/.graphify/graph.json': '{}' });
        const { runner, calls } = fakeRunner(async (command) => {
            if (command.args[0] === 'merge-graphs') {
                const outIndex = command.args.indexOf('--out');
                await files.writeFile(command.args[outIndex + 1], JSON.stringify(graph));
            }
            return { code: 0, stdout: 'ok', stderr: '' };
        });

        await buildSurface(manifest({
            repos: [{ path: '/repos/app', branch: 'main', window: 'last-7d' }],
            options: { refresh: true },
        }), {
            cwd: '/workspace',
            runner,
            mkdir: async () => {},
            exists: files.exists,
            readFile: files.readFile,
        });

        expect(calls).toEqual([
            {
                file: 'graphify',
                args: ['update', '/repos/app'],
                cwd: '/workspace',
                env: undefined,
            },
            {
                file: 'graphify',
                args: [
                    'merge-graphs',
                    '/repos/app/.graphify/graph.json',
                    '--out',
                    '/workspace/.stp/surfaces/team-surface/graph.json',
                ],
                cwd: '/workspace',
                env: undefined,
            },
        ]);
    });

    it('throws SurfaceBuildError when graphify merge-graphs exits non-zero', async () => {
        const files = createFiles({ '/repos/app/.graphify/graph.json': '{}' });
        const { runner } = fakeRunner(() => ({
            code: 2,
            stdout: 'merge log',
            stderr: 'merge failed',
        }));

        await expect(
            buildSurface(manifest({ repos: [{ path: '/repos/app' }] }), {
                cwd: '/workspace',
                runner,
                mkdir: async () => {},
                exists: files.exists,
                readFile: files.readFile,
            }),
        ).rejects.toThrow(SurfaceBuildError);
        await expect(
            buildSurface(manifest({ repos: [{ path: '/repos/app' }] }), {
                cwd: '/workspace',
                runner,
                mkdir: async () => {},
                exists: files.exists,
                readFile: files.readFile,
            }),
        ).rejects.toThrow('graphify merge-graphs failed (exit 2): merge failed');
    });
});
