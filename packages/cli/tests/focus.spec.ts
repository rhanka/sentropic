/**
 * Tests for the in-repo `focus` subcommand wire (Focus-M1 L3).
 *
 * `tryRegisterFocus` mirrors the federation loader's injectable-deps style: an optional
 * `deps.importer` lets tests exercise the absent / broken / bad-shape / valid branches without
 * `@sentropic/focus` installed, and an optional `deps.error` sink captures the fail-loud message.
 *
 * Absent-vs-broken detection under test:
 * - ERR_MODULE_NOT_FOUND / ERR_PACKAGE_PATH_NOT_EXPORTED → silently skip (focus absent, e.g. stp
 *   published standalone) — registry stays empty, no error emitted.
 * - Any other import error → fail loudly (a broken in-repo focus must NOT masquerade as absent).
 * - Module resolves but is missing `run`/`version` (or is null) → fail loudly (shape violation).
 * - A valid `{ run, version }` module → registered as the `focus` subcommand.
 */

import { describe, expect, it } from 'vitest';
import { SubcommandRegistry, InvalidSubcommandError } from '../src/registry.js';
import { tryRegisterFocus } from '../src/focus.js';

const SPECIFIER = '@sentropic/focus/cli';

function makeRegistry(): SubcommandRegistry {
    return new SubcommandRegistry();
}

function makeErrorSink(): { messages: string[]; error: (msg: string) => void } {
    const messages: string[] = [];
    return { messages, error: (msg: string) => messages.push(msg) };
}

/** An importer that runs `handler` for the focus specifier (and rejects any other specifier). */
function importerWith(handler: () => unknown): (specifier: string) => Promise<unknown> {
    return async (specifier: string) => {
        if (specifier !== SPECIFIER) {
            throw new Error(`unexpected specifier "${specifier}"`);
        }
        return handler();
    };
}

// ---------------------------------------------------------------------------
// Suite 1: valid module registered as `focus`
// ---------------------------------------------------------------------------

describe('tryRegisterFocus — valid module', () => {
    it('registers a module with valid { run, version } as the `focus` subcommand', async () => {
        const runFn = async (_argv: readonly string[]) => 0 as number;
        const importer = importerWith(() => ({ version: '0.3.0', run: runFn }));

        const registry = makeRegistry();
        const sink = makeErrorSink();

        await tryRegisterFocus(registry, { error: sink.error, importer });

        const focus = registry.get('focus');
        expect(focus).toBeDefined();
        expect(focus?.name).toBe('focus');
        expect(focus?.version).toBe('0.3.0');
        expect(focus?.run).toBe(runFn);
        // The summary is owned by the wire (not the module), and advertises the read-only render.
        expect(focus?.summary).toContain('read-only');
        expect(sink.messages).toHaveLength(0);
    });
});

// ---------------------------------------------------------------------------
// Suite 2: absent package silently skips
// ---------------------------------------------------------------------------

describe('tryRegisterFocus — absent package silently skips', () => {
    it('silently skips when the import throws ERR_MODULE_NOT_FOUND', async () => {
        const importer = importerWith(() => {
            throw Object.assign(new Error('Cannot find package'), {
                code: 'ERR_MODULE_NOT_FOUND',
            });
        });

        const registry = makeRegistry();
        const sink = makeErrorSink();

        await expect(
            tryRegisterFocus(registry, { error: sink.error, importer }),
        ).resolves.toBeUndefined();

        expect(registry.get('focus')).toBeUndefined();
        expect(registry.list()).toHaveLength(0);
        expect(sink.messages).toHaveLength(0);
    });

    it('silently skips when the import throws ERR_PACKAGE_PATH_NOT_EXPORTED', async () => {
        const importer = importerWith(() => {
            throw Object.assign(new Error('Package subpath not exported'), {
                code: 'ERR_PACKAGE_PATH_NOT_EXPORTED',
            });
        });

        const registry = makeRegistry();
        const sink = makeErrorSink();

        await expect(
            tryRegisterFocus(registry, { error: sink.error, importer }),
        ).resolves.toBeUndefined();
        expect(registry.get('focus')).toBeUndefined();
        expect(sink.messages).toHaveLength(0);
    });
});

