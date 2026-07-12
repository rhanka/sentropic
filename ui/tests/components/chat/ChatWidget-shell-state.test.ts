import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const widgetPath = resolve(process.cwd(), 'src/lib/components/ChatWidget.svelte');

describe('ChatWidget shell state extraction', () => {
  it('uses the package shell-state helpers for tabs, layout, badges, and panel visibility', () => {
    expect(existsSync(widgetPath)).toBe(true);
    const source = readFileSync(widgetPath, 'utf8');
    expect(source).toContain("from '@sentropic/chat-ui/state/chatWidgetShell'");
    expect(source).toContain('coerceChatWidgetTab');
    // resolveEffectiveChatWidgetMode now lives in @sentropic/chat-ui ChatDock
    // (the dock surface owns docked/floating resolution). The gold ui ChatWidget
    // binds isDocked/isMobileViewport back from ChatDock instead of recomputing
    // the mode itself. Faithful dogfooding of that token is asserted in
    // packages/chat-ui/tests/chat-dock.dom.spec.ts.
    expect(source).toContain('resolveChatWidgetJobBadge');
    expect(source).toContain('shouldAutoCloseChatWidget');
    expect(source).toContain('panelVisibility.showQueuePanel');
    expect(source).toContain('jobBadgeState.kind');
  });

  it('routes the new-session button through the parent state reset handler', () => {
    expect(existsSync(widgetPath)).toBe(true);
    const source = readFileSync(widgetPath, 'utf8');
    expect(source).toContain('const handleNewSession = () => {');
    expect(source).toContain('chatSessionId = null;');
    expect(source).toContain('onNewSession={handleNewSession}');
    expect(source).not.toContain('on:click={() => chatPanelRef?.newSession?.()}');
  });
});
