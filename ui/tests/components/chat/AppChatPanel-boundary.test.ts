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
});