// ---------------------------------------------------------------------------
// Suite 3: installed-but-broken — non-absence import error (fail-loud)
// ---------------------------------------------------------------------------

describe('tryRegisterFocus — installed-but-broken: import throws non-absence error', () => {
    it('fails loudly when the import throws a SyntaxError (not an absence code)', async () => {
        const importer = importerWith(() => {
            throw new SyntaxError('Unexpected token in focus cli');
        });

        const registry = makeRegistry();
        const sink = makeErrorSink();

        await expect(
            tryRegisterFocus(registry, { error: sink.error, importer }),
        ).rejects.toThrow(SyntaxError);

        expect(sink.messages.length).toBeGreaterThan(0);
        expect(sink.messages[0]).toContain('@sentropic/focus/cli');
        expect(registry.get('focus')).toBeUndefined();
    });

    it('fails loudly when the import throws a generic Error without an absence code', async () => {
        const importer = importerWith(() => {
            throw new Error('Transitive import failure in focus');
        });

        const registry = makeRegistry();
        const sink = makeErrorSink();

        await expect(
            tryRegisterFocus(registry, { error: sink.error, importer }),
        ).rejects.toThrow('Transitive import failure');
        expect(sink.messages.length).toBeGreaterThan(0);
        expect(registry.get('focus')).toBeUndefined();
    });
});

// ---------------------------------------------------------------------------
// Suite 4: installed-but-broken — shape violation (fail-loud)
// ---------------------------------------------------------------------------

describe('tryRegisterFocus — installed-but-broken: shape violation', () => {
    it('fails loudly when the module is missing the run field', async () => {
        const importer = importerWith(() => ({ version: '0.3.0' }));

        const registry = makeRegistry();
        const sink = makeErrorSink();

        await expect(
            tryRegisterFocus(registry, { error: sink.error, importer }),
        ).rejects.toThrow();
        expect(sink.messages.length).toBeGreaterThan(0);
        expect(sink.messages[0]).toContain('Invalid shape');
        expect(registry.get('focus')).toBeUndefined();
    });

    it('fails loudly when the module is missing the version field', async () => {
        const importer = importerWith(() => ({
            run: async (_argv: readonly string[]) => 0,
        }));

        const registry = makeRegistry();
        const sink = makeErrorSink();

        await expect(
            tryRegisterFocus(registry, { error: sink.error, importer }),
        ).rejects.toThrow();
        expect(sink.messages.length).toBeGreaterThan(0);
        expect(registry.get('focus')).toBeUndefined();
    });

    it('fails loudly when the module is null', async () => {
        const importer = importerWith(() => null);

        const registry = makeRegistry();
        const sink = makeErrorSink();

        await expect(
            tryRegisterFocus(registry, { error: sink.error, importer }),
        ).rejects.toThrow();
        expect(sink.messages.length).toBeGreaterThan(0);
        expect(registry.get('focus')).toBeUndefined();
    });
});

// ---------------------------------------------------------------------------
// Suite 5: registry registration failure is fail-loud
// ---------------------------------------------------------------------------

describe('tryRegisterFocus — registration failure is fail-loud', () => {
    it('fails loudly when registry.register throws InvalidSubcommandError (empty version)', async () => {
        const importer = importerWith(() => ({
            run: async (_argv: readonly string[]) => 0,
            version: '', // empty version triggers InvalidSubcommandError in registry.register
        }));

        const registry = makeRegistry();
        const sink = makeErrorSink();

        await expect(
            tryRegisterFocus(registry, { error: sink.error, importer }),
        ).rejects.toThrow(InvalidSubcommandError);
        expect(sink.messages.length).toBeGreaterThan(0);
        expect(sink.messages[0]).toContain('Registration failed');
        expect(registry.get('focus')).toBeUndefined();
    });
});
