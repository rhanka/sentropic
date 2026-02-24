import { describe, expect, it } from 'vitest';
import { ApiError } from '../../src/lib/utils/api';
import {
  fetchChromeExtensionDownloadMetadata,
  getChromeExtensionDownloadErrorMessage,
} from '../../src/lib/utils/chrome-extension-download';

describe('chrome extension download utils', () => {
  it('fetches and normalizes extension metadata', async () => {
    const data = await fetchChromeExtensionDownloadMetadata(async () => ({
      version: ' 1.2.3 ',
      source: ' ui/chrome-ext ',
      downloadUrl: ' https://downloads.example.com/top-ai-ideas/chrome-ext.zip ',
    }));

    expect(data).toEqual({
      version: '1.2.3',
      source: 'ui/chrome-ext',
      downloadUrl: 'https://downloads.example.com/top-ai-ideas/chrome-ext.zip',
    });
  });

  it('throws when metadata response is incomplete', async () => {
    await expect(
      fetchChromeExtensionDownloadMetadata(async () => ({
        version: '1.2.3',
        source: '',
        downloadUrl: 'https://downloads.example.com/top-ai-ideas/chrome-ext.zip',
      }))
    ).rejects.toThrow('Invalid Chrome extension download metadata response.');
  });

  it('prefers API error messages for UI display', () => {
    const message = getChromeExtensionDownloadErrorMessage(
      new ApiError('Metadata endpoint unavailable', 503),
      'Fallback message'
    );
    expect(message).toBe('Metadata endpoint unavailable');
  });

  it('falls back to default message when error is unknown', () => {
    const message = getChromeExtensionDownloadErrorMessage(null, 'Fallback message');
    expect(message).toBe('Fallback message');
  });
});
