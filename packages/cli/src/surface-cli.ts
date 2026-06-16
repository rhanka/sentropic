import { readFile as fsReadFile } from 'node:fs/promises';
import { dirname, isAbsolute, resolve } from 'node:path';
import { buildSurface, type BuildSurfaceDeps } from './surface/build.js';
import { parseAnalysisSurfaceManifest } from './surface/manifest.js';

export interface SurfaceCliDeps extends BuildSurfaceDeps {
    readonly log?: (line: string) => void;
    readonly error?: (line: string) => void;
    readonly readFile?: (path: string) => Promise<string> | string;
    readonly exists?: (path: string) => boolean;
}

export async function runSurfaceCli(
    argv: readonly string[],
    deps: SurfaceCliDeps = {},
): Promise<number> {
    const log = deps.log ?? ((line: string) => console.log(line));
    const error = deps.error ?? ((line: string) => console.error(line));
    const [verb, ...args] = argv;
    const manifestArg = args[0];

    if (verb === undefined || verb === '--help' || verb === '-h') {
        log(formatSurfaceHelp());
        return 0;
    }

    if (verb === 'validate') {
        if (manifestArg === undefined) {
            error('Usage: stp surface validate <manifest>');
            return 1;
        }
        try {
            const manifest = await loadManifest(manifestArg, deps);
            log(
                `AnalysisSurface manifest "${manifest.id}" is valid (${manifest.repos.length} ${plural(
                    manifest.repos.length,
                    'repo',
                    'repos',
                )}).`,
            );
            return 0;
        } catch (err) {
            error(messageOf(err));
            return 1;
        }
    }

    if (verb === 'build') {
        const buildArgs = parseBuildArgs(args);
        if (buildArgs.error !== undefined) {
            error(buildArgs.error);
            return 1;
        }
        if (buildArgs.manifestPath === undefined) {
            error('Usage: stp surface build <manifest> [--refresh]');
            return 1;
        }
        try {
            const manifest = await loadManifest(buildArgs.manifestPath, deps);
            const result = await buildSurface(manifest, {
                runner: deps.runner,
                cwd: deps.cwd,
                graphifyFile: deps.graphifyFile,
                env: deps.env,
                mkdir: deps.mkdir,
                exists: deps.exists,
                readFile: deps.readFile,
                refresh: buildArgs.refresh || deps.refresh,
                writeFile: deps.writeFile,
            });
            log(`Built analysis surface "${manifest.id}" -> ${result.outputPath}`);
            return 0;
        } catch (err) {
            error(messageOf(err));
            return 1;
        }
    }

    error(`Unknown surface command: ${verb}`);
    return 1;
}

function formatSurfaceHelp(): string {
    return [
        'stp surface — build AnalysisSurface graphs from graphify graph.json files',
        '',
        'Usage:',
        '  stp surface build <manifest> [--refresh]',
        '  stp surface validate <manifest>',
        '  stp surface --help | -h',
    ].join('\n');
}

function parseBuildArgs(args: readonly string[]): {
    readonly manifestPath?: string;
    readonly refresh: boolean;
    readonly error?: string;
} {
    let manifestPath: string | undefined;
    let refresh = false;
    for (const arg of args) {
        if (arg === '--refresh') {
            refresh = true;
            continue;
        }
        if (arg.startsWith('-')) {
            return { refresh, error: `Unknown surface build option: ${arg}` };
        }
        if (manifestPath !== undefined) {
            return { refresh, error: `Unexpected surface build argument: ${arg}` };
        }
        manifestPath = arg;
    }
    return manifestPath === undefined ? { refresh } : { manifestPath, refresh };
}

async function loadManifest(path: string, deps: SurfaceCliDeps) {
    const cwd = deps.cwd ?? process.cwd();
    const manifestPath = isAbsolute(path) ? path : resolve(cwd, path);
    const readFile = deps.readFile ?? ((p: string) => fsReadFile(p, 'utf8'));
    const source = await readFile(manifestPath);
    return parseAnalysisSurfaceManifest(source, {
        baseDir: dirname(manifestPath),
        exists: deps.exists,
    });
}

function plural(count: number, singular: string, pluralValue: string): string {
    return count === 1 ? singular : pluralValue;
}

function messageOf(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
}
