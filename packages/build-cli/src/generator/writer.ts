/**
 * Thin filesystem writer for a resolved {@link ScaffoldPlan}.
 *
 * The planner stays pure; this is the only place the generator touches the filesystem.
 * It enforces the **no-partial-write** invariant (SPEC §6.1 #2): the whole plan is
 * validated up front and, unless `overwrite` is set, the writer refuses (before writing
 * anything) if any target file already exists. Output paths are confined to `targetDir`
 * — a path that escapes the target (via `..` or an absolute segment) aborts the entire
 * run before the first byte is written.
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, sep } from 'node:path';
import type { PlannedFile, ScaffoldPlan } from './types.js';

/** Options for materialising a plan onto disk. */
export interface WritePlanOptions {
    /** Absolute target directory the scaffold is materialised into. */
    readonly targetDir: string;
    /** When true, existing scaffold-owned files are overwritten; otherwise a clash aborts. */
    readonly overwrite?: boolean;
    /** Default file mode when a planned file does not specify one. */
    readonly defaultMode?: number;
}

/** Error thrown when a planned output path would escape the target directory. */
export class PathEscapeError extends Error {
    readonly outputPath: string;
    constructor(outputPath: string) {
        super(`Output path escapes target directory: ${outputPath}`);
        this.name = 'PathEscapeError';
        this.outputPath = outputPath;
    }
}

/** Error thrown when a target file already exists and `overwrite` is not set. */
export class TargetExistsError extends Error {
    readonly paths: readonly string[];
    constructor(paths: readonly string[]) {
        super(`Refusing to overwrite existing file(s): ${paths.join(', ')}`);
        this.name = 'TargetExistsError';
        this.paths = paths;
    }
}

/** Resolve a planned path against the target dir, rejecting any escape. */
function resolveSafe(targetDir: string, outputPath: string): string {
    if (isAbsolute(outputPath)) {
        throw new PathEscapeError(outputPath);
    }
    const resolved = join(targetDir, outputPath);
    const rel = relative(targetDir, resolved);
    if (rel === '' || rel.startsWith('..') || rel.startsWith(`..${sep}`)) {
        throw new PathEscapeError(outputPath);
    }
    return resolved;
}

/**
 * Materialise `plan` into `targetDir`.
 *
 * Validation (path-escape + existing-file checks) runs over the whole plan first; only
 * after every file passes does the writer create directories and write content. This
 * guarantees no partial scaffold is left behind on a precondition failure.
 *
 * @returns the absolute paths written, in plan order.
 */
export async function writePlan(
    plan: ScaffoldPlan,
    options: WritePlanOptions,
): Promise<string[]> {
    const { targetDir, overwrite = false, defaultMode } = options;

    const resolved = plan.files.map((file): { file: PlannedFile; absPath: string } => ({
        file,
        absPath: resolveSafe(targetDir, file.outputPath),
    }));

    if (!overwrite) {
        const clashes = resolved.filter((r) => existsSync(r.absPath)).map((r) => r.file.outputPath);
        if (clashes.length > 0) {
            throw new TargetExistsError(clashes.sort());
        }
    }

    const written: string[] = [];
    for (const { file, absPath } of resolved) {
        await mkdir(dirname(absPath), { recursive: true });
        const mode = file.mode ?? defaultMode;
        await writeFile(absPath, file.content, mode === undefined ? undefined : { mode });
        written.push(absPath);
    }
    return written;
}
