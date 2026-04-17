import { Hono } from 'hono';
import { env } from '../../config/env';
import { register, touchTab, evictStaleTabs, unregister } from '../../services/tab-registry';
import type { TabSource } from '../../services/tab-registry';

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

// --- Tab registration / keepalive / unregister endpoints ---

const VALID_TAB_SOURCES = new Set<TabSource>(['chrome_plugin', 'bookmarklet']);

chromeExtensionRouter.post('/tabs/register', async (c) => {
  const user = c.get('user');
  const body = await c.req.json().catch(() => ({}));
  const tab_id = typeof body.tab_id === 'string' ? body.tab_id.trim() : '';
  const url = typeof body.url === 'string' ? body.url.trim() : '';
  const title = typeof body.title === 'string' ? body.title.trim() : '';
  const source = typeof body.source === 'string' ? body.source.trim() : '';

  if (!VALID_TAB_SOURCES.has(source as TabSource)) {
    return c.json({ message: 'Invalid source. Must be "chrome_plugin" or "bookmarklet".' }, 400);
  }

  const entry = register({
    tab_id: tab_id || undefined,
    source: source as TabSource,
    url,
    title,
    userId: user.userId,
  });

  return c.json({ ok: true, tab_id: entry.tab_id });
});

chromeExtensionRouter.post('/tabs/keepalive', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const tab_id = typeof body.tab_id === 'string' ? body.tab_id.trim() : '';

  if (!tab_id) {
    return c.json({ message: 'tab_id is required.' }, 400);
  }

  touchTab(tab_id);
  const evicted = evictStaleTabs(45_000);

  return c.json({ ok: true, evicted_count: evicted.length });
});

chromeExtensionRouter.delete('/tabs/:tabId', async (c) => {
  const tabId = c.req.param('tabId');
  unregister(tabId);
  return c.json({ ok: true });
});

// --- Download endpoint ---

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
