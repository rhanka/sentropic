import { describe, expect, it } from 'vitest';
import { runCli, CLI_VERSION } from '../src/cli.js';
import { SubcommandRegistry, type Subcommand } from '../src/registry.js';

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
