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

const HTML_CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "connect-src 'self'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join('; ');

export interface ContentHeaderInput {
  mimeType: string;
  size: number;
  /** Explicit host opt-in for non-HTML asset caching (seconds). */
  assetCacheSeconds?: number;
}

/** Security/cache headers for one served file (declared MIME wins). */
export function contentHeaders(input: ContentHeaderInput): Record<string, string> {
  const mimeType = input.mimeType.length === 0 ? 'application/octet-stream' : input.mimeType;
  const isHtml = mimeType === 'text/html';
  const withCharset = mimeType.startsWith('text/') ? `${mimeType}; charset=utf-8` : mimeType;
  const cacheable = !isHtml && input.assetCacheSeconds !== undefined && input.assetCacheSeconds > 0;
  return {
    'content-type': withCharset,
    'content-length': String(input.size),
    'x-content-type-options': 'nosniff',
    'cross-origin-resource-policy': 'same-origin',
    'cache-control': cacheable ? `private, max-age=${input.assetCacheSeconds}` : 'no-store',
    'x-frame-options': 'DENY',
    'referrer-policy': 'no-referrer',
    ...(isHtml ? { 'content-security-policy': HTML_CSP } : {}),
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
