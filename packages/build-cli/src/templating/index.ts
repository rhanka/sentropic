/**
 * Templating substrate public entry point.
 *
 * Dependency-light, pure, deterministic `{{token}}` substitution + scaffold-manifest
 * types, behind an interface designed for later `@sentropic/harness` adoption (R5).
 */

export type {
    TokenMap,
    ContentTransform,
    ManifestEntry,
    ScaffoldManifest,
    TemplateRenderer,
} from './types.js';
export { MissingTokenError } from './types.js';
export { substitute, extractTokens, defaultRenderer } from './substitute.js';
