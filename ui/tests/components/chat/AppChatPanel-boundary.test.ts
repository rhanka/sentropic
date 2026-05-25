import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const panelPath = resolve(process.cwd(), 'src/lib/components/ChatPanel.svelte');
const appPanelPath = resolve(
  process.cwd(),
  'src/lib/components/chat/AppChatPanel.svelte',
);

describe('AppChatPanel boundary', () => {
  it('keeps public ChatPanel as a thin wrapper over the app implementation', () => {
    expect(existsSync(appPanelPath)).toBe(true);
    const source = readFileSync(panelPath, 'utf8');
    expect(source).toContain(
      "import PackageChatPanel from '@sentropic/chat-ui/components/ChatPanel.svelte'",
    );
    expect(source).toContain(
      "import AppChatPanel from '$lib/components/chat/AppChatPanel.svelte'",
    );
    expect(source).toContain('<PackageChatPanel');
    expect(source).toContain('renderShell={renderAppChatPanelShell}');
    expect(source).toContain('<AppChatPanel');
    expect(source).toContain('export const focusComposer');
    expect(source).not.toContain("import { apiFetch");
    expect(source).not.toContain('const sendMessage = async');
  });

  it('allows inline generated image card rendering by AppChatPanel boundary logic', () => {
    const source = readFileSync(appPanelPath, 'utf8');
    expect(source).toContain("card.kind === 'image'");
    expect(source).toContain('card.previewUrl');
    expect(source).toContain('card.providerId');
    expect(source).toContain('card.modelId');
    expect(source).toContain('resolveGeneratedImagePreviewUrl(card)');
    expect(source).toContain('getDownloadUrl({');
    expect(source).toContain("$_('chat.generatedImage.noPreview')");
    expect(source).toContain("$_('chat.generatedImage.prompt'");
    expect(source).toContain('downloadGeneratedFile(card)');
  });
});
