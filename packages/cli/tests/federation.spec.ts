/**
 * Tests for the federation manifest + discovery loader (BR-42i, Lot 2).
 *
 * The loader accepts an optional `deps.importer` function so tests can inject a
 * controlled import resolver without relying on vitest module-interception hooks
 * (vi.unstable_mockModule was removed in vitest 2+; vi.mock hoisting is fragile for
 * runtime specifiers). The injected importer approach is the preferred pattern in this
 * codebase: same injectable-deps style used by CliDeps (log/error sinks).
 *
 * Absent-vs-broken detection under test:
 * - ERR_MODULE_NOT_FOUND / ERR_PACKAGE_PATH_NOT_EXPORTED → silently skip (absent).
 * - Any other thrown error → fail loudly (broken).
 * - Module resolves but is missing `run` and/or `version` → fail loudly (shape violation).
 */

import { describe, expect, it } from 'vitest';
import { SubcommandRegistry, InvalidSubcommandError } from '../src/registry.js';
import { FEDERATION_MANIFEST, loadFederatedSubcommands } from '../src/federation.js';

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function makeRegistry(): SubcommandRegistry {
    return new SubcommandRegistry();
}

/** Capture error calls made to the injected deps.error sink. */
function makeErrorSink(): { messages: string[]; error: (msg: string) => void } {
    const messages: string[] = [];
    return { messages, error: (msg: string) => messages.push(msg) };
}

/** Build an importer that maps specifiers to mock module objects/errors. */
function makeImporter(
    responses: Record<string, (() => unknown) | (() => Promise<unknown>)>,
    defaultFn?: () => unknown,
): (specifier: string) => Promise<unknown> {
    return async (specifier: string) => {
        const handler = responses[specifier] ?? defaultFn;
        if (handler === undefined) {
            const err = Object.assign(new Error(`No mock for "${specifier}"`), {
                code: 'ERR_MODULE_NOT_FOUND',
            });
            throw err;
        }
        return handler();
    };
}

/** Returns an ERR_MODULE_NOT_FOUND thrower suitable for "all other entries absent". */
function absentHandler(): never {
    throw Object.assign(new Error('not found'), { code: 'ERR_MODULE_NOT_FOUND' });
}

/** Returns an importer where ONLY `targetName` uses `handler`; all others are absent. */
function importerForOne(
    targetName: string,
    handler: () => unknown,
): (specifier: string) => Promise<unknown> {
    const responses: Record<string, () => unknown> = {};
    for (const entry of FEDERATION_MANIFEST) {
        responses[entry.importSpecifier] =
            entry.name === targetName ? handler : absentHandler;
    }
    return makeImporter(responses);
}

// ---------------------------------------------------------------------------
// Suite 1: valid module registered correctly
// ---------------------------------------------------------------------------

describe('loadFederatedSubcommands — valid module', () => {
    it('registers a module with valid { run, version } into the registry', async () => {
        const runFn = async (_argv: readonly string[]) => 0 as number;
        const importer = importerForOne('track', () => ({ version: '1.2.3', run: runFn }));

        const registry = makeRegistry();
        const sink = makeErrorSink();

        await loadFederatedSubcommands(registry, { error: sink.error, importer });

        const track = registry.get('track');
        expect(track).toBeDefined();
        expect(track?.version).toBe('1.2.3');
        expect(track?.run).toBe(runFn);
        // The registered name and summary come from the manifest, not the module.
        expect(track?.name).toBe('track');
        // No errors should have been emitted
        expect(sink.messages).toHaveLength(0);
    });

    it('registers multiple valid modules from the manifest', async () => {
        const responses: Record<string, () => unknown> = {};
        for (const entry of FEDERATION_MANIFEST) {
            responses[entry.importSpecifier] = () => ({
                version: `${entry.name}-1.0.0`,
                run: async () => 0,
            });
        }
        const importer = makeImporter(responses);

        const registry = makeRegistry();
        const sink = makeErrorSink();

        await loadFederatedSubcommands(registry, { error: sink.error, importer });

        expect(registry.list()).toHaveLength(FEDERATION_MANIFEST.length);
        for (const entry of FEDERATION_MANIFEST) {
            const sub = registry.get(entry.name);
            expect(sub).toBeDefined();
            expect(sub?.version).toBe(`${entry.name}-1.0.0`);
        }
        expect(sink.messages).toHaveLength(0);
    });
});

