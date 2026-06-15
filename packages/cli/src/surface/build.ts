import { spawn } from 'node:child_process';
import { mkdir as fsMkdir, writeFile as fsWriteFile } from 'node:fs/promises';
import { join } from 'node:path';
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

export interface SurfaceGraph {
    readonly id: string;
    readonly repos: AnalysisSurfaceManifest['repos'];
    readonly options?: Readonly<Record<string, unknown>>;
    readonly nodes: readonly unknown[];
    readonly edges: readonly unknown[];
}

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

interface ParsedFragment {
    readonly nodes: readonly unknown[];
    readonly edges: readonly unknown[];
}

export async function buildSurface(
    manifest: AnalysisSurfaceManifest,
    deps: BuildSurfaceDeps = {},
): Promise<SurfaceBuildResult> {
    const runner = deps.runner ?? nodeProcessRunner;
    const graphifyFile = deps.graphifyFile ?? 'graphify';
    const cwd = deps.cwd ?? process.cwd();
    const mkdir = deps.mkdir ?? ((path: string) => fsMkdir(path, { recursive: true }).then(() => {}));
    const writeFile = deps.writeFile ?? fsWriteFile;

    const fragments: ParsedFragment[] = [];
    for (const repo of manifest.repos) {
        const command: ProcessCommand = {
            file: graphifyFile,
            args: graphifyArgs(manifest, repo),
            cwd: repo.path,
            env: deps.env,
        };
        const result = await runner.run(command);
        if (result.code !== 0) {
            const reason = result.stderr.trim() || result.stdout.trim() || 'no stderr';
            throw new SurfaceBuildError(
                `graphify build failed for ${repo.path} (exit ${String(result.code)}): ${reason}`,
            );
        }
        fragments.push(parseFragment(result.stdout, repo.path));
    }

    const graph = mergeFragments(manifest, fragments);
    const outputDir = join(cwd, '.stp', 'surfaces', manifest.id);
    const outputPath = join(outputDir, 'graph.json');
    await mkdir(outputDir);
    await writeFile(outputPath, `${JSON.stringify(graph, null, 2)}\n`);
    return { outputPath, graph };
}

function graphifyArgs(
    manifest: AnalysisSurfaceManifest,
    repo: AnalysisSurfaceManifest['repos'][number],
): string[] {
    const args = ['build', '--fragment'];
    if (repo.branch !== undefined) {
        args.push('--branch', repo.branch);
    }
    if (repo.window !== undefined) {
        args.push('--window', repo.window);
    }
    if (manifest.options !== undefined) {
        args.push('--options', JSON.stringify(manifest.options));
    }
    return args;
}

function parseFragment(stdout: string, repoPath: string): ParsedFragment {
    const text = stdout.trim();
    if (text === '') {
        throw new SurfaceBuildError(`graphify emitted an empty fragment for ${repoPath}.`);
    }

    let parsed: unknown;
    try {
        parsed = JSON.parse(text) as unknown;
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        throw new SurfaceBuildError(`Invalid graphify fragment JSON for ${repoPath}: ${message}`);
    }

    const fragment = extractFragmentObject(parsed);
    const nodes = fragment['nodes'];
    const edges = fragment['edges'];
    if (nodes !== undefined && !Array.isArray(nodes)) {
        throw new SurfaceBuildError(`Invalid graphify fragment for ${repoPath}: nodes must be an array.`);
    }
    if (edges !== undefined && !Array.isArray(edges)) {
        throw new SurfaceBuildError(`Invalid graphify fragment for ${repoPath}: edges must be an array.`);
    }
    return {
        nodes: nodes ?? [],
        edges: edges ?? [],
    };
}

function extractFragmentObject(parsed: unknown): Record<string, unknown> {
    if (!isRecord(parsed)) {
        throw new SurfaceBuildError('graphify fragment JSON must be an object.');
    }
    const extraction = parsed['extraction'];
    if (isRecord(extraction)) {
        return extraction;
    }
    return parsed;
}

function mergeFragments(
    manifest: AnalysisSurfaceManifest,
    fragments: readonly ParsedFragment[],
): SurfaceGraph {
    const graph: {
        id: string;
        repos: AnalysisSurfaceManifest['repos'];
        options?: Readonly<Record<string, unknown>>;
        nodes: readonly unknown[];
        edges: readonly unknown[];
    } = {
        id: manifest.id,
        repos: manifest.repos,
        nodes: dedupeById(fragments.flatMap((fragment) => fragment.nodes)),
        edges: dedupeById(fragments.flatMap((fragment) => fragment.edges)),
    };
    if (manifest.options !== undefined) {
        graph.options = manifest.options;
    }
    return graph;
}

function dedupeById(items: readonly unknown[]): unknown[] {
    const seen = new Set<string>();
    const deduped: unknown[] = [];
    for (const item of items) {
        const id = itemId(item);
        if (id !== undefined) {
            if (seen.has(id)) {
                continue;
            }
            seen.add(id);
        }
        deduped.push(item);
    }
    return deduped;
}

function itemId(item: unknown): string | undefined {
    if (!isRecord(item)) {
        return undefined;
    }
    const id = item['id'];
    if (typeof id === 'string' || typeof id === 'number') {
        return String(id);
    }
    return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}
