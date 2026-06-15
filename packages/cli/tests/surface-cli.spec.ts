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
        const writes: Array<{ path: string; data: string }> = [];
        const runner: ProcessRunner = {
            async run(command) {
                calls.push(command);
                return {
                    code: 0,
                    stdout: JSON.stringify({ nodes: [{ id: 'repo:app' }], edges: [] }),
                    stderr: '',
                };
            },
        };

        const code = await runSurfaceCli(['build', 'surface.json'], {
            ...deps,
            cwd: '/workspace',
            readFile: async () => jsonManifest(),
            exists: (p) => p === '/repos/app',
            runner,
            mkdir: async () => {},
            writeFile: async (path, data) => {
                writes.push({ path, data });
            },
        });

        expect(code).toBe(0);
        expect(calls).toHaveLength(1);
        expect(calls[0].args).toEqual(['build', '--fragment', '--branch', 'main']);
        expect(writes[0].path).toBe('/workspace/.stp/surfaces/team-surface/graph.json');
        expect(out.join('\n')).toContain(
            'Built analysis surface "team-surface" -> /workspace/.stp/surfaces/team-surface/graph.json',
        );
        expect(err).toHaveLength(0);
    });

    it('prints help for bare and help invocations', async () => {
        for (const argv of [[], ['--help'], ['-h']]) {
            const { deps, out, err } = capture();

            const code = await runSurfaceCli(argv, deps);

            expect(code).toBe(0);
            expect(out.join('\n')).toContain('stp surface build <manifest>');
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
        expect(err.join('\n')).toContain('Usage: stp surface build <manifest>');
    });
});
