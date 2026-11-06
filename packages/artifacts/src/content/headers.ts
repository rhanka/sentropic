/**
 * L-5d — content response headers and the grant cookie (spec-v8 §9 5d).
 *
 * Untrusted HTML is served only on the separate content domain with
 * no-store caching, MIME sniffing disabled, framing denied (embed mode
 * is refused in this pilot) and a restrictive CSP. The declared manifest
 * MIME type is authoritative — types are never sniffed from bytes.
 * Non-HTML assets may be cached only when the host explicitly sets an
 * asset cache budget; the default stays no-store (cache is never a
 * revocation mechanism). The grant cookie is host-only (`__Host-`
 * prefix: Secure, Path=/, no Domain attribute).
 */

export const GRANT_COOKIE_NAME = '__Host-artifacts_grant';

/** Host-configured content mode (owner decision 05/11): safe is the historic strict regime and the default. */
export type ContentMode = 'safe' | 'application';

const SAFE_HTML_CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "connect-src 'self'",
  "font-src 'self'",
  "media-src 'self'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join('; ');

/**
 * Application-mode HTML policy (binding J1.0, measured on the real immo UI
 * build): same-origin module workers, runtime-injected styles, blob media.
 * No `unsafe-eval`, no `wasm-unsafe-eval`, no `blob:` worker. Kept as one
 * constant so the conductor can relay adjustments.
 */
export const APPLICATION_HTML_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  "media-src 'self' blob:",
  "connect-src 'self'",
  "worker-src 'self'",
  "child-src 'self'",
  "frame-src 'none'",
  "frame-ancestors 'none'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join('; ');

const SCRIPT_HASH_RE = /^'sha256-[A-Za-z0-9+/=]+'$/;

/** Application policy with per-release inline script hashes appended to `script-src` only. */
function applicationCsp(scriptHashes: readonly string[] | undefined): string {
  if (scriptHashes === undefined || scriptHashes.length === 0) return APPLICATION_HTML_CSP;
  for (const hash of scriptHashes) {
    if (!SCRIPT_HASH_RE.test(hash)) throw new Error(`invalid inline script hash: ${hash}`);
  }
  return APPLICATION_HTML_CSP.replace("script-src 'self'", `script-src 'self' ${scriptHashes.join(' ')}`);
}

/**
 * Active-content types that can script or navigate when navigated to
 * directly get a sandboxed CSP in addition to `nosniff`: SVG (validated at
 * commit against scripts/handlers/external references, sandboxed at serve
 * time so direct navigation cannot script even if a construct slips
 * through) and PDF.
 */
const SANDBOX_CSP = "sandbox";
const SANDBOXED_MIME_TYPES = new Set(['image/svg+xml', 'application/pdf']);

export interface ContentHeaderInput {
  mimeType: string;
  size: number;
  /** Explicit host opt-in for non-HTML asset caching (seconds). */
  assetCacheSeconds?: number;
  /** Host-configured mode: `safe` (default, historic strict) or `application` (J1.0 policy). */
  mode?: ContentMode;
  /** Per-release inline script hashes, application mode only. */
  scriptHashes?: readonly string[];
}

/** Security/cache headers for one served file (declared MIME wins). */
export function contentHeaders(input: ContentHeaderInput): Record<string, string> {
  const mimeType = input.mimeType.length === 0 ? 'application/octet-stream' : input.mimeType;
  const isHtml = mimeType === 'text/html';
  const withCharset = mimeType.startsWith('text/') ? `${mimeType}; charset=utf-8` : mimeType;
  const cacheable = !isHtml && input.assetCacheSeconds !== undefined && input.assetCacheSeconds > 0;
  const mode = input.mode ?? 'safe';
  return {
    'content-type': withCharset,
    'content-length': String(input.size),
    'x-content-type-options': 'nosniff',
    'cross-origin-resource-policy': 'same-origin',
    'cache-control': cacheable ? `private, max-age=${input.assetCacheSeconds}` : 'no-store',
    'x-frame-options': 'DENY',
    'referrer-policy': 'no-referrer',
    ...(isHtml ? { 'content-security-policy': mode === 'application' ? applicationCsp(input.scriptHashes) : SAFE_HTML_CSP } : {}),
    ...(SANDBOXED_MIME_TYPES.has(mimeType) ? { 'content-security-policy': SANDBOX_CSP } : {}),
  };
}

/** Host-only grant cookie header value (no Domain attribute, ever). */
export function grantCookie(token: string, maxAgeSeconds: number): string {
  return `${GRANT_COOKIE_NAME}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAgeSeconds}`;
}

/** Extract the grant token from a Cookie header (undefined when absent). */
export function parseGrantCookie(cookieHeader: string | undefined): string | undefined {
  if (cookieHeader === undefined) return undefined;
  for (const part of cookieHeader.split(';')) {
    const trimmed = part.trim();
    if (trimmed.startsWith(`${GRANT_COOKIE_NAME}=`)) {
      const value = trimmed.slice(GRANT_COOKIE_NAME.length + 1);
      return value.length === 0 ? undefined : value;
    }
  }
  return undefined;
}
