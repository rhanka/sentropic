import { describe, expect, it } from 'vitest';
import {
    ManifestValidationError,
    parseAnalysisSurfaceManifest,
} from '../src/surface/manifest.js';

describe('parseAnalysisSurfaceManifest', () => {
    it('parses a strict JSON manifest with existing repository paths', () => {
        const manifest = parseAnalysisSurfaceManifest(
            JSON.stringify({
                id: 'team-surface',
                repos: [
                    {
                        path: '/repos/app',
                        branch: 'main',
                        window: '2026-01-01T00:00:00Z..2026-01-31T23:59:59Z',
                    },
                ],
                options: { includeTests: true, maxDepth: 2 },
            }),
            { exists: (p) => p === '/repos/app' },
        );

        expect(manifest).toEqual({
            id: 'team-surface',
            repos: [
                {
                    path: '/repos/app',
                    branch: 'main',
                    window: '2026-01-01T00:00:00Z..2026-01-31T23:59:59Z',
                },
            ],
            options: { includeTests: true, maxDepth: 2 },
        });
    });

    it('parses a YAML manifest and resolves relative repo paths against baseDir', () => {
        const source = [
            'id: portfolio_surface',
            'repos:',
            '  - path: app',
            '    branch: main',
            '  - path: libs/graph',
            '    window: 2026-02-01T00:00:00Z..2026-02-28T23:59:59Z',
            'options:',
            '  includeTests: true',
            '  maxDepth: 3',
            '',
        ].join('\n');

        const manifest = parseAnalysisSurfaceManifest(source, {
            baseDir: '/workspace',
            exists: (p) => p === '/workspace/app' || p === '/workspace/libs/graph',
        });

        expect(manifest).toEqual({
            id: 'portfolio_surface',
            repos: [
                { path: '/workspace/app', branch: 'main' },
                {
                    path: '/workspace/libs/graph',
                    window: '2026-02-01T00:00:00Z..2026-02-28T23:59:59Z',
                },
            ],
            options: { includeTests: true, maxDepth: 3 },
        });
    });

    it('rejects a manifest without a required id', () => {
        expect(() =>
            parseAnalysisSurfaceManifest(JSON.stringify({ repos: [{ path: '/repos/app' }] }), {
                exists: () => true,
            }),
        ).toThrow(ManifestValidationError);
    });

    it('rejects an unsafe surface id that could escape the output directory', () => {
        expect(() =>
            parseAnalysisSurfaceManifest(
                JSON.stringify({ id: '../escape', repos: [{ path: '/repos/app' }] }),
                { exists: () => true },
            ),
        ).toThrow('surface id must be a safe slug');
    });

    it('rejects an empty repos array', () => {
        expect(() =>
            parseAnalysisSurfaceManifest(JSON.stringify({ id: 'empty', repos: [] }), {
                exists: () => true,
            }),
        ).toThrow('repos must contain at least one repository');
    });

    it('rejects a repo path that does not exist', () => {
        expect(() =>
            parseAnalysisSurfaceManifest(
                JSON.stringify({ id: 'missing-path', repos: [{ path: '/repos/missing' }] }),
                { exists: () => false },
            ),
        ).toThrow('repo path does not exist: /repos/missing');
    });
});
