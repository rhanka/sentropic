import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const widgetPath = resolve(process.cwd(), 'src/lib/components/ChatWidget.svelte');

describe('ChatWidget app wrapper', () => {
  it('wraps the package widget shell while keeping app-owned jobs and chat surfaces injected', () => {
    expect(existsSync(widgetPath)).toBe(true);
    const source = readFileSync(widgetPath, 'utf8');
    expect(source).toContain(
      "import PackageChatWidget from '@sentropic/chat-ui/components/ChatWidget.svelte'",
    );
    expect(source).toContain('<PackageChatWidget');
    expect(source).toContain('activeJobsCount={activeJobsCount}');
    expect(source).toContain('failedJobsCount={failedJobsCount}');
    expect(source).toContain("queueTabLabel={$_('chat.tabs.jobs')}");
    expect(source).toContain('onPurgeJobs={handlePurgeMyJobs}');
    expect(source).not.toContain('renderAppChatWidgetShell');
    expect(source).not.toContain('renderShell=');
    for (const slot of ['renderHeaderLeading', 'renderHeaderActions', 'renderJobsPanel', 'renderCommentsPanel', 'renderContentGate', 'renderConversationHeader', 'renderAgentsListHeader']) {
      expect(source).toContain(`${slot}={${slot}Host}`);
    }
    expect(source).toContain('renderChatPanel={renderChatBodyHost}');
    const shell = readFileSync(resolve(process.cwd(), '../packages/chat-ui/src/components/ChatWidget.svelte'), 'utf8');
    expect(shell).toContain('<ChatWidgetPager');
    expect(shell).toContain('<ChatWidgetTabBar');
    expect(shell).toContain('{@render renderContentGate(renderReady)}');
  });
});
