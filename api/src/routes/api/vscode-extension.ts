import { Hono } from 'hono';
import { env } from '../../config/env';

const DEFAULT_EXTENSION_VERSION = '0.1.0';
const DEFAULT_EXTENSION_SOURCE = 'ui/vscode-ext';
const DEFAULT_EXTENSION_VSIX_PATH = '/vscode-extension/top-ai-ideas-vscode-extension.vsix';

const readConfig = () => {
  const downloadUrl = (process.env.VSCODE_EXTENSION_DOWNLOAD_URL ?? env.VSCODE_EXTENSION_DOWNLOAD_URL ?? '').trim();
  const version = (process.env.VSCODE_EXTENSION_VERSION ?? env.VSCODE_EXTENSION_VERSION ?? '').trim();
  const source = (process.env.VSCODE_EXTENSION_SOURCE ?? env.VSCODE_EXTENSION_SOURCE ?? '').trim();

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

  return new URL(DEFAULT_EXTENSION_VSIX_PATH, normalizedOrigin).toString();
};

export const vscodeExtensionRouter = new Hono();

vscodeExtensionRouter.get('/download', async (c) => {
  const config = readConfig();

  let resolvedDownloadUrl: string | null = null;

  if (config.downloadUrl) {
    resolvedDownloadUrl = normalizeHttpUrl(config.downloadUrl);
    if (!resolvedDownloadUrl) {
      return c.json(
        {
          message:
            'VSCode extension download is unavailable: VSCODE_EXTENSION_DOWNLOAD_URL must be a valid http(s) URL, then restart the API.',
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
            'VSCode extension download is unavailable: set VSCODE_EXTENSION_DOWNLOAD_URL in the API environment and restart the API.',
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
