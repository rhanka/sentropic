/**
 * Cowork desktop API base URL resolution.
 *
 * Precedence: runtime env `SENTROPIC_API_BASE_URL` > build-time default.
 * The build-time default is the deployed Sentropic API (single host: the UI
 * image nginx proxies `/api` -> `api:8787`). Packaging MAY override the default
 * via an esbuild `define` of `__COWORK_DEFAULT_API_BASE_URL__` for other
 * deployments; the `typeof` guard keeps the plain `tsc` (dist) build safe when
 * the identifier is not defined.
 */

declare const __COWORK_DEFAULT_API_BASE_URL__: string | undefined;

/** Deployed single-host API base. */
export const DEFAULT_API_BASE_URL =
    typeof __COWORK_DEFAULT_API_BASE_URL__ !== 'undefined' && __COWORK_DEFAULT_API_BASE_URL__
        ? __COWORK_DEFAULT_API_BASE_URL__
        : 'https://sentropic.sent-tech.ca/api/v1';

/**
 * Resolve the API base URL.
 * An explicit, non-blank `SENTROPIC_API_BASE_URL` env wins; otherwise the baked
 * default is used (so the binary works with zero configuration).
 */
export function resolveApiBaseUrl(env: NodeJS.ProcessEnv = process.env): string {
    const override = (env.SENTROPIC_API_BASE_URL ?? '').trim();
    return override || DEFAULT_API_BASE_URL;
}
