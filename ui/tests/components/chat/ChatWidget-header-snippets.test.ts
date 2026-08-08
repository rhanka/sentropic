import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const widgetPath = resolve(process.cwd(), 'src/lib/components/ChatWidget.svelte');

/**
 * L-C-shell S2 (app side): the app header's leading (mobile menu) and trailing (settings /
 * side-switch / placement / close) blocks are wrapped in host snippets and rendered IN PLACE,
 * ready to be handed to the package's renderHeaderLeading/renderHeaderActions slots at S8.
 * No visible change here (I4) — the blocks are wrapped, not moved or removed. No rename (L-A').
 */
describe('ChatWidget header host snippets (L-C-shell S2)', () => {
  it('exists', () => {
    expect(existsSync(widgetPath)).toBe(true);
  });

  it('wraps the leading (mobile menu) block in renderHeaderLeadingHost, rendered in place', () => {
    const source = readFileSync(widgetPath, 'utf8');
    expect(source).toContain('{#snippet renderHeaderLeadingHost()}');
    expect(source).toContain('{@render renderHeaderLeadingHost()}');
  });

  it('wraps the trailing actions block in renderHeaderActionsHost, rendered in place', () => {
    const source = readFileSync(widgetPath, 'utf8');
    expect(source).toContain('{#snippet renderHeaderActionsHost()}');
    expect(source).toContain('{@render renderHeaderActionsHost()}');
  });

  it('keeps every header control inside the snippets (wrapped, not removed) — I4', () => {
    const source = readFileSync(widgetPath, 'utf8');
    expect(source).toContain('sentropic:toggle-burger-menu');
    expect(source).toContain('isExtensionConfigAvailable()');
    expect(source).toContain("aria-label={$_('common.close')}");
  });
});
