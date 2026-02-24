import { Hono } from 'hono';
import { env } from '../../config/env';

const DEFAULT_EXTENSION_VERSION = '0.1.0';
const DEFAULT_EXTENSION_SOURCE = 'ui/chrome-ext';
const DEFAULT_EXTENSION_ZIP_PATH = '/chrome-extension/top-ai-ideas-chrome-extension.zip';

const readConfig = () => {
  const downloadUrl = (process.env.CHROME_EXTENSION_DOWNLOAD_URL ?? env.CHROME_EXTENSION_DOWNLOAD_URL ?? '').trim();
  const version = (process.env.CHROME_EXTENSION_VERSION ?? env.CHROME_EXTENSION_VERSION ?? '').trim();
  const source = (process.env.CHROME_EXTENSION_SOURCE ?? env.CHROME_EXTENSION_SOURCE ?? '').trim();

  return {
    downloadUrl,
    version: version || DEFAULT_EXTENSION_VERSION,
    source: source || DEFAULT_EXTENSION_SOURCE,
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

  return new URL(DEFAULT_EXTENSION_ZIP_PATH, normalizedOrigin).toString();
};

export const chromeExtensionRouter = new Hono();

chromeExtensionRouter.get('/download', async (c) => {
  const config = readConfig();

  let resolvedDownloadUrl: string | null = null;

  if (config.downloadUrl) {
    resolvedDownloadUrl = normalizeHttpUrl(config.downloadUrl);
    if (!resolvedDownloadUrl) {
      return c.json(
        {
          message:
            'Chrome extension download is unavailable: CHROME_EXTENSION_DOWNLOAD_URL must be a valid http(s) URL, then restart the API.',
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
            'Chrome extension download is unavailable: set CHROME_EXTENSION_DOWNLOAD_URL in the API environment and restart the API.',
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
