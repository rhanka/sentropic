import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir as fsMkdir, readFile as fsReadFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import type { AnalysisSurfaceManifest } from './manifest.js';

export interface ProcessCommand {
    readonly file: string;
    readonly args: readonly string[];
    readonly cwd?: string;
    readonly env?: Readonly<Record<string, string>>;
}

export interface ProcessResult {
    readonly code: number | null;
    readonly stdout: string;
    readonly stderr: string;
}

export interface ProcessRunner {
    run(command: ProcessCommand): Promise<ProcessResult>;
}

export type SurfaceGraph = Readonly<Record<string, unknown>>;

export interface SurfaceBuildResult {
    readonly outputPath: string;
    readonly graph: SurfaceGraph;
}

export interface BuildSurfaceDeps {
    readonly runner?: ProcessRunner;
    readonly cwd?: string;
    readonly graphifyFile?: string;
    readonly env?: Readonly<Record<string, string>>;
    readonly mkdir?: (path: string) => Promise<void> | void;
    readonly exists?: (path: string) => boolean;
    readonly readFile?: (path: string) => Promise<string> | string;
    readonly refresh?: boolean;
    readonly writeFile?: (path: string, data: string) => Promise<void> | void;
}

export class SurfaceBuildError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'SurfaceBuildError';
    }
}

export const nodeProcessRunner: ProcessRunner = {
    run(command: ProcessCommand): Promise<ProcessResult> {
        return new Promise<ProcessResult>((resolve, reject) => {
            const child = spawn(command.file, [...command.args], {
                cwd: command.cwd,
                env: command.env ? { ...process.env, ...command.env } : process.env,
                stdio: ['ignore', 'pipe', 'pipe'],
            });
            let stdout = '';
            let stderr = '';
            child.stdout?.on('data', (chunk: Buffer) => {
                stdout += chunk.toString('utf8');
            });
            child.stderr?.on('data', (chunk: Buffer) => {
                stderr += chunk.toString('utf8');
            });
            child.on('error', reject);
            child.on('close', (code) => {
                resolve({ code, stdout, stderr });
            });
        });
    },
};

export async function buildSurface(
    manifest: AnalysisSurfaceManifest,
    deps: BuildSurfaceDeps = {},
): Promise<SurfaceBuildResult> {
    const runner = deps.runner ?? nodeProcessRunner;
    const graphifyFile = deps.graphifyFile ?? 'graphify';
    const cwd = deps.cwd ?? process.cwd();
    const mkdir = deps.mkdir ?? ((path: string) => fsMkdir(path, { recursive: true }).then(() => {}));
    const exists = deps.exists ?? existsSync;
    const readFile = deps.readFile ?? ((path: string) => fsReadFile(path, 'utf8'));
    const refresh = shouldRefresh(manifest, deps);

    // branch/window stay manifest metadata. graphify update owns repo refresh
    // semantics; merge-graphs accepts only graph.json inputs and --out.
    if (refresh) {
        for (const repo of manifest.repos) {
            const result = await runner.run({
                file: graphifyFile,
                args: ['update', repo.path],
                cwd,
                env: deps.env,
            });
            if (result.code !== 0) {
                const reason = result.stderr.trim() || result.stdout.trim() || 'no stderr';
                throw new SurfaceBuildError(
                    `graphify update failed for ${repo.path} (exit ${String(result.code)}): ${reason}`,
                );
            }
        }
    }

    const graphPaths = manifest.repos.map((repo) => ({
        repoPath: repo.path,
        graphPath: resolveGraphJsonPath(repo.path),
    }));
    for (const { repoPath, graphPath } of graphPaths) {
        if (!exists(graphPath)) {
            throw new SurfaceBuildError(
                `Missing graphify graph for ${repoPath}: expected ${graphPath}. Run graphify on this repository first, or rebuild with refresh enabled.`,
            );
        }
    }

    const outputDir = join(cwd, '.stp', 'surfaces', manifest.id);
    const outputPath = join(outputDir, 'graph.json');
    await mkdir(outputDir);

    const result = await runner.run({
        file: graphifyFile,
        args: ['merge-graphs', ...graphPaths.map((graph) => graph.graphPath), '--out', outputPath],
        cwd,
        env: deps.env,
    });
    if (result.code !== 0) {
        const reason = result.stderr.trim() || result.stdout.trim() || 'no stderr';
        throw new SurfaceBuildError(
            `graphify merge-graphs failed (exit ${String(result.code)}): ${reason}`,
        );
    }

    const graph = parseMergedGraph(await readFile(outputPath), outputPath);
    return { outputPath, graph };
}

function shouldRefresh(manifest: AnalysisSurfaceManifest, deps: BuildSurfaceDeps): boolean {
    return deps.refresh === true || manifest.options?.['refresh'] === true;
}

function resolveGraphJsonPath(path: string): string {
    const name = basename(path);
    if (name === 'graph.json') {
        return path;
    }
    if (name === '.graphify') {
        return join(path, 'graph.json');
    }
    return join(path, '.graphify', 'graph.json');
}

function parseMergedGraph(source: string, outputPath: string): SurfaceGraph {
    const text = source.trim();
    if (text === '') {
        throw new SurfaceBuildError(`graphify merge-graphs wrote an empty graph file: ${outputPath}`);
    }

    let parsed: unknown;
    try {
        parsed = JSON.parse(text) as unknown;
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        throw new SurfaceBuildError(`Invalid graphify merged graph JSON at ${outputPath}: ${message}`);
    }

    if (!isRecord(parsed)) {
        throw new SurfaceBuildError(`graphify merged graph JSON at ${outputPath} must be an object.`);
    }
    return parsed;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}
