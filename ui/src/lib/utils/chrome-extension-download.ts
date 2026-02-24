import { ApiError, apiGet } from '$lib/utils/api';

export interface ChromeExtensionDownloadMetadata {
  version: string;
  source: string;
  downloadUrl: string;
}

const asTrimmedString = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

export async function fetchChromeExtensionDownloadMetadata(
  getRequest: <T = unknown>(endpoint: string) => Promise<T> = apiGet
): Promise<ChromeExtensionDownloadMetadata> {
  const response = await getRequest<Partial<ChromeExtensionDownloadMetadata>>('/chrome-extension/download');

  const version = asTrimmedString(response?.version);
  const source = asTrimmedString(response?.source);
  const downloadUrl = asTrimmedString(response?.downloadUrl);

  if (!version || !source || !downloadUrl) {
    throw new Error('Invalid Chrome extension download metadata response.');
  }

  return { version, source, downloadUrl };
}

export function getChromeExtensionDownloadErrorMessage(error: unknown, fallbackMessage: string): string {
  if (error instanceof ApiError && error.message.trim().length > 0) {
    return error.message.trim();
  }
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message.trim();
  }
  return fallbackMessage;
}
