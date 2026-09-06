import { describe, expect, it } from 'vitest';
import {
    MIN_NODE_MAJOR,
    formatDoctorReport,
    runDoctor,
    type DoctorDeps,
} from '../src/commands/doctor.js';
import type { ProcessResult } from '../src/commands/process.js';
import { buildCliCommandIntentAdapter } from '../src/command-intent.js';

/** Build deps with every probe mocked to a healthy default; override per test. */
function healthyDeps(overrides: Partial<DoctorDeps> = {}): DoctorDeps {
    return {
        hasBinary: async () => true,
        runner: { run: async (): Promise<ProcessResult> => ({ code: 0, stdout: '', stderr: '' }) },
        isPortFree: async () => true,
        nodeVersion: `v${MIN_NODE_MAJOR}.0.0`,
        ports: [9211, 5411],
        ...overrides,
    };
}

describe('runDoctor', () => {
    it('projects doctor intent without running host probes', () => {
        expect(buildCliCommandIntentAdapter.parseIntent(['doctor', '--github'])).toEqual({
            runnerId: 'build-cli', source: '@sentropic/build-cli', argv: ['doctor', '--github'],
        });
    });

    it('passes every check on a healthy host (non-github)', async () => {
        const report = await runDoctor(healthyDeps());
        expect(report.ok).toBe(true);
        expect(report.checks.map((c) => c.id)).toEqual([
            'docker',
            'make',
            'gh-auth',
            'node-engine',
            'port:9211',
            'port:5411',
        ]);
    });

    it('fails when Docker is absent', async () => {
        const report = await runDoctor(healthyDeps({ hasBinary: async (n) => n !== 'docker' }));
        expect(report.ok).toBe(false);
        expect(report.checks.find((c) => c.id === 'docker')?.ok).toBe(false);
    });

    it('fails when make is absent', async () => {
        const report = await runDoctor(healthyDeps({ hasBinary: async (n) => n !== 'make' }));
        expect(report.ok).toBe(false);
        expect(report.checks.find((c) => c.id === 'make')?.ok).toBe(false);
    });

    it('does not require gh auth when GitHub creation is not intended', async () => {
        const report = await runDoctor(
            healthyDeps({
                requireGithub: false,
                runner: { run: async (): Promise<ProcessResult> => ({ code: 1, stdout: '', stderr: 'not logged in' }) },
            }),
        );
        expect(report.checks.find((c) => c.id === 'gh-auth')?.ok).toBe(true);
    });

    it('fails gh-auth when GitHub is intended but gh is not authenticated', async () => {
        const report = await runDoctor(
            healthyDeps({
                requireGithub: true,
                runner: { run: async (): Promise<ProcessResult> => ({ code: 1, stdout: '', stderr: 'not logged in' }) },
            }),
        );
        expect(report.ok).toBe(false);
        expect(report.checks.find((c) => c.id === 'gh-auth')?.ok).toBe(false);
    });

    it('fails gh-auth when GitHub is intended but gh binary is missing', async () => {
        const report = await runDoctor(
            healthyDeps({ requireGithub: true, hasBinary: async (n) => n !== 'gh' }),
        );
        expect(report.checks.find((c) => c.id === 'gh-auth')?.ok).toBe(false);
    });

    it('fails the node-engine check below the minimum major', async () => {
        const report = await runDoctor(healthyDeps({ nodeVersion: `v${MIN_NODE_MAJOR - 1}.9.9` }));
        expect(report.ok).toBe(false);
        expect(report.checks.find((c) => c.id === 'node-engine')?.ok).toBe(false);
    });

    it('reports a port conflict on the generated-app ports (BR42a-Q9)', async () => {
        const report = await runDoctor(
            healthyDeps({ isPortFree: async (p) => p !== 9211, ports: [9211, 5411] }),
        );
        expect(report.ok).toBe(false);
        expect(report.checks.find((c) => c.id === 'port:9211')?.ok).toBe(false);
        expect(report.checks.find((c) => c.id === 'port:5411')?.ok).toBe(true);
    });

    it('renders a human-readable report ending with the aggregate verdict', async () => {
        const report = await runDoctor(healthyDeps());
        const text = formatDoctorReport(report);
        expect(text).toContain('OK\tDocker available');
        expect(text.trim().endsWith('doctor: all checks passed')).toBe(true);
    });
});