// ---------------------------------------------------------------------------
// Suite 2: absent packages silently skip
// ---------------------------------------------------------------------------

describe('loadFederatedSubcommands — absent packages silently skip', () => {
    it('silently skips a package that throws ERR_MODULE_NOT_FOUND', async () => {
        const importer = makeImporter(
            {},
            // Every specifier → ERR_MODULE_NOT_FOUND
            () => {
                throw Object.assign(new Error('Cannot find package'), {
                    code: 'ERR_MODULE_NOT_FOUND',
                });
            },
        );

        const registry = makeRegistry();
        const sink = makeErrorSink();

        // Must NOT throw
        await expect(
            loadFederatedSubcommands(registry, { error: sink.error, importer }),
        ).resolves.toBeUndefined();

        // Nothing registered
        expect(registry.list()).toHaveLength(0);
        // No error emitted for absent packages
        expect(sink.messages).toHaveLength(0);
    });

    it('silently skips a package that throws ERR_PACKAGE_PATH_NOT_EXPORTED', async () => {
        const importer = makeImporter(
            {},
            () => {
                throw Object.assign(new Error('Package subpath not exported'), {
                    code: 'ERR_PACKAGE_PATH_NOT_EXPORTED',
                });
            },
        );

        const registry = makeRegistry();
        const sink = makeErrorSink();

        await expect(
            loadFederatedSubcommands(registry, { error: sink.error, importer }),
        ).resolves.toBeUndefined();
        expect(registry.list()).toHaveLength(0);
        expect(sink.messages).toHaveLength(0);
    });

    it('skips absent entries but still registers valid ones', async () => {
        const runFn = async (_argv: readonly string[]) => 0 as number;
        // Only 'track' resolves; all others throw ERR_MODULE_NOT_FOUND.
        const importer = importerForOne('track', () => ({ version: '2.0.0', run: runFn }));

        const registry = makeRegistry();
        const sink = makeErrorSink();

        await loadFederatedSubcommands(registry, { error: sink.error, importer });

        expect(registry.list()).toHaveLength(1);
        expect(registry.get('track')).toBeDefined();
        expect(sink.messages).toHaveLength(0);
    });
});

// ---------------------------------------------------------------------------
// Suite 3: installed-but-broken — shape violation (fail-loud)
// ---------------------------------------------------------------------------

describe('loadFederatedSubcommands — installed-but-broken: shape violation', () => {
    it('fails loudly when an installed module is missing the run field', async () => {
        // Module resolves but exports only `version`, no `run`.
        const importer = importerForOne('track', () => ({
            version: '1.0.0',
            // run intentionally absent
        }));

        const registry = makeRegistry();
        const sink = makeErrorSink();

        // Must throw (fail loudly)
        await expect(
            loadFederatedSubcommands(registry, { error: sink.error, importer }),
        ).rejects.toThrow();

        // Error must be reported via the sink before throwing
        expect(sink.messages.length).toBeGreaterThan(0);
        expect(sink.messages[0]).toContain('track');

        // The malformed entry must NOT have been added to the registry
        expect(registry.get('track')).toBeUndefined();
    });

    it('fails loudly when an installed module is missing the version field', async () => {
        const importer = importerForOne('track', () => ({
            run: async (_argv: readonly string[]) => 0,
            // version intentionally absent
        }));

        const registry = makeRegistry();
        const sink = makeErrorSink();

        await expect(
            loadFederatedSubcommands(registry, { error: sink.error, importer }),
        ).rejects.toThrow();
        expect(sink.messages.length).toBeGreaterThan(0);
        expect(sink.messages[0]).toContain('track');
        expect(registry.get('track')).toBeUndefined();
    });

    it('fails loudly when an installed module exports null', async () => {
        const importer = importerForOne('h2a', () => null);

        const registry = makeRegistry();
        const sink = makeErrorSink();

        await expect(
            loadFederatedSubcommands(registry, { error: sink.error, importer }),
        ).rejects.toThrow();
        expect(sink.messages.length).toBeGreaterThan(0);
        expect(sink.messages[0]).toContain('h2a');
    });
});

// ---------------------------------------------------------------------------
// Suite 4: installed-but-broken — non-absence import error (fail-loud)
// ---------------------------------------------------------------------------

