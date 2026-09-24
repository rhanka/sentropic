import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const widgetPath = resolve(process.cwd(), 'src/lib/components/ChatWidget.svelte');

/**
 * L-C-shell S4 (app side): inside the chat panel host snippet, the conversation header
 * (ChatSessionsBar) and the conversation body (ChatPanel) are cut into their own host snippets
 * and rendered IN PLACE — ready for the package renderConversationHeader/renderChatPanel seams at
 * S8. The sessions menu + Plus/Trash icon snippets stay app-owned, no composer code moves, and the
 * mounted chatPanelRef binding is preserved. No visible change (I4), no rename (L-A').
 */
describe('ChatWidget conversation host seams (L-C-shell S4)', () => {
  it('exists', () => {
    expect(existsSync(widgetPath)).toBe(true);
  });

  it('cuts ChatSessionsBar (header) and ChatPanel (body) into host snippets, rendered in place', () => {
    const source = readFileSync(widgetPath, 'utf8');
    for (const name of ['renderConversationHeaderHost', 'renderChatBodyHost']) {
      expect(source).toContain(`{#snippet ${name}()}`);
      expect(source).toContain(`{@render ${name}()}`);
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
