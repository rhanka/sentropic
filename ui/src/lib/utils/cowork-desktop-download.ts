import { ApiError, apiGet, apiPut } from '$lib/utils/api';

export type CoworkDesktopChannel = 'release' | 'prerelease';

export interface CoworkDesktopDownloadMetadata {
  channel: CoworkDesktopChannel;
  version: string;
  source: string;
  downloadUrl: string;
}

const isCoworkDesktopChannel = (value: unknown): value is CoworkDesktopChannel =>
  value === 'release' || value === 'prerelease';

const asTrimmedString = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

export async function fetchCoworkDesktopDownloadMetadata(
  getRequest: <T = unknown>(endpoint: string) => Promise<T> = apiGet
): Promise<CoworkDesktopDownloadMetadata> {
  const response = await getRequest<Partial<CoworkDesktopDownloadMetadata>>('/cowork-desktop/download');

  const version = asTrimmedString(response?.version);
  const source = asTrimmedString(response?.source);
  const downloadUrl = asTrimmedString(response?.downloadUrl);
  const channel = isCoworkDesktopChannel(response?.channel) ? response.channel : 'release';

  if (!version || !source || !downloadUrl) {
    throw new Error('Invalid Cowork desktop download metadata response.');
  }

  return { channel, version, source, downloadUrl };
}

export async function setCoworkDesktopChannel(
  channel: CoworkDesktopChannel,
  putRequest: <T = unknown>(endpoint: string, body: unknown) => Promise<T> = apiPut
): Promise<CoworkDesktopChannel> {
  const response = await putRequest<{ channel?: unknown }>('/cowork-desktop/channel', { channel });
  if (!isCoworkDesktopChannel(response?.channel)) {
    throw new Error('Invalid Cowork desktop channel response.');
  }
  return response.channel;
}

export function getCoworkDesktopDownloadErrorMessage(error: unknown, fallbackMessage: string): string {
  if (error instanceof ApiError && error.message.trim().length > 0) {
    return error.message.trim();
  }
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message.trim();
  }
  return fallbackMessage;
}
