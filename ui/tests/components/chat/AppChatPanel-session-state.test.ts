import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const panelPath = resolve(process.cwd(), 'src/lib/components/chat/AppChatPanel.svelte');

describe('AppChatPanel session state', () => {
  it('does not auto-select an existing session after an explicit new-session action', () => {
    expect(existsSync(panelPath)).toBe(true);
    const source = readFileSync(panelPath, 'utf8');

    expect(source).toContain('let suppressSessionAutoSelect = false;');
    expect(source).toContain('suppressSessionAutoSelect = true;');
    expect(source).toContain('!suppressSessionAutoSelect && !sessionId && sessions.length > 0');
    expect(source).toContain('suppressSessionAutoSelect = false;');
  });

  it('invalidates stale session hydration when starting a blank session', () => {
    expect(existsSync(panelPath)).toBe(true);
    const source = readFileSync(panelPath, 'utf8');

    expect(source).toContain('let sessionHydrationGeneration = 0;');
    expect(source).toContain('const hydrationGeneration = ++sessionHydrationGeneration;');
    expect(source).toContain('const isCurrentHydration = () =>');
    expect(source).toContain('hydrationGeneration === sessionHydrationGeneration;');
    expect(source).toContain('sessionHydrationGeneration += 1;');
  });
});
