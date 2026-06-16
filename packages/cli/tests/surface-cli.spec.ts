import { describe, expect, it } from 'vitest';
import { runSurfaceCli } from '../src/surface-cli.js';
import type { ProcessCommand, ProcessRunner } from '../src/surface/build.js';

function capture() {
    const out: string[] = [];
    const err: string[] = [];
    return {
        deps: { log: (line: string) => out.push(line), error: (line: string) => err.push(line) },
        out,
        err,
    };
}

function jsonManifest(): string {
    return JSON.stringify({
        id: 'team-surface',
        repos: [{ path: '/repos/app', branch: 'main' }],
    });
}

describe('runSurfaceCli', () => {
    it('validates a manifest without invoking graphify', async () => {
        const { deps, out, err } = capture();
        const calls: ProcessCommand[] = [];
        const runner: ProcessRunner = {
            async run(command) {
                calls.push(command);
                return { code: 0, stdout: '{}', stderr: '' };
            },
        };

        const code = await runSurfaceCli(['validate', 'surface.json'], {
            ...deps,
            readFile: async () => jsonManifest(),
            exists: (p) => p === '/repos/app',
            runner,
        });

        expect(code).toBe(0);
        expect(out.join('\n')).toContain('AnalysisSurface manifest "team-surface" is valid (1 repo).');
        expect(err).toHaveLength(0);
        expect(calls).toHaveLength(0);
    });

    it('builds a surface with injected IO and process runner', async () => {
        const { deps, out, err } = capture();
        const calls: ProcessCommand[] = [];
        const files = new Map<string, string>([
            ['/workspace/surface.json', jsonManifest()],
            ['/repos/app/.graphify/graph.json', '{}'],
        ]);
        const graph = { nodes: [{ key: 'repo:app' }], edges: [] };
        const runner: ProcessRunner = {
            async run(command) {
                calls.push(command);
                const outIndex = command.args.indexOf('--out');
                if (outIndex >= 0) {
                    files.set(command.args[outIndex + 1], JSON.stringify(graph));
                }
                return {
                    code: 0,
                    stdout: 'merge log',
                    stderr: '',
                };
            },
        };

        const code = await runSurfaceCli(['build', 'surface.json'], {
            ...deps,
            cwd: '/workspace',
            readFile: async (path) => files.get(path) ?? '',
            exists: (p) => p === '/repos/app' || files.has(p),
            runner,
            mkdir: async () => {},
        });

        expect(code).toBe(0);
        expect(calls).toHaveLength(1);
        expect(calls[0].args).toEqual([
            'merge-graphs',
            '/repos/app/.graphify/graph.json',
            '--out',
            '/workspace/.stp/surfaces/team-surface/graph.json',
        ]);
        expect(out.join('\n')).toContain(
            'Built analysis surface "team-surface" -> /workspace/.stp/surfaces/team-surface/graph.json',
        );
        expect(err).toHaveLength(0);
    });

    it('passes --refresh through to buildSurface before merging', async () => {
        const { deps, err } = capture();
        const calls: ProcessCommand[] = [];
        const files = new Map<string, string>([
            ['/workspace/surface.json', jsonManifest()],
            ['/repos/app/.graphify/graph.json', '{}'],
        ]);
        const runner: ProcessRunner = {
            async run(command) {
                calls.push(command);
                const outIndex = command.args.indexOf('--out');
                if (outIndex >= 0) {
                    files.set(command.args[outIndex + 1], JSON.stringify({ nodes: [], edges: [] }));
                }
                return { code: 0, stdout: 'ok', stderr: '' };
            },
        };

        const code = await runSurfaceCli(['build', 'surface.json', '--refresh'], {
            ...deps,
            cwd: '/workspace',
            readFile: async (path) => files.get(path) ?? '',
            exists: (p) => p === '/repos/app' || files.has(p),
            runner,
            mkdir: async () => {},
        });

        expect(code).toBe(0);
        expect(calls.map((call) => call.args[0])).toEqual(['update', 'merge-graphs']);
        expect(err).toHaveLength(0);
    });

    it('prints help for bare and help invocations', async () => {
        for (const argv of [[], ['--help'], ['-h']]) {
            const { deps, out, err } = capture();

            const code = await runSurfaceCli(argv, deps);

            expect(code).toBe(0);
            expect(out.join('\n')).toContain('stp surface build <manifest> [--refresh]');
            expect(err).toHaveLength(0);
        }
    });

    it('returns a non-zero code for an unknown surface verb', async () => {
        const { deps, err } = capture();

        const code = await runSurfaceCli(['bogus'], deps);

        expect(code).toBe(1);
        expect(err.join('\n')).toContain('Unknown surface command: bogus');
    });

    it('returns a non-zero code when build is missing the manifest argument', async () => {
        const { deps, err } = capture();

        const code = await runSurfaceCli(['build'], deps);

        expect(code).toBe(1);
        expect(err.join('\n')).toContain('Usage: stp surface build <manifest> [--refresh]');
    });
});
