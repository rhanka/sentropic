const EXCLUDED_HEADERS: readonly string[] = [
  'connection', 'keep-alive', 'proxy-connection', 'te', 'trailer', 'transfer-encoding',
  'upgrade', 'proxy-authenticate', 'proxy-authorization',
  'authorization', 'x-api-key', 'api-key', 'anthropic-api-key', 'anthropic-admin-api-key',
  'anthropic-oauth-token', 'anthropic-key', 'cookie', 'cookie2', 'set-cookie', 'set-cookie2',
];

/** Shared transport/credential exclusions; Connection nominations are case-insensitive. */
export const nativeHeaderExclusions = (
  headers: Readonly<Record<string, string>>,
): ReadonlySet<string> => new Set([
  ...EXCLUDED_HEADERS,
  ...Object.entries(headers).flatMap(([name, value]) => name.toLowerCase() === 'connection'
    ? value.split(',').map((nominated) => nominated.trim().toLowerCase()) : []),
]);

/** Native responses extend canonical safe headers; shared organization exposure is owner-accepted. */
export const buildNativeResponseHeaders = (
  headers: Readonly<Record<string, string>>, canonicalSafe: ReadonlySet<string>,
): Readonly<Record<string, string>> => {
  const excluded = nativeHeaderExclusions(headers);
  return Object.fromEntries(Object.entries(headers).filter(([key]) => {
    const name = key.toLowerCase();
    return !excluded.has(name) && !name.startsWith('x-sentropic-')
      && (canonicalSafe.has(name) || name.startsWith('anthropic-'));
  }));
};

/** Caller values only. The host adds URL-derived transport metadata and server auth last. */
export const buildNativeRequestHeaders = (
  headers: Readonly<Record<string, string>>,
): Readonly<Record<string, string>> => {
  const excluded = nativeHeaderExclusions(headers);
  const forwarded: Record<string, string> = {};
  for (const [originalName, value] of Object.entries(headers)) {
    const name = originalName.toLowerCase();
    if (excluded.has(name) || name.startsWith('x-sentropic-')) continue;
    if (name.startsWith('anthropic-') || name === 'x-app' || name.startsWith('x-stainless-')) {
      forwarded[name] = value;
    }
  }
  return forwarded;
};