describe('loadFederatedSubcommands — installed-but-broken: import throws non-absence error', () => {
    it('fails loudly when an import throws a SyntaxError (not an absence code)', async () => {
        const importer = importerForOne('track', () => {
            throw new SyntaxError('Unexpected token');
        });

        const registry = makeRegistry();
        const sink = makeErrorSink();

        await expect(
            loadFederatedSubcommands(registry, { error: sink.error, importer }),
        ).rejects.toThrow(SyntaxError);

        // Error must have been reported to the sink
        expect(sink.messages.length).toBeGreaterThan(0);
        expect(sink.messages[0]).toContain('track');
    });

    it('fails loudly when an import throws a TypeError (not an absence code)', async () => {
        const importer = importerForOne('h2a', () => {
            throw new TypeError('Failed to resolve module specifier');
        });

        const registry = makeRegistry();
        const sink = makeErrorSink();

        await expect(
            loadFederatedSubcommands(registry, { error: sink.error, importer }),
        ).rejects.toThrow(TypeError);
        expect(sink.messages.length).toBeGreaterThan(0);
        expect(sink.messages[0]).toContain('h2a');
    });

    it('fails loudly when an import throws a generic Error without an absence code', async () => {
        const importer = importerForOne('remote', () => {
            throw new Error('Transitive import failure');
        });

        const registry = makeRegistry();
        const sink = makeErrorSink();

        await expect(
            loadFederatedSubcommands(registry, { error: sink.error, importer }),
        ).rejects.toThrow('Transitive import failure');
        expect(sink.messages.length).toBeGreaterThan(0);
        expect(sink.messages[0]).toContain('remote');
    });
});

// ---------------------------------------------------------------------------
// Suite 5: registry registration failure is fail-loud
// ---------------------------------------------------------------------------

describe('loadFederatedSubcommands — registration failure is fail-loud', () => {
    it('fails loudly when registry.register throws InvalidSubcommandError (empty version)', async () => {
        // Empty version string — registry.register throws InvalidSubcommandError.
        const importer = importerForOne('track', () => ({
            run: async (_argv: readonly string[]) => 0,
            version: '', // empty version triggers InvalidSubcommandError
        }));

        const registry = makeRegistry();
        const sink = makeErrorSink();

        await expect(
            loadFederatedSubcommands(registry, { error: sink.error, importer }),
        ).rejects.toThrow(InvalidSubcommandError);
        expect(sink.messages.length).toBeGreaterThan(0);
        expect(sink.messages[0]).toContain('track');
        expect(registry.get('track')).toBeUndefined();
    });
});

// ---------------------------------------------------------------------------
// Suite 6: FEDERATION_MANIFEST shape and content assertions
// ---------------------------------------------------------------------------

describe('FEDERATION_MANIFEST', () => {
    it('contains exactly the 6 expected cross-repo entries (no app, no harness)', () => {
        const names = FEDERATION_MANIFEST.map((e) => e.name);
        expect(names).toContain('h2a');
        expect(names).toContain('knowledge');
        expect(names).toContain('remote');
        expect(names).toContain('track');
        expect(names).toContain('design');
        expect(names).toContain('agent-stats');
        // In-repo (app) and gated (harness) must NOT appear
        expect(names).not.toContain('app');
        expect(names).not.toContain('harness');
        expect(FEDERATION_MANIFEST).toHaveLength(6);
    });

    it('every entry has non-empty name, summary, and importSpecifier', () => {
        for (const entry of FEDERATION_MANIFEST) {
            expect(entry.name.trim()).not.toBe('');
            expect(entry.summary.trim()).not.toBe('');
            expect(entry.importSpecifier.trim()).not.toBe('');
        }
    });

    it('importSpecifiers are verbatim package paths (not guessed patterns)', () => {
        const specMap: Record<string, string> = {};
        for (const entry of FEDERATION_MANIFEST) {
            specMap[entry.name] = entry.importSpecifier;
        }
        expect(specMap['h2a']).toBe('@sentropic/h2a/cli');
        expect(specMap['knowledge']).toBe('@sentropic/graphify/cli');
        expect(specMap['remote']).toBe('sentropic-remote/cli');
        expect(specMap['track']).toBe('@sentropic/track/cli');
        expect(specMap['design']).toBe('@sentropic/design-system-skills/cli');
        expect(specMap['agent-stats']).toBe('@sentropic/agent-stats/cli');
    });

    it('the manifest is ordered alphabetically by name', () => {
        const names = FEDERATION_MANIFEST.map((e) => e.name);
        const sorted = [...names].sort((a, b) => a.localeCompare(b));
        expect(names).toEqual(sorted);
    });
});
