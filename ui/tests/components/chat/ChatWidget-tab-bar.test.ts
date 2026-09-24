import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const widgetPath = resolve(process.cwd(), 'src/lib/components/ChatWidget.svelte');

/**
 * L-C-shell S1 host wiring: the app's live tab bar now renders through the package-owned
 * ChatWidgetTabBar primitive (D1c header-first handover), with no visible change (I4) —
 * extension variant, jobs badge off, comments tab gated on !isPluginMode. No rename (L-A').
 */
describe('ChatWidget tab bar wiring (L-C-shell S1)', () => {
  it('delegates the single TabBar to package ChatWidget', () => {
    expect(existsSync(widgetPath)).toBe(true);
    const source = readFileSync(widgetPath, 'utf8');
    expect(source).not.toContain('import ChatWidgetTabBar');
    const shell = readFileSync(resolve(process.cwd(), '../packages/chat-ui/src/components/ChatWidget.svelte'), 'utf8');
    expect(shell).toContain("import ChatWidgetTabBar from './ChatWidgetTabBar.svelte'");
    expect(shell.match(/<ChatWidgetTabBar\\b/g)).toHaveLength(1);
  });

  it('renders the tab bar through the primitive: extension variant, badge off, comments gated (I4)', () => {
    const source = readFileSync(widgetPath, 'utf8');
    expect(source).toContain('<PackageChatWidget');
    expect(source).toContain('tabBarVariant="extension"');
    expect(source).toContain('showJobsBadge={false}');
    expect(source).toContain('showCommentsTab={!isPluginMode}');
    expect(source).toContain('onActiveTabChange={(tab: ChatWidgetTab) => (activeTab = tab)}');
  });

  it('no longer owns the raw tab buttons — the primitive does', () => {
    const source = readFileSync(widgetPath, 'utf8');
    expect(source).not.toContain("on:click={() => (activeTab = 'comments')}");
    expect(source).not.toContain("on:click={() => (activeTab = 'chat')}");
    expect(source).not.toContain("on:click={() => (activeTab = 'queue')}");
  });
});
