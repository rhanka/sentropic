import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  EXTENSION_CONFIG_STORAGE_KEY,
  getDefaultConfig,
} from '../../chrome-ext/extension-config';

const readUiFile = (relativePath: string): string =>
  readFileSync(resolve(__dirname, '..', '..', relativePath), 'utf8');

const readRepoFile = (relativePath: string): string =>
  readFileSync(resolve(__dirname, '..', '..', '..', relativePath), 'utf8');

const readSourceFile = (relativePath: string): string =>
  relativePath.startsWith('packages/')
    ? readRepoFile(relativePath)
    : readUiFile(relativePath);

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

  it('uses Sentropic identity for the self-hosted VSCode extension', () => {
    const manifest = JSON.parse(readUiFile('vscode-ext/package.json')) as {
      name?: string;
      publisher?: string;
    };

    expect(manifest.name).toBe('sentropic-vscode-extension');
    expect(manifest.publisher).toBe('sentropic');
    expect(readUiFile('vscode-ext/webview-entry.ts')).toContain(
      'https://sentropic.local/vscode',
    );
    expect(readUiFile('vscode-ext/webview-entry.ts')).not.toContain(
      'https://top-ai-ideas.local/vscode',
    );
  });

  it('uses Sentropic event and storage prefixes for extension handoff', () => {
    for (const relativePath of [
      'chrome-ext/background.ts',
      'chrome-ext/chatwidget-entry.ts',
      'chrome-ext/content.ts',
      'chrome-ext/extension-auth.ts',
      'chrome-ext/sidepanel.ts',
      'chrome-ext/tool-permissions.ts',
      'src/lib/components/ChatWidget.svelte',
      'src/lib/components/Header.svelte',
      'src/lib/stores/streamHub.ts',
      'src/lib/utils/user-ai-settings-events.ts',
      'src/routes/dashboard/+page.svelte',
      'src/routes/folders/[id]/+page.svelte',
      'src/routes/initiative/[id]/+page.svelte',
      'src/routes/organizations/[id]/+page.svelte',
      'packages/cowork-bridge/src/core/chatwidget-handoff.ts',
    ]) {
      const source = readSourceFile(relativePath);
      expect(source).not.toContain('topAiIdeas');
      expect(source).not.toContain('topai:');
      expect(source).not.toContain('topai-stream-proxy');
      expect(source).toContain('sentropic');
    }
  });

  it('uses Sentropic command, bridge, config, and runtime prefixes for VSCode', () => {
    for (const relativePath of [
      'vscode-ext/extension.ts',
      'vscode-ext/local-tools-adapter.ts',
      'vscode-ext/local-tools.ts',
      'vscode-ext/package.json',
      'vscode-ext/package-vsix.js',
      'vscode-ext/vscode-bridge.ts',
      'vscode-ext/webview-entry.ts',
      'src/lib/components/ChatWidget.svelte',
      'src/lib/components/chat/AppChatPanel.svelte',
    ]) {
      const source = readUiFile(relativePath);
      expect(source).not.toContain('topai.vscode');
      expect(source).not.toContain('topai.openPanel');
      expect(source).not.toContain('topai.chatView');
      expect(source).not.toContain('topai.sessionToken');
      expect(source).not.toContain('topai.apiBaseUrl');
      expect(source).not.toContain('topai.appBaseUrl');
      expect(source).not.toContain('topai.wsBaseUrl');
      expect(source).not.toContain('topai-vscode-webview');
      expect(source).not.toContain('topai-vscode-host');
      expect(source).not.toContain('topai-icon.svg');
      expect(source).not.toContain('__TOPAI_VSCODE_RUNTIME__');
      expect(source).not.toContain('__TOPAI_DEFAULT');
      expect(source).toContain('sentropic');
    }
  });
});
