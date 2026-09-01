import { describe, expect, it } from 'vitest';
import { runCli, CLI_VERSION } from '../src/cli.js';
import { SubcommandRegistry, type Subcommand } from '../src/registry.js';
import { VerbRegistry } from '../src/verb-registry.js';
import { sentropicCliCommandIntentAdapter } from '../src/command-intent.js';

/** Capture log/error output so we can assert on rendered help/version/error text. */
function capture() {
    const out: string[] = [];
    const err: string[] = [];
    return {
        deps: { log: (l: string) => out.push(l), error: (l: string) => err.push(l) },
        out,
        err,
    };
}

/**
 * Build a registry with `app` backed by a stubbed `runAppCli` (the launch packet allows a
 * stub instead of importing `@sentropic/build-cli`, keeping these tests pure-Node).
 */
function registryWithApp(runAppCli: (argv: readonly string[]) => Promise<number>): {
    registry: SubcommandRegistry;
    appCalls: (readonly string[])[];
} {
    const appCalls: (readonly string[])[] = [];
    const app: Subcommand = {
        name: 'app',
        summary: 'Scaffold and operate a chat app.',
        version: '0.2.0',
        run: (argv) => {
            appCalls.push(argv);
            return runAppCli(argv);
        },
    };
    return { registry: new SubcommandRegistry().register(app), appCalls };
}

describe('runCli', () => {
    it('projects an app command intent without dispatching it', () => {
        expect(sentropicCliCommandIntentAdapter.parseIntent(['app', 'doctor'])).toEqual({
            runnerId: 'sentropic-cli', source: '@sentropic/cli', argv: ['app', 'doctor'],
        });
    });

    it('prints the CLI version plus each registered subcommand version', async () => {
        const { registry } = registryWithApp(async () => 0);
        const { deps, out } = capture();

        const code = await runCli(['--version'], registry, deps);
        expect(code).toBe(0);
        const text = out.join('\n');
        expect(text).toContain(`stp ${CLI_VERSION}`);
        expect(text).toContain('app 0.2.0');

        // `-v` is an alias for `--version`.
        const short = capture();
        expect(await runCli(['-v'], registry, short.deps)).toBe(0);
        expect(short.out.join('\n')).toContain(`stp ${CLI_VERSION}`);
    });

    it('lists registered subcommands in --help (and -h, and bare invocation)', async () => {
        const { registry } = registryWithApp(async () => 0);
        for (const argv of [['--help'], ['-h'], []]) {
            const { deps, out } = capture();
            const code = await runCli(argv, registry, deps);
            expect(code).toBe(0);
            const text = out.join('\n');
            expect(text).toContain('app');
            expect(text).toContain('Scaffold and operate a chat app.');
        }
    });

    it('fails with a non-zero code and lists available subcommands on an unknown subcommand', async () => {
        const { registry } = registryWithApp(async () => 0);
        const { deps, err } = capture();

        const code = await runCli(['bogus', 'init'], registry, deps);
        expect(code).toBe(1);
        const text = err.join('\n');
        expect(text).toContain('Unknown subcommand: bogus');
        expect(text).toContain('app');
    });

    it('delegates `app ...` to runAppCli with the remaining argv and returns its exit code', async () => {
        const { registry, appCalls } = registryWithApp(async (argv) =>
            argv.includes('--fail') ? 7 : 0,
        );

        expect(await runCli(['app', 'init', 'demo'], registry)).toBe(0);
        expect(appCalls).toContainEqual(['init', 'demo']);

        expect(await runCli(['app', 'doctor'], registry)).toBe(0);
        expect(appCalls).toContainEqual(['doctor']);

        // A non-zero exit from the subcommand propagates unchanged.
        expect(await runCli(['app', '--fail'], registry)).toBe(7);
    });
});

// ---------------------------------------------------------------------------
// BR-42i: verb-registry dispatch (additive — 0-regression on all prior cases)
// ---------------------------------------------------------------------------

