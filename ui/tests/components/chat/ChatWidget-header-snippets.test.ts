import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const widgetPath = resolve(process.cwd(), 'src/lib/components/ChatWidget.svelte');

/** Host header controls are passed to the package-owned header frame. */
describe('ChatWidget header host snippets (L-C-shell S2)', () => {
  it('exists', () => {
    expect(existsSync(widgetPath)).toBe(true);
  });

  it('wraps the leading (mobile menu) block in renderHeaderLeadingHost, passed as a slot', () => {
    const source = readFileSync(widgetPath, 'utf8');
    expect(source).toContain('{#snippet renderHeaderLeadingHost()}');
    expect(source).toContain('renderHeaderLeading={renderHeaderLeadingHost}');
  });

  it('wraps the trailing actions block in renderHeaderActionsHost, passed as a slot', () => {
    const source = readFileSync(widgetPath, 'utf8');
    expect(source).toContain('{#snippet renderHeaderActionsHost()}');
    expect(source).toContain('renderHeaderActions={renderHeaderActionsHost}');
  });

  it('keeps every header control inside the snippets (wrapped, not removed) — I4', () => {
    const source = readFileSync(widgetPath, 'utf8');
    expect(source).toContain('sentropic:toggle-burger-menu');
    expect(source).toContain('isExtensionConfigAvailable()');
    expect(source).toContain("aria-label={$_('common.close')}");
  });
});
