/**
 * Lot 0 — 0-regression characterization oracle (BR-42i).
 *
 * Pins the byte-identical stdout/stderr output of `stp --help`, `stp --version`,
 * and `stp <unknown>` BEFORE any new code is added. These fixtures define the
 * baseline that Lots 1/2/3 must keep unchanged when no verbRegistry or federation
 * plugins are present.
 *
 * The registration mirrors `bin/stp.mjs` exactly:
 *   name: 'app', summary: (real bin summary), version: BUILD_CLI_VERSION ('0.3.0')
 * so the pinned text is byte-identical to what `stp` would print.
 */

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { runCli, CLI_VERSION } from '../src/cli.js';
import { SubcommandRegistry } from '../src/registry.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixture = (name: string) =>
    readFileSync(join(__dirname, '__fixtures__', name), 'utf-8').trimEnd();

/** Mirror the exact registration in bin/stp.mjs (the composition root). */
function buildBinLikeRegistry(): SubcommandRegistry {
    const registry = new SubcommandRegistry();
    registry.register({
        name: 'app',
        summary: 'Scaffold and operate a runnable @sentropic chat application (init, doctor).',
        // BUILD_CLI_VERSION from @sentropic/build-cli — pinned at 0.3.0 for the oracle
        version: '0.3.0',
        run: async () => 0,
    });
    registry.register({
        name: 'surface',
        summary: 'Build multi-repo analysis surfaces from graphify graph.json files.',
        version: '0.5.0',
        run: async () => 0,
    });
    return registry;
}

describe('Lot 0 characterization — stp output oracle', () => {
    it('stp --help output is byte-identical to fixture (0-regression baseline)', async () => {
        const out: string[] = [];
        const deps = { log: (l: string) => out.push(l), error: () => {} };

        const code = await runCli(['--help'], buildBinLikeRegistry(), deps);
        expect(code).toBe(0);
        const actual = out.join('\n').trimEnd();
        expect(actual).toBe(fixture('stp-help.txt'));
    });

    it('stp -h output is byte-identical to stp --help (alias parity)', async () => {
        const out: string[] = [];
        const deps = { log: (l: string) => out.push(l), error: () => {} };

        const code = await runCli(['-h'], buildBinLikeRegistry(), deps);
        expect(code).toBe(0);
        const actual = out.join('\n').trimEnd();
        expect(actual).toBe(fixture('stp-help.txt'));
    });

    it('stp (bare) output is byte-identical to stp --help (bare invocation = help)', async () => {
        const out: string[] = [];
        const deps = { log: (l: string) => out.push(l), error: () => {} };

        const code = await runCli([], buildBinLikeRegistry(), deps);
        expect(code).toBe(0);
        const actual = out.join('\n').trimEnd();
        expect(actual).toBe(fixture('stp-help.txt'));
    });

    it('stp --version output is byte-identical to fixture (0-regression baseline)', async () => {
        const out: string[] = [];
        const deps = { log: (l: string) => out.push(l), error: () => {} };

        const code = await runCli(['--version'], buildBinLikeRegistry(), deps);
        expect(code).toBe(0);
        const actual = out.join('\n').trimEnd();
        expect(actual).toBe(fixture('stp-version.txt'));
        // Explicit sub-assertions for legibility in CI output
        expect(actual).toContain(`stp ${CLI_VERSION}`);
        expect(actual).toContain('app 0.3.0');
        expect(actual).toContain('surface 0.5.0');
    });

    it('stp -v output is byte-identical to stp --version (alias parity)', async () => {
        const out: string[] = [];
        const deps = { log: (l: string) => out.push(l), error: () => {} };

        const code = await runCli(['-v'], buildBinLikeRegistry(), deps);
        expect(code).toBe(0);
        const actual = out.join('\n').trimEnd();
        expect(actual).toBe(fixture('stp-version.txt'));
    });

    it('stp bogus stderr output is byte-identical to fixture (unknown-subcommand 0-regression baseline)', async () => {
        const err: string[] = [];
        const deps = { log: () => {}, error: (l: string) => err.push(l) };

        const code = await runCli(['bogus'], buildBinLikeRegistry(), deps);
        expect(code).toBe(1);
        const actual = err.join('\n').trimEnd();
        expect(actual).toBe(fixture('stp-unknown.txt'));
    });

    it('stp app (subcommand delegation) returns 0 and does not print help/version (0-regression)', async () => {
        const out: string[] = [];
        const err: string[] = [];
        let appArgv: readonly string[] | undefined;
        const registry = new SubcommandRegistry();
        registry.register({
            name: 'app',
            summary: 'Scaffold and operate a runnable @sentropic chat application (init, doctor).',
            version: '0.3.0',
            run: async (argv) => {
                appArgv = argv;
                return 0;
            },
        });
        const deps = { log: (l: string) => out.push(l), error: (l: string) => err.push(l) };

        const code = await runCli(['app', 'init', 'demo'], registry, deps);
        expect(code).toBe(0);
        expect(appArgv).toEqual(['init', 'demo']);
        // runCli must NOT emit help/version text when delegating
        expect(out).toHaveLength(0);
        expect(err).toHaveLength(0);
    });

    it('CLI_VERSION is the post-bump baseline 0.5.0 (version bump, not a regression)', () => {
        expect(CLI_VERSION).toBe('0.5.0');
    });
});
