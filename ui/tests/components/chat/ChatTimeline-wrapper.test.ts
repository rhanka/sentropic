import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const wrapperPath = resolve(
  process.cwd(),
  'src/lib/components/chat/ChatTimelineWrapper.svelte',
);

const panelPath = resolve(process.cwd(), 'src/lib/components/ChatPanel.svelte');

describe('ChatTimeline app wrapper', () => {
  it('wraps the package timeline and forwards app render snippets', () => {
    expect(existsSync(wrapperPath)).toBe(true);
    const source = readFileSync(wrapperPath, 'utf8');
    expect(source).toContain(
      "import PackageChatTimeline from '@sentropic/chat-ui/components/ChatTimeline.svelte'",
    );
    expect(source).toContain('renderUserMessage');
    expect(source).toContain('renderAssistantSegment');
    expect(source).toContain('renderRuntimeSegment');
  });

  it('is used by ChatPanel instead of owning the keyed timeline loop directly', () => {
    const source = readFileSync(panelPath, 'utf8');
    expect(source).toContain(
      "import ChatTimelineWrapper from '$lib/components/chat/ChatTimelineWrapper.svelte'",
    );
    expect(source).toContain('<ChatTimelineWrapper');
  });
});
