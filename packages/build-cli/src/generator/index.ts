/**
 * Generator core public entry point.
 *
 * The planner (`resolvePlan`) is pure and deterministic (R10). The writer (`writePlan`)
 * is the only filesystem-touching part and enforces no-partial-write semantics.
 */

export type {
    GeneratorOptions,
    PlannedFile,
    ScaffoldPlan,
} from './types.js';
export { DuplicateOutputPathError } from './types.js';
export { resolvePlan } from './plan.js';
export {
    writePlan,
    PathEscapeError,
    TargetExistsError,
    type WritePlanOptions,
} from './writer.js';
