/**
 * Derive the Sentropic web app origin + build the device-pairing URL.
 *
 * The headless binary never sends an `Origin` header, so the server's
 * `verification_uri` degrades to a host-less path. Instead the binary derives
 * the app origin from its own (trusted) API base URL — or an explicit
 * `SENTROPIC_APP_ORIGIN` override — and builds a full, clickable pairing URL.
 *
 * Trust boundary: the source is always trusted config (baked default or an
 * operator-set env), never remote input. We still hard-validate the result
 * before printing/opening it (https — or http only for localhost — no embedded
 * credentials, no injected path/query) so a sloppy env value can't open
 * something surprising.
 */

import { resolveApiBaseUrl } from './api-base-url.js';

/** Known API path prefixes to strip when deriving the app origin from the API base. */
const API_PATH_PREFIXES = ['/api/v1', '/api'];

const stripTrailingSlashes = (path: string): string => path.replace(/\/+$/, '');

const assertSafeOrigin = (u: URL, source: string): void => {
    if (u.username || u.password) {
        throw new Error(`app origin must not contain credentials: ${source}`);
    }
    const isHttps = u.protocol === 'https:';
    const isLocalHttp =
        u.protocol === 'http:' && (u.hostname === 'localhost' || u.hostname === '127.0.0.1');
    if (!isHttps && !isLocalHttp) {
        throw new Error(`app origin must be https (or http on localhost): ${source}`);
    }
};

/**
 * Derive the web app origin+base path (e.g. `https://sentropic.sent-tech.ca`).
 * Precedence: explicit `SENTROPIC_APP_ORIGIN` > stripped API base.
 */
export function deriveAppOrigin(
    env: NodeJS.ProcessEnv = process.env,
    apiBaseUrl: string = resolveApiBaseUrl(env),
): string {
    const override = (env.SENTROPIC_APP_ORIGIN ?? '').trim();
    const sourceUrl = override || apiBaseUrl;
    const u = new URL(sourceUrl);
    assertSafeOrigin(u, sourceUrl);

    let basePath = stripTrailingSlashes(u.pathname);
    if (!override) {
        // Strip a known API prefix from the API base (tolerate /api/v1, /api,
        // reverse-proxy subpaths, trailing slashes). Only the API base is stripped;
        // an explicit SENTROPIC_APP_ORIGIN is taken as the app base verbatim.
        for (const prefix of API_PATH_PREFIXES) {
            if (basePath.endsWith(prefix)) {
                basePath = basePath.slice(0, -prefix.length);
                break;
            }
        }
    }
    // Re-serialize from trusted parts only (drop any query/hash).
    return `${u.protocol}//${u.host}${stripTrailingSlashes(basePath)}`;
}

/** Build the absolute device-pairing URL with the user code pre-filled. */
export function buildPairingUrl(userCode: string, env: NodeJS.ProcessEnv = process.env): string {
    const origin = deriveAppOrigin(env);
    const url = new URL(`${origin}/auth/devices/pair`);
    url.searchParams.set('user_code', userCode);
    return url.toString();
}
