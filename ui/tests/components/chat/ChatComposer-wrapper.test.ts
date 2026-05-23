import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const wrapperPath = resolve(
  process.cwd(),
  'src/lib/components/chat/ChatComposerWrapper.svelte',
);
const appPanelPath = resolve(
  process.cwd(),
  'src/lib/components/chat/AppChatPanel.svelte',
);

describe('ChatComposer app wrapper', () => {
  it('wraps the package composer shell and forwards app snippets', () => {
    expect(existsSync(wrapperPath)).toBe(true);
    const source = readFileSync(wrapperPath, 'utf8');
    expect(source).toContain(
      "import PackageChatComposer from '@sentropic/chat-ui/components/ChatComposer.svelte'",
    );
    expect(source).toContain('renderComposerSurface');
    expect(source).toContain('renderFloatingLayer');
    expect(source).toContain('renderLeftControls');
    expect(source).toContain('renderRightActions');
  });

  it('is used by AppChatPanel for the composer shell', () => {
    const source = readFileSync(appPanelPath, 'utf8');
    expect(source).toContain(
      "import ChatComposerWrapper from '$lib/components/chat/ChatComposerWrapper.svelte'",
    );
    expect(source).toContain('<ChatComposerWrapper');
  });
});
