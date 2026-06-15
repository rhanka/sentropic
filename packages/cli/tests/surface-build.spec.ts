import { describe, expect, it } from 'vitest';
import {
    SurfaceBuildError,
    buildSurface,
    type ProcessCommand,
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

function fakeRunner(stdout: readonly string[], code = 0): {
    runner: ProcessRunner;
    calls: ProcessCommand[];
} {
    const calls: ProcessCommand[] = [];
    return {
        calls,
        runner: {
            async run(command) {
                calls.push(command);
                return {
                    code,
                    stdout: stdout[calls.length - 1] ?? '',
                    stderr: code === 0 ? '' : 'graphify failed',
                };
            },
        },
    };
}

describe('buildSurface', () => {
    it('runs graphify once per repo, merges fragments with id dedupe, and writes graph.json', async () => {
        const { runner, calls } = fakeRunner([
            JSON.stringify({
                nodes: [
                    { id: 'repo:app', label: 'app' },
                    { id: 'shared', owner: 'first' },
                ],
                edges: [{ id: 'edge:shared', from: 'repo:app', to: 'shared' }],
            }),
            JSON.stringify({
                nodes: [
                    { id: 'shared', owner: 'second' },
                    { id: 'repo:lib', label: 'lib' },
                ],
                edges: [
                    { id: 'edge:shared', from: 'repo:lib', to: 'shared' },
                    { id: 'edge:lib', from: 'repo:lib', to: 'shared' },
                ],
            }),
        ]);
        const mkdirCalls: string[] = [];
        const writes: Array<{ path: string; data: string }> = [];

        const result = await buildSurface(manifest(), {
            cwd: '/workspace',
            runner,
            mkdir: async (path) => {
                mkdirCalls.push(path);
            },
            writeFile: async (path, data) => {
                writes.push({ path, data });
            },
        });

        expect(calls).toEqual([
            {
                file: 'graphify',
                args: [
                    'build',
                    '--fragment',
                    '--branch',
                    'main',
                    '--window',
                    '2026-01-01T00:00:00Z..2026-01-31T23:59:59Z',
                    '--options',
                    '{"includeTests":true}',
                ],
                cwd: '/repos/app',
                env: undefined,
            },
            {
                file: 'graphify',
                args: ['build', '--fragment', '--options', '{"includeTests":true}'],
                cwd: '/repos/lib',
                env: undefined,
            },
        ]);
        expect(mkdirCalls).toEqual(['/workspace/.stp/surfaces/team-surface']);
        expect(writes).toHaveLength(1);
        expect(writes[0].path).toBe('/workspace/.stp/surfaces/team-surface/graph.json');

        const graph = JSON.parse(writes[0].data);
        expect(graph).toEqual({
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
            nodes: [
                { id: 'repo:app', label: 'app' },
                { id: 'shared', owner: 'first' },
                { id: 'repo:lib', label: 'lib' },
            ],
            edges: [
                { id: 'edge:shared', from: 'repo:app', to: 'shared' },
                { id: 'edge:lib', from: 'repo:lib', to: 'shared' },
            ],
        });
        expect(result.outputPath).toBe('/workspace/.stp/surfaces/team-surface/graph.json');
        expect(result.graph).toEqual(graph);
    });

    it('throws a clear error when graphify exits non-zero', async () => {
        const { runner } = fakeRunner([''], 2);

        await expect(
            buildSurface(manifest({ repos: [{ path: '/repos/app' }] }), {
                cwd: '/workspace',
                runner,
                mkdir: async () => {},
                writeFile: async () => {},
            }),
        ).rejects.toThrow('graphify build failed for /repos/app (exit 2): graphify failed');
    });

    it('throws a clear error when graphify stdout is not valid JSON', async () => {
        const { runner } = fakeRunner(['not json']);

        await expect(
            buildSurface(manifest({ repos: [{ path: '/repos/app' }] }), {
                cwd: '/workspace',
                runner,
                mkdir: async () => {},
                writeFile: async () => {},
            }),
        ).rejects.toThrow(SurfaceBuildError);
    });
});
