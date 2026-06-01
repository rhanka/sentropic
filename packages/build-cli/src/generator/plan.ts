/**
 * Pure scaffold planner (R10 invariant).
 *
 * `resolvePlan` walks a `ScaffoldManifest` in declaration order and, for each entry:
 *   1. substitutes tokens into the output path,
 *   2. substitutes tokens into the content,
 *   3. applies the entry's transforms in order.
 *
 * It does NOT touch the filesystem, clock, randomness, or environment, so identical
 * inputs always produce a byte-identical plan. Two entries resolving to the same output
 * path is a manifest bug and fails loudly (`DuplicateOutputPathError`) rather than
 * silently letting later entries win (which would be order-fragile).
 */

import { defaultRenderer } from '../templating/substitute.js';
import type { ScaffoldManifest } from '../templating/types.js';
import {
    DuplicateOutputPathError,
    type GeneratorOptions,
    type PlannedFile,
    type ScaffoldPlan,
} from './types.js';

/**
 * Resolve a deterministic {@link ScaffoldPlan} from a manifest and options.
 *
 * @throws {MissingTokenError} when any path/content references an unknown token.
 * @throws {DuplicateOutputPathError} when two entries resolve to the same output path.
 */
export function resolvePlan(
    manifest: ScaffoldManifest,
    options: GeneratorOptions,
): ScaffoldPlan {
    const renderer = options.renderer ?? defaultRenderer;
    const { tokens } = options;
    const files: PlannedFile[] = [];
    const seen = new Set<string>();

    for (const entry of manifest.entries) {
        const outputPath = renderer.render(entry.outputPath, tokens);
        if (seen.has(outputPath)) {
            throw new DuplicateOutputPathError(outputPath);
        }
        seen.add(outputPath);

        let content = renderer.render(entry.content, tokens);
        for (const transform of entry.transforms ?? []) {
            content = transform(content);
        }

        files.push(
            entry.mode === undefined
                ? { outputPath, content }
                : { outputPath, content, mode: entry.mode },
        );
    }

    return { files };
}
