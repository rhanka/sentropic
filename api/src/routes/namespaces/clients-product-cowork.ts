import { Hono } from 'hono';
import { env } from '../../config/env';
import { settingsService } from '../../services/settings';

// Mirrors the client namespace Chrome download adapter for the
// Sentropic Cowork desktop binary. The artifact is a single self-contained
// `cowork.exe` (the native payload is embedded + extracted at first run, no zip),
// produced by `make package-desktop-windows` into ui/static/cowork-desktop/
// (gitignored, same place as the chrome-ext artifact).
//
// BR-41a Lot 5C adds an admin-selectable channel: RELEASE (the official signed
// build, COWORK_DESKTOP_DOWNLOAD_URL) vs PRERELEASE (the branch-built unsigned
// build served for UAT, COWORK_DESKTOP_PRERELEASE_URL). The active channel is a
// GLOBAL settings row (key cowork_desktop.channel), default 'release'.

const DEFAULT_DESKTOP_VERSION = '0.2.0';
const DEFAULT_DESKTOP_SOURCE = 'packages/cowork-desktop';
// Single self-contained exe (no zip): the native payload is embedded + extracted at first run.
const DEFAULT_DESKTOP_EXE_PATH = '/cowork-desktop/cowork.exe';

export const COWORK_DESKTOP_CHANNEL_KEY = 'cowork_desktop.channel';
const VALID_CHANNELS = ['release', 'prerelease'] as const;
export type CoworkDesktopChannel = (typeof VALID_CHANNELS)[number];
const DEFAULT_CHANNEL: CoworkDesktopChannel = 'release';

const isValidChannel = (value: unknown): value is CoworkDesktopChannel =>
  typeof value === 'string' && (VALID_CHANNELS as readonly string[]).includes(value);

const readChannelConfig = (channel: CoworkDesktopChannel) => {
  const releaseUrl = (process.env.COWORK_DESKTOP_DOWNLOAD_URL ?? env.COWORK_DESKTOP_DOWNLOAD_URL ?? '').trim();
  const releaseVersion = (process.env.COWORK_DESKTOP_VERSION ?? env.COWORK_DESKTOP_VERSION ?? '').trim();
  const prereleaseUrl = (process.env.COWORK_DESKTOP_PRERELEASE_URL ?? env.COWORK_DESKTOP_PRERELEASE_URL ?? '').trim();
  const prereleaseVersion = (
    process.env.COWORK_DESKTOP_PRERELEASE_VERSION ??
    env.COWORK_DESKTOP_PRERELEASE_VERSION ??
    ''
  ).trim();
  const source = (process.env.COWORK_DESKTOP_SOURCE ?? env.COWORK_DESKTOP_SOURCE ?? '').trim();

  if (channel === 'prerelease') {
    return {
      downloadUrl: prereleaseUrl,
      version: prereleaseVersion || releaseVersion || DEFAULT_DESKTOP_VERSION,
      source: source || DEFAULT_DESKTOP_SOURCE,
    };
  }

  return {
    downloadUrl: releaseUrl,
    version: releaseVersion || DEFAULT_DESKTOP_VERSION,
    source: source || DEFAULT_DESKTOP_SOURCE,
  };
};

const getActiveChannel = async (): Promise<CoworkDesktopChannel> => {
  const stored = await settingsService.get(COWORK_DESKTOP_CHANNEL_KEY, { fallbackToGlobal: true });
  return isValidChannel(stored) ? stored : DEFAULT_CHANNEL;
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

  return new URL(DEFAULT_DESKTOP_EXE_PATH, normalizedOrigin).toString();
};

const unavailableMessage = (channel: CoworkDesktopChannel, reason: 'missing' | 'invalid'): string => {
  if (channel === 'prerelease') {
    return reason === 'invalid'
      ? 'Cowork desktop download is unavailable: COWORK_DESKTOP_PRERELEASE_URL must be a valid http(s) URL, then restart the API.'
      : 'Cowork desktop download is unavailable: set COWORK_DESKTOP_PRERELEASE_URL in the API environment and restart the API.';
  }
  return reason === 'invalid'
    ? 'Cowork desktop download is unavailable: COWORK_DESKTOP_DOWNLOAD_URL must be a valid http(s) URL, then restart the API.'
    : 'Cowork desktop download is unavailable: set COWORK_DESKTOP_DOWNLOAD_URL in the API environment and restart the API.';
};

export const coworkDesktopRouter = new Hono();

coworkDesktopRouter.get('/download', async (c) => {
  const channel = await getActiveChannel();
  const config = readChannelConfig(channel);

  let resolvedDownloadUrl: string | null = null;

  if (config.downloadUrl) {
    resolvedDownloadUrl = normalizeHttpUrl(config.downloadUrl);
    if (!resolvedDownloadUrl) {
      return c.json({ message: unavailableMessage(channel, 'invalid') }, 503);
    }
  } else if (channel === 'release') {
    // Release channel keeps the origin-based fallback (mirrors the chrome-ext one);
    // a prerelease build has no canonical static path, so it requires an explicit URL.
    resolvedDownloadUrl = buildFallbackDownloadUrlFromOrigin(c.req.header('origin'));
    if (!resolvedDownloadUrl) {
      return c.json({ message: unavailableMessage(channel, 'missing') }, 503);
    }
  } else {
    return c.json({ message: unavailableMessage(channel, 'missing') }, 503);
  }

  return c.json({
    channel,
    version: config.version,
    source: config.source,
    downloadUrl: resolvedDownloadUrl,
  });
});

// Admin-only: read the active distribution channel.
coworkDesktopRouter.get('/channel', async (c) => {
  const channel = await getActiveChannel();
  return c.json({ channel });
});

// Admin-only: set the active distribution channel.
coworkDesktopRouter.put('/channel', async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    body = null;
  }

  const channel = (body as { channel?: unknown } | null)?.channel;
  if (!isValidChannel(channel)) {
    return c.json(
      { message: "Invalid channel: expected 'release' or 'prerelease'." },
      400
    );
  }

  await settingsService.set(
    COWORK_DESKTOP_CHANNEL_KEY,
    channel,
    'Active Cowork desktop distribution channel (release|prerelease)'
  );

  return c.json({ channel });
});
