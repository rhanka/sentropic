import { Hono } from 'hono';
import { env } from '../../config/env';

const DEFAULT_EXTENSION_VERSION = '0.1.0';
const DEFAULT_EXTENSION_SOURCE = 'ui/chrome-ext';

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

export const chromeExtensionRouter = new Hono();

chromeExtensionRouter.get('/download', async (c) => {
  const config = readConfig();

  if (!config.downloadUrl) {
    return c.json({ message: 'Chrome extension download URL is not configured for this instance.' }, 503);
  }

  const normalizedUrl = normalizeHttpUrl(config.downloadUrl);
  if (!normalizedUrl) {
    return c.json({ message: 'Chrome extension download URL must be a valid http(s) URL.' }, 503);
  }

  return c.json({
    version: config.version,
    source: config.source,
    downloadUrl: normalizedUrl,
  });
});
