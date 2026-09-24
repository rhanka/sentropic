import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const widgetPath = resolve(process.cwd(), 'src/lib/components/ChatWidget.svelte');

/** Conversation content and callbacks remain app-owned inside package pager slots. */
describe('ChatWidget conversation host seams (L-C-shell S4)', () => {
  it('exists', () => {
    expect(existsSync(widgetPath)).toBe(true);
  });

  it('cuts ChatSessionsBar (header) and ChatPanel (body) into host snippets, passed as package slots', () => {
    const source = readFileSync(widgetPath, 'utf8');
    for (const name of ['renderConversationHeaderHost', 'renderChatBodyHost']) {
      expect(source).toContain(`{#snippet ${name}()}`);
      const slot = name === 'renderChatBodyHost' ? 'renderChatPanel' : 'renderConversationHeader';
      expect(source).toContain(`${slot}={${name}}`);
    }
  });

  it('keeps the sessions menu + Plus/Trash icon snippets app-owned and Back wiring intact', () => {
    const source = readFileSync(widgetPath, 'utf8');
    expect(source).toContain('{#snippet renderChatSessionsMenu(');
    expect(source).toContain('{#snippet renderSessionsPlusIcon()}');
    expect(source).toContain('{#snippet renderSessionsTrashIcon()}');
    expect(source).toContain('onBack={canAgentsListBeDefaultView ? returnToAgentsList : undefined}');
  });

  it('preserves the mounted chatPanelRef binding', () => {
    const source = readFileSync(widgetPath, 'utf8');
    expect(source).toContain('bind:this={chatPanelRef}');
  });
});
