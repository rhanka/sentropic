import { describe, expect, it } from 'vitest';
import { ApiError } from '../../src/lib/utils/api';
import {
  fetchVsCodeExtensionDownloadMetadata,
  getVsCodeExtensionDownloadErrorMessage,
} from '../../src/lib/utils/vscode-extension-download';

describe('vscode extension download utils', () => {
  it('fetches and normalizes extension metadata', async () => {
    const data = await fetchVsCodeExtensionDownloadMetadata(async () => ({
      version: ' 0.1.0 ',
      source: ' ui/vscode-ext ',
      downloadUrl: ' https://downloads.example.com/top-ai-ideas/vscode-ext.vsix ',
    }));

    expect(data).toEqual({
      version: '0.1.0',
      source: 'ui/vscode-ext',
      downloadUrl: 'https://downloads.example.com/top-ai-ideas/vscode-ext.vsix',
    });
  });

  it('throws when metadata payload is invalid', async () => {
    await expect(
      fetchVsCodeExtensionDownloadMetadata(async () => ({
        version: '0.1.0',
        source: '',
        downloadUrl: 'https://downloads.example.com/top-ai-ideas/vscode-ext.vsix',
      }))
    ).rejects.toThrow('Invalid VSCode extension download metadata response.');
  });

  it('prefers API error messages for UI display', () => {
    const message = getVsCodeExtensionDownloadErrorMessage(
      new ApiError('Metadata endpoint unavailable', 503),
      'Fallback message'
    );
    expect(message).toBe('Metadata endpoint unavailable');
  });

  it('falls back when no usable message exists', () => {
    const message = getVsCodeExtensionDownloadErrorMessage(null, 'Fallback message');

    expect(message).toBe('Fallback message');
  });
});
