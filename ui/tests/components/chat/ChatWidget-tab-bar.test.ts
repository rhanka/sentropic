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
  it('imports the package-owned ChatWidgetTabBar primitive', () => {
    expect(existsSync(widgetPath)).toBe(true);
    const source = readFileSync(widgetPath, 'utf8');
    expect(source).toContain(
      "import ChatWidgetTabBar from '@sentropic/chat-ui/components/ChatWidgetTabBar.svelte'",
    );
  });

  it('renders the tab bar through the primitive: extension variant, badge off, comments gated (I4)', () => {
    const source = readFileSync(widgetPath, 'utf8');
    expect(source).toContain('<ChatWidgetTabBar');
    expect(source).toContain('variant="extension"');
    expect(source).toContain('showJobsBadge={false}');
    expect(source).toContain('showCommentsTab={!isPluginMode}');
    expect(source).toContain('onSelect={(tab: ChatWidgetTab) => (activeTab = tab)}');
  });

  it('no longer owns the raw tab buttons — the primitive does', () => {
    const source = readFileSync(widgetPath, 'utf8');
    expect(source).not.toContain("on:click={() => (activeTab = 'comments')}");
    expect(source).not.toContain("on:click={() => (activeTab = 'chat')}");
    expect(source).not.toContain("on:click={() => (activeTab = 'queue')}");
  });
});
