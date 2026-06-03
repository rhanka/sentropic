/**
 * `stp app` command-layer public entry point.
 *
 * Exposes the importable orchestration functions (`runInit`, `runDoctor`) + their
 * options/result types + the structured error classes. The umbrella `@sentropic/cli`
 * (lot a2) surfaces these as `stp app <verb>` via {@link runAppCli}.
 */

export {
    parseInitOptions,
    InvalidOptionError,
    VALID_PROVIDERS,
    LLM_MESH_PROVIDERS,
    type InitOptions,
    type GithubVisibility,
} from './options.js';
export {
    validateAppName,
    validateTargetDir,
    InvalidAppNameError,
    InvalidTargetDirError,
    RESERVED_APP_NAMES,
} from './validate.js';
export {
    runInit,
    buildTokens,
    TargetNotEmptyError,
    ExistingRemoteError,
    RepoCollisionError,
    type InitDeps,
    type InitResult,
    type InitTokens,
} from './init.js';
export {
    runDoctor,
    formatDoctorReport,
    MIN_NODE_MAJOR,
    DEFAULT_GENERATED_APP_PORTS,
    type DoctorDeps,
    type DoctorReport,
    type DoctorCheck,
} from './doctor.js';
export {
    nodeProcessRunner,
    renderCommand,
    type ProcessRunner,
    type ProcessCommand,
    type ProcessResult,
} from './process.js';
