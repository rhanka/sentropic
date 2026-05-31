import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  EXTENSION_CONFIG_STORAGE_KEY,
  getDefaultConfig,
} from '../../chrome-ext/extension-config';

const readUiFile = (relativePath: string): string =>
  readFileSync(resolve(__dirname, '..', '..', relativePath), 'utf8');

describe('Sentropic extension contract', () => {
  it('uses Sentropic production defaults for the Chrome extension', () => {
    expect(EXTENSION_CONFIG_STORAGE_KEY).toBe('sentropic:extensionConfig:v1');
    expect(getDefaultConfig('prod')).toMatchObject({
      apiBaseUrl: 'https://sentropic.sent-tech.ca/api/v1',
      appBaseUrl: 'https://sentropic.sent-tech.ca',
    });
  });

  it('does not reference retired production hosts in extension entrypoints', () => {
    for (const relativePath of [
      'chrome-ext/background.ts',
      'chrome-ext/content.ts',
      'chrome-ext/extension-config.ts',
      'chrome-ext/manifest.json',
      'src/lib/components/ChatWidget.svelte',
    ]) {
      const source = readUiFile(relativePath);
      expect(source).not.toContain('top-ai-ideas-api.sent-tech.ca');
      expect(source).not.toContain('top-ai-ideas.sent-tech.ca');
      expect(source).toContain('sentropic.sent-tech.ca');
    }
  });

  it('uses Sentropic self-hosted extension artifact and mount identifiers', () => {
    expect(readUiFile('chrome-ext/content.ts')).toContain('sentropic-ext');
    expect(readUiFile('chrome-ext/package-extension-zip.js')).toContain(
      'sentropic-chrome-extension.zip',
    );
    expect(readUiFile('vscode-ext/package-vsix.js')).toContain(
      'sentropic-vscode-extension.vsix',
    );
  });
});