describe('runCli — verb-registry dispatch (BR-42i)', () => {
    /**
     * Build a registry with a stub `track` subcommand that records calls.
     * Returns both the registry and a call-capture array.
     */
    function registryWithTrack(exitCode = 0): {
        registry: SubcommandRegistry;
        trackCalls: (readonly string[])[];
    } {
        const trackCalls: (readonly string[])[] = [];
        const track: Subcommand = {
            name: 'track',
            summary: 'Time-tracking subcommand.',
            version: '0.1.0',
            run: (argv) => {
                trackCalls.push(argv);
                return Promise.resolve(exitCode);
            },
        };
        return { registry: new SubcommandRegistry().register(track), trackCalls };
    }

    it('dispatches `stp report` to track.run(["report"]) when verbRegistry maps report→track', async () => {
        const { registry, trackCalls } = registryWithTrack(0);
        const verbRegistry = new VerbRegistry();
        verbRegistry.register({ verb: 'report', ownerCli: 'track', ownerArgv: ['report'] });

        const { deps, out, err } = capture();
        const code = await runCli(['report'], registry, { ...deps, verbRegistry });

        expect(code).toBe(0);
        expect(trackCalls).toHaveLength(1);
        expect(trackCalls[0]).toEqual(['report']);
        // runCli must not emit help/error text when delegating
        expect(out).toHaveLength(0);
        expect(err).toHaveLength(0);
    });

    it('forwards extra rest args: `stp report --csv` → track.run(["report", "--csv"])', async () => {
        const { registry, trackCalls } = registryWithTrack(0);
        const verbRegistry = new VerbRegistry();
        verbRegistry.register({ verb: 'report', ownerCli: 'track', ownerArgv: ['report'] });

        await runCli(['report', '--csv'], registry, { verbRegistry });

        expect(trackCalls[0]).toEqual(['report', '--csv']);
    });

    it('propagates non-zero exit code from the owner subcommand', async () => {
        const { registry } = registryWithTrack(42);
        const verbRegistry = new VerbRegistry();
        verbRegistry.register({ verb: 'report', ownerCli: 'track', ownerArgv: ['report'] });

        const code = await runCli(['report'], registry, { verbRegistry });
        expect(code).toBe(42);
    });

    it('falls through to formatUnknown when binding exists but ownerCli is NOT in registry', async () => {
        // Only `app` is in the registry; `track` is NOT registered.
        const { registry } = registryWithApp(async () => 0);
        const verbRegistry = new VerbRegistry();
        verbRegistry.register({ verb: 'report', ownerCli: 'track', ownerArgv: ['report'] });

        const { deps, err } = capture();
        const code = await runCli(['report'], registry, { ...deps, verbRegistry });

        expect(code).toBe(1);
        const text = err.join('\n');
        expect(text).toContain('Unknown subcommand: report');
        expect(text).toContain('app');
    });

    it('`stp app --help` with verbRegistry present behaves identically to without (0-regression)', async () => {
        const { registry, appCalls } = registryWithApp(async () => 0);
        const verbRegistry = new VerbRegistry();
        verbRegistry.register({ verb: 'report', ownerCli: 'track', ownerArgv: ['report'] });

        // With verbRegistry
        const withVR = capture();
        const codeWith = await runCli(['app', '--help'], registry, { ...withVR.deps, verbRegistry });

        // Without verbRegistry (baseline)
        const { registry: registry2, appCalls: appCalls2 } = registryWithApp(async () => 0);
        const withoutVR = capture();
        const codeWithout = await runCli(['app', '--help'], registry2, withoutVR.deps);

        expect(codeWith).toBe(codeWithout);
        // `--help` is forwarded to the subcommand, not consumed by runCli
        expect(appCalls).toContainEqual(['--help']);
        expect(appCalls2).toContainEqual(['--help']);
    });

    it('existing no-verbRegistry dispatch cases are byte-identical (0-regression)', async () => {
        // Mirrors the existing tests from the `runCli` describe block above, but with a
        // VerbRegistry present, to prove `verbRegistry` is truly additive.
        const verbRegistry = new VerbRegistry();
        verbRegistry.register({ verb: 'report', ownerCli: 'track', ownerArgv: ['report'] });

        const { registry } = registryWithApp(async () => 0);

        // --version still works
        const v = capture();
        expect(await runCli(['--version'], registry, { ...v.deps, verbRegistry })).toBe(0);
        expect(v.out.join('\n')).toContain(`stp ${CLI_VERSION}`);

        // --help still works
        const h = capture();
        expect(await runCli(['--help'], registry, { ...h.deps, verbRegistry })).toBe(0);
        expect(h.out.join('\n')).toContain('app');

        // bogus still triggers formatUnknown
        const b = capture();
        expect(await runCli(['bogus'], registry, { ...b.deps, verbRegistry })).toBe(1);
        expect(b.err.join('\n')).toContain('Unknown subcommand: bogus');
    });
});
