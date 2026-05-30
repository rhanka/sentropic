import { ApiError, apiGet } from '$lib/utils/api';

export interface CoworkDesktopDownloadMetadata {
  version: string;
  source: string;
  downloadUrl: string;
}

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

  if (!version || !source || !downloadUrl) {
    throw new Error('Invalid Cowork desktop download metadata response.');
  }

  return { version, source, downloadUrl };
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
