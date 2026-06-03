/**
 * Name + target-directory validation for `stp app init`.
 *
 * The app name becomes the npm package name, the compose project name, and a path
 * segment (`./<name>` default dir), so it must be a strict, lowercase, DNS/slug-safe
 * token with no path semantics. The `--dir` value is validated separately for path
 * traversal (SPEC §6.1 #8: reject `../` and absolute escapes is the writer's job, but
 * the CLI rejects obviously-hostile dirs up front with an actionable message).
 */

/** Error thrown when an app name fails the slug rules. */
export class InvalidAppNameError extends Error {
    readonly appName: string;
    constructor(appName: string, reason: string) {
        super(`Invalid app name "${appName}": ${reason}`);
        this.name = 'InvalidAppNameError';
        this.appName = appName;
    }
}

/** Error thrown when a target directory is itself hostile (traversal / absolute escape). */
export class InvalidTargetDirError extends Error {
    readonly dir: string;
    constructor(dir: string, reason: string) {
        super(`Invalid target directory "${dir}": ${reason}`);
        this.name = 'InvalidTargetDirError';
        this.dir = dir;
    }
}

/**
 * Reserved names that must never be used as an app name — they collide with OS/npm
 * semantics or would produce a nonsensical scaffold.
 */
export const RESERVED_APP_NAMES: ReadonlySet<string> = new Set([
    'node_modules',
    'favicon.ico',
    '.',
    '..',
    'con',
    'prn',
    'aux',
    'nul',
    'test',
    'package',
]);

/** A valid app slug: lowercase alnum, internal single hyphens, 1..64 chars. */
const APP_NAME_PATTERN = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;

/**
 * Validate an app name against the slug rules.
 *
 * @throws {InvalidAppNameError} when the name is empty/whitespace, not a slug, too long,
 *   reserved, or contains path separators.
 */
export function validateAppName(rawName: string): string {
    if (typeof rawName !== 'string' || rawName.trim().length === 0) {
        throw new InvalidAppNameError(String(rawName), 'must be a non-empty, non-whitespace string');
    }
    // No leading/trailing whitespace tolerated (the name is a durable identifier).
    if (rawName !== rawName.trim()) {
        throw new InvalidAppNameError(rawName, 'must not contain leading or trailing whitespace');
    }
    if (rawName.includes('/') || rawName.includes('\\')) {
        throw new InvalidAppNameError(rawName, 'must not contain path separators');
    }
    if (rawName.includes('..')) {
        throw new InvalidAppNameError(rawName, 'must not contain ".."');
    }
    if (rawName.length > 64) {
        throw new InvalidAppNameError(rawName, 'must be at most 64 characters');
    }
    if (!APP_NAME_PATTERN.test(rawName)) {
        throw new InvalidAppNameError(
            rawName,
            'must be a lowercase slug (a-z, 0-9, internal hyphens; no leading/trailing/double hyphen)',
        );
    }
    if (rawName.includes('--')) {
        throw new InvalidAppNameError(rawName, 'must not contain consecutive hyphens');
    }
    if (RESERVED_APP_NAMES.has(rawName.toLowerCase())) {
        throw new InvalidAppNameError(rawName, 'is a reserved name');
    }
    return rawName;
}

/**
 * Validate a user-supplied `--dir` for obvious traversal/absolute hostility BEFORE it is
 * resolved. (The writer additionally confines every planned path inside the resolved
 * target, but a hostile `--dir` should fail fast with a clear message.)
 *
 * Note: an absolute `--dir` is permitted (the user may scaffold to an absolute path); a
 * traversal segment (`..`) is rejected because it signals an attempt to escape the
 * intended location.
 *
 * @throws {InvalidTargetDirError} when the dir contains a `..` traversal segment.
 */
export function validateTargetDir(rawDir: string): string {
    if (typeof rawDir !== 'string' || rawDir.length === 0) {
        throw new InvalidTargetDirError(String(rawDir), 'must be a non-empty string');
    }
    const segments = rawDir.split(/[\\/]+/);
    if (segments.includes('..')) {
        throw new InvalidTargetDirError(rawDir, 'must not contain a ".." traversal segment');
    }
    return rawDir;
}
