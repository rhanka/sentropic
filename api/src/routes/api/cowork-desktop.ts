import { Hono } from 'hono';
import { env } from '../../config/env';

// Mirrors api/src/routes/api/chrome-extension.ts download endpoint for the
// Sentropic Cowork desktop binary (BR-41a Lot 5). The artifact (cowork.exe +
// the win-x64 zip) is produced by `make package-desktop-windows` and lands under
// ui/static/cowork-desktop/ (gitignored, same as the chrome-ext zip).

const DEFAULT_DESKTOP_VERSION = '0.1.0';
const DEFAULT_DESKTOP_SOURCE = 'packages/cowork-desktop';
const DEFAULT_DESKTOP_ZIP_PATH = '/cowork-desktop/sentropic-cowork-windows-x64.zip';

const readConfig = () => {
  const downloadUrl = (process.env.COWORK_DESKTOP_DOWNLOAD_URL ?? env.COWORK_DESKTOP_DOWNLOAD_URL ?? '').trim();
  const version = (process.env.COWORK_DESKTOP_VERSION ?? env.COWORK_DESKTOP_VERSION ?? '').trim();
  const source = (process.env.COWORK_DESKTOP_SOURCE ?? env.COWORK_DESKTOP_SOURCE ?? '').trim();

  return {
    downloadUrl,
    version: version || DEFAULT_DESKTOP_VERSION,
    source: source || DEFAULT_DESKTOP_SOURCE,
  };
};

const normalizeHttpUrl = (value: string): string | null => {
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    return parsed.toString();
  } catch {
    return null;
  }
};

const buildFallbackDownloadUrlFromOrigin = (originHeader: string | undefined): string | null => {
  const origin = (originHeader ?? '').trim();
  if (!origin) return null;

  const normalizedOrigin = normalizeHttpUrl(origin);
  if (!normalizedOrigin) return null;

  return new URL(DEFAULT_DESKTOP_ZIP_PATH, normalizedOrigin).toString();
};

export const coworkDesktopRouter = new Hono();

coworkDesktopRouter.get('/download', async (c) => {
  const config = readConfig();

  let resolvedDownloadUrl: string | null = null;

  if (config.downloadUrl) {
    resolvedDownloadUrl = normalizeHttpUrl(config.downloadUrl);
    if (!resolvedDownloadUrl) {
      return c.json(
        {
          message:
            'Cowork desktop download is unavailable: COWORK_DESKTOP_DOWNLOAD_URL must be a valid http(s) URL, then restart the API.',
        },
        503
      );
    }
  } else {
    resolvedDownloadUrl = buildFallbackDownloadUrlFromOrigin(c.req.header('origin'));
    if (!resolvedDownloadUrl) {
      return c.json(
        {
          message:
            'Cowork desktop download is unavailable: set COWORK_DESKTOP_DOWNLOAD_URL in the API environment and restart the API.',
        },
        503
      );
    }
  }

  return c.json({
    version: config.version,
    source: config.source,
    downloadUrl: resolvedDownloadUrl,
  });
});
