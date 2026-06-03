import { describe, expect, it } from 'vitest';
import {
    DuplicateOutputPathError,
    resolvePlan,
    type ScaffoldManifest,
} from '../src/generator/index.js';
import { MissingTokenError } from '../src/templating/index.js';

/** A tiny manifest exercising path tokens, content tokens, transforms, and a fixed mode. */
const TINY_MANIFEST: ScaffoldManifest = {
    entries: [
        {
            sourcePath: 'package.json.tmpl',
            outputPath: '{{slug}}/package.json',
            content: '{\n  "name": "{{slug}}",\n  "version": "0.0.0"\n}\n',
        },
        {
            sourcePath: 'README.md.tmpl',
            outputPath: '{{slug}}/README.md',
            content: '# {{title}}\n\nPort {{port}}.\n',
        },
        {
            sourcePath: 'run.sh.tmpl',
            outputPath: '{{slug}}/run.sh',
            content: '#!/bin/sh\nexec node server.js --port {{port}}\n',
            transforms: [(c) => c.toUpperCase()],
            mode: 0o755,
        },
    ],
};

const TINY_OPTIONS = {
    tokens: { slug: 'demo', title: 'Demo App', port: '9211' },
};

/** Committed golden fixture: the expected byte-for-byte plan for TINY_MANIFEST. */
const GOLDEN_PLAN = {
    files: [
        {
            outputPath: 'demo/package.json',
            content: '{\n  "name": "demo",\n  "version": "0.0.0"\n}\n',
        },
        {
            outputPath: 'demo/README.md',
            content: '# Demo App\n\nPort 9211.\n',
        },
        {
            outputPath: 'demo/run.sh',
            content: '#!/BIN/SH\nEXEC NODE SERVER.JS --PORT 9211\n',
            mode: 0o755,
        },
    ],
};

describe('resolvePlan', () => {
    it('resolves a manifest into the expected golden plan (byte-for-byte, R10)', () => {
        const plan = resolvePlan(TINY_MANIFEST, TINY_OPTIONS);
        expect(plan).toEqual(GOLDEN_PLAN);
    });

    it('preserves manifest declaration order', () => {
        const plan = resolvePlan(TINY_MANIFEST, TINY_OPTIONS);
        expect(plan.files.map((f) => f.outputPath)).toEqual([
            'demo/package.json',
            'demo/README.md',
            'demo/run.sh',
        ]);
    });

    it('is deterministic: identical inputs yield a byte-identical plan', () => {
        const a = resolvePlan(TINY_MANIFEST, TINY_OPTIONS);
        const b = resolvePlan(TINY_MANIFEST, TINY_OPTIONS);
        expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    });

    it('substitutes tokens into output paths', () => {
        const plan = resolvePlan(TINY_MANIFEST, { tokens: { ...TINY_OPTIONS.tokens, slug: 'other' } });
        expect(plan.files[0].outputPath).toBe('other/package.json');
    });

    it('applies content transforms after substitution, in order', () => {
        const manifest: ScaffoldManifest = {
            entries: [
                {
                    sourcePath: 's',
                    outputPath: 'out.txt',
                    content: '{{v}}',
                    transforms: [(c) => `<${c}>`, (c) => c.toUpperCase()],
                },
            ],
        };
        const plan = resolvePlan(manifest, { tokens: { v: 'hi' } });
        expect(plan.files[0].content).toBe('<HI>');
    });

    it('omits mode when an entry does not specify one', () => {
        const manifest: ScaffoldManifest = {
            entries: [{ sourcePath: 's', outputPath: 'a.txt', content: 'x' }],
        };
        const plan = resolvePlan(manifest, { tokens: {} });
        expect(plan.files[0]).not.toHaveProperty('mode');
    });

    it('throws DuplicateOutputPathError when two entries resolve to the same path', () => {
        const manifest: ScaffoldManifest = {
            entries: [
                { sourcePath: 's1', outputPath: '{{a}}.txt', content: '1' },
                { sourcePath: 's2', outputPath: '{{b}}.txt', content: '2' },
            ],
        };
        expect(() => resolvePlan(manifest, { tokens: { a: 'same', b: 'same' } })).toThrow(
            DuplicateOutputPathError,
        );
    });

    it('propagates MissingTokenError from path or content', () => {
        expect(() => resolvePlan(TINY_MANIFEST, { tokens: { slug: 'demo', title: 'T' } })).toThrow(
            MissingTokenError,
        );
    });
});
